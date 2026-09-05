import json
import uuid
import shutil
import base64
import time
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

from app.config import RECORDINGS_DIR, RESULTS_DIR, GROQ_API_KEY
from app.stt.faster_whisper_provider import FasterWhisperProvider
from app.stt.indic_conformer_provider import IndicConformerProvider
from app.llm.groq_provider import GroqLLMProvider
from app.tts.tts_provider import GTTSProvider
from app.formatter import format_speech_output

app = FastAPI(title="Hindi/Hinglish STT Benchmark & Voice Assistant API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registry of model configurations
MODEL_SPECS = {
    "indic-conformer-onnx": {
        "name": "AI4Bharat IndicConformer (Sherpa-ONNX)",
        "type": "indic_conformer",
        "description": "Ultra-fast non-autoregressive Conformer-CTC (~200ms on CPU, RTF < 0.05x)."
    },
    "faster-whisper-large-v3": {
        "name": "Faster Whisper Large V3",
        "type": "faster_whisper",
        "model_id": "large-v3",
        "description": "Highest accuracy & gold standard for Hindi/Hinglish code-mixing."
    },
    "faster-whisper-medium": {
        "name": "Faster Whisper Medium",
        "type": "faster_whisper",
        "model_id": "medium",
        "description": "Balanced high accuracy for Hinglish with 2x faster inference."
    }
}

# Cache initialized instances
loaded_providers = {}
llm_provider = None
tts_provider = GTTSProvider()

def get_provider(model_key: str):
    if model_key not in MODEL_SPECS:
        raise HTTPException(status_code=400, detail=f"Model '{model_key}' is not recognized.")
    if model_key not in loaded_providers:
        spec = MODEL_SPECS[model_key]
        if spec.get("type") == "indic_conformer":
            loaded_providers[model_key] = IndicConformerProvider()
        else:
            loaded_providers[model_key] = FasterWhisperProvider(
                model_size=spec["model_id"],
                device="auto",
                compute_type="auto"
            )
    return loaded_providers[model_key]

def get_llm_provider():
    global llm_provider
    if not llm_provider:
        if not GROQ_API_KEY:
            raise HTTPException(status_code=500, detail="GROQ_API_KEY is not configured in backend.")
        llm_provider = GroqLLMProvider(api_key=GROQ_API_KEY)
    return llm_provider

@app.get("/api/models")
async def get_models():
    return [
        {
            "id": k,
            "name": v["name"],
            "description": v["description"],
            "available": True
        }
        for k, v in MODEL_SPECS.items()
    ]

@app.post("/api/benchmark")
async def benchmark_audio(
    audio: UploadFile = File(...),
    models: str = Form("indic-conformer-onnx,faster-whisper-large-v3,faster-whisper-medium"),
    language: str = Form(None)
):
    selected_models = [m.strip() for m in models.split(",") if m.strip()]
    if not selected_models:
        raise HTTPException(status_code=400, detail="No models specified for benchmarking.")

    rec_id = f"rec_{uuid.uuid4().hex[:6]}"
    file_extension = Path(audio.filename).suffix or ".webm"
    audio_filename = f"{rec_id}{file_extension}"
    audio_path = RECORDINGS_DIR / audio_filename

    try:
        with open(audio_path, "wb") as buffer:
            shutil.copyfileobj(audio.file, buffer)

        benchmark_results = []
        audio_duration = 0.0

        for model_key in selected_models:
            provider = get_provider(model_key)
            result = provider.transcribe(str(audio_path), language=language)
            audio_duration = result["audio_duration"]
            proc_time = result["processing_time"]
            rtf = round(proc_time / audio_duration, 2) if audio_duration > 0 else 0.0

            formatted = format_speech_output(result["transcript"])

            benchmark_results.append({
                "model_id": model_key,
                "model_name": MODEL_SPECS[model_key]["name"],
                "transcript": formatted["transcript"],
                "devanagari": formatted["devanagari"],
                "romanised": formatted["romanised"],
                "english": formatted["english"],
                "processing_time": proc_time,
                "real_time_factor": rtf
            })

        response_payload = {
            "id": rec_id,
            "audio_duration": audio_duration,
            "results": benchmark_results
        }

        # Save comparative metadata
        result_path = RESULTS_DIR / f"{rec_id}_comparison.json"
        with open(result_path, "w", encoding="utf-8") as f:
            json.dump(response_payload, f, ensure_ascii=False, indent=2)

        return response_payload

    except Exception as e:
        if audio_path.exists():
            audio_path.unlink()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/voice-assistant/interact")
async def voice_assistant_interact(
    audio: UploadFile = File(...),
    stt_model: str = Form("indic-conformer-onnx"),
    language: str = Form(None),
    return_binary: bool = Form(False)
):
    """
    End-to-End Voice Assistant Pipeline (STT -> LLM -> TTS)
    1. Transcribes input user speech using selected STT model.
    2. Routes user query to Groq LLM (llama-3.3-70b-versatile).
    3. Synthesizes LLM response to MP3 audio via gTTS.
    4. Returns complete interaction response with audio & latency metrics.
    """
    total_start = time.time()
    rec_id = f"va_{uuid.uuid4().hex[:6]}"
    file_extension = Path(audio.filename).suffix or ".webm"
    audio_path = RECORDINGS_DIR / f"{rec_id}{file_extension}"

    try:
        # Save audio file
        with open(audio_path, "wb") as buffer:
            shutil.copyfileobj(audio.file, buffer)

        # Stage 1: STT
        stt_start = time.time()
        stt_provider_inst = get_provider(stt_model)
        stt_res = stt_provider_inst.transcribe(str(audio_path), language=language)
        stt_latency = round(time.time() - stt_start, 3)

        raw_transcript = stt_res["transcript"]
        formatted_stt = format_speech_output(raw_transcript)
        user_text = formatted_stt["devanagari"] or formatted_stt["transcript"] or raw_transcript

        if not user_text or not user_text.strip():
            user_text = "Namaste"

        # Stage 2: LLM Reasoning via Groq
        llm_start = time.time()
        groq_llm = get_llm_provider()
        llm_res = await groq_llm.generate_response(user_message=user_text)
        llm_latency = llm_res["processing_time"]
        llm_text = llm_res["text"]

        # Stage 3: TTS Speech Synthesis via gTTS
        tts_start = time.time()
        tts_res = tts_provider.synthesize(text=llm_text)
        tts_latency = tts_res["processing_time"]
        audio_bytes = tts_res["audio_bytes"]

        total_latency = round(time.time() - total_start, 3)

        # If client requested binary MP3 response
        if return_binary:
            return Response(
                content=audio_bytes,
                media_type="audio/mp3",
                headers={
                    "X-User-Transcript": base64.b64encode(user_text.encode('utf-8')).decode('ascii'),
                    "X-LLM-Response": base64.b64encode(llm_text.encode('utf-8')).decode('ascii'),
                    "X-Total-Latency-Ms": str(int(total_latency * 1000))
                }
            )

        # Default: Return JSON with Base64 audio data URL for direct browser playback
        audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
        audio_data_url = f"data:audio/mp3;base64,{audio_b64}"

        return {
            "id": rec_id,
            "user_transcript": {
                "raw": raw_transcript,
                "devanagari": formatted_stt["devanagari"],
                "romanised": formatted_stt["romanised"],
                "english": formatted_stt["english"]
            },
            "llm_response": {
                "text": llm_text,
                "model_used": llm_res["model_used"]
            },
            "audio_url": audio_data_url,
            "latency": {
                "stt_seconds": stt_latency,
                "llm_seconds": llm_latency,
                "tts_seconds": tts_latency,
                "total_seconds": total_latency
            }
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Voice Assistant Error: {str(e)}")
    finally:
        if audio_path.exists():
            audio_path.unlink()