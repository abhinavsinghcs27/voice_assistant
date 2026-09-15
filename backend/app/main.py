import json
import uuid
import shutil
import asyncio
import inspect
import base64
import time
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

from app.config import RECORDINGS_DIR, RESULTS_DIR, POST_CALL_DIR, GROQ_API_KEY, VOICE_ASSISTANT_SYSTEM_PROMPT, GREETING_TEXT
from app.stt.faster_whisper_provider import FasterWhisperProvider
from app.stt.indic_conformer_provider import IndicConformerProvider
from app.stt.groq_whisper_provider import GroqWhisperProvider
from app.llm.groq_provider import GroqLLMProvider
from app.tts.tts_provider import GTTSProvider
from app.formatter import format_speech_output
from app.session_manager import session_manager

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
    },
    "groq-whisper-large-v3-turbo": {
        "name": "Groq Whisper Large V3 Turbo (Cloud)",
        "type": "groq_whisper",
        "model_id": "whisper-large-v3-turbo",
        "description": "Cloud GPU STT (~0.5-1s, needs internet). Best accuracy for noisy Hindi/Hinglish."
    }
}

# Cache initialized instances
loaded_providers = {}
llm_provider = None
tts_provider = GTTSProvider()

# Pre-baked greeting synthesized once at startup (instant, consistent)
greeting_audio: bytes = None

@app.on_event("startup")
async def warm_greeting():
    """Synthesize the fixed greeting once so greet requests have ~0ms latency."""
    global greeting_audio
    try:
        tts_res = await tts_provider.synthesize(text=GREETING_TEXT)
        greeting_audio = tts_res["audio_bytes"]
        print("Greeting pre-baked at startup.")
    except Exception as e:
        greeting_audio = None
        print(f"Greeting pre-bake failed (will synthesize on demand): {e}")

def get_provider(model_key: str):
    if model_key not in MODEL_SPECS:
        raise HTTPException(status_code=400, detail=f"Model '{model_key}' is not recognized.")
    if model_key not in loaded_providers:
        spec = MODEL_SPECS[model_key]
        if spec.get("type") == "groq_whisper":
            loaded_providers[model_key] = GroqWhisperProvider(model=spec["model_id"])
        elif spec.get("type") == "indic_conformer":
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
            if hasattr(provider, "transcribe_async"):
                result = await provider.transcribe_async(str(audio_path), language=language)
            else:
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
    session_id: str = Form(None),
    language: str = Form(None),
    return_binary: bool = Form(False)
):
    """
    Multi-Turn End-to-End Voice Assistant Pipeline (STT -> History + Groq LLM -> TTS -> Telemetry)
    """
    total_start = time.time()
    rec_id = f"va_{uuid.uuid4().hex[:6]}"

    # Retrieve active session or create new session
    session = session_manager.get_or_create_session(session_id)
    active_session_id = session["session_id"]
    existing_history = session_manager.get_history(active_session_id)

    try:
        audio_data = await audio.read()
        if not audio_data:
            raise HTTPException(status_code=400, detail="Empty audio upload.")

        # Stage 1: STT (fully in-memory — raw bytes straight into the provider)
        stt_start = time.time()
        stt_provider_inst = get_provider(stt_model)
        stt_call = stt_provider_inst.transcribe_buffer(audio_data, language=language)
        if inspect.isawaitable(stt_call):
            stt_res = await stt_call
        else:
            stt_res = stt_call
        stt_latency = round(time.time() - stt_start, 3)

        raw_transcript = stt_res["transcript"]
        # LLM prompt uses the raw transcript immediately — the display formatter
        # (GoogleTranslator/MyMemory cascade, ~3.3s/turn, blocking) is demoted to a
        # background task with a short wait budget so it never delays the reply.
        user_text = raw_transcript.strip() or "[Audio unclear or silent]"
        format_task = asyncio.create_task(asyncio.to_thread(format_speech_output, raw_transcript))

        if not user_text or not user_text.strip():
            user_text = "[Audio unclear or silent]"

        # Stage 2 & 4: LLM reasoning + telemetry extraction run in parallel.
        # Telemetry is not needed for the audio response, so it stays off the
        # critical path (was serialized after TTS, adding ~0.5s per turn).
        llm_start = time.time()
        groq_llm = get_llm_provider()

        # Build full dialogue payload with system prompt + past dialogue turns + new turn
        messages_payload = [{"role": "system", "content": VOICE_ASSISTANT_SYSTEM_PROMPT}]
        messages_payload.extend(existing_history)
        messages_payload.append({"role": "user", "content": user_text})

        llm_task = groq_llm.generate_conversation_response(messages=messages_payload)
        telemetry_task = asyncio.create_task(
            groq_llm.analyze_sentiment_and_telemetry(
                user_message=user_text,
                conversation_history=existing_history
            )
        )
        llm_res = await llm_task
        llm_latency = llm_res["processing_time"]
        llm_text = llm_res["text"]

        # Stage 3: TTS Speech Synthesis via Edge-TTS
        tts_start = time.time()
        tts_res = await tts_provider.synthesize(text=llm_text)
        tts_latency = tts_res["processing_time"]
        audio_bytes = tts_res["audio_bytes"]

        # Record turns in session state (telemetry may still be running in background)
        session_manager.add_turn(active_session_id, "user", user_text)
        session_manager.add_turn(active_session_id, "assistant", llm_text)

        total_latency = round(time.time() - total_start, 3)
        print(
            f"[LATENCY {active_session_id}] stt={stt_latency}s llm={llm_latency}s "
            f"tts={tts_latency}s total={total_latency}s "
            f"overhead={round(total_latency - stt_latency - llm_latency - tts_latency, 3)}s"
        )

        # Telemetry is display-only: wait briefly, don't block the reply on it.
        telemetry_res = None
        try:
            telemetry_res = await asyncio.wait_for(asyncio.shield(telemetry_task), timeout=0.4)
        except Exception:
            pass
        if telemetry_res:
            session_manager.update_telemetry(active_session_id, telemetry_res)

        # If client requested binary MP3 response
        if return_binary:
            return Response(
                content=audio_bytes,
                media_type="audio/mp3",
                headers={
                    "X-Session-ID": active_session_id,
                    "X-User-Transcript": base64.b64encode(user_text.encode('utf-8')).decode('ascii'),
                    "X-LLM-Response": base64.b64encode(llm_text.encode('utf-8')).decode('ascii'),
                    "X-Total-Latency-Ms": str(int(total_latency * 1000))
                }
            )

        # Default: Return JSON payload with audio URL + telemetry + full thread
        audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
        audio_data_url = f"data:audio/mp3;base64,{audio_b64}"

        updated_session = session_manager.get_or_create_session(active_session_id)

        # Formatter is display-only; wait up to 1s more for it, else fall back to raw.
        try:
            formatted_stt = await asyncio.wait_for(asyncio.shield(format_task), timeout=1.0)
        except Exception:
            formatted_stt = None
        if not formatted_stt:
            formatted_stt = {
                "transcript": raw_transcript,
                "devanagari": raw_transcript,
                "romanised": raw_transcript,
                "english": raw_transcript,
            }

        return {
            "id": rec_id,
            "session_id": active_session_id,
            "turn_history": updated_session["history"],
            "telemetry": updated_session["telemetry"],
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

@app.post("/api/voice-assistant/session/reset")
async def reset_session(session_id: str = Form(None)):
    """
    Resets the conversation history for a given session.
    """
    new_sid = session_manager.reset_session(session_id) if session_id else session_manager.get_or_create_session()["session_id"]
    return {
        "status": "success",
        "session_id": new_sid,
        "message": "Conversation history reset successfully."
    }

@app.post("/api/voice-assistant/greet")
async def voice_assistant_greet():
    """
    Returns the pre-baked greeting TTS (via data URL), synthesized once at startup.
    ~0ms latency, consistent wording. Falls back to on-demand synthesis if the cache missed.
    """
    global greeting_audio
    if greeting_audio is None:
        tts_res = await tts_provider.synthesize(text=GREETING_TEXT)
        greeting_audio = tts_res["audio_bytes"]
    audio_b64 = base64.b64encode(greeting_audio).decode("utf-8")
    return {
        "text": GREETING_TEXT,
        "audio_url": f"data:audio/mp3;base64,{audio_b64}"
    }

@app.post("/api/voice-assistant/finalize")
async def finalize_session(session_id: str = Form(None)):
    """
    Phase 2: Ends the call and aggregates the full conversation history into a
    single structured feedback JSON record for customer service DB ingestion.
    Idempotent — re-finalizing an already finalized session returns the existing record.
    """
    if not session_id or not session_manager.has_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found.")

    session = session_manager.sessions[session_id]
    history = session_manager.get_history(session_id)

    if not history:
        raise HTTPException(status_code=400, detail="No conversation history to analyze.")

    if session.get("finalized_at") and session.get("feedback_record"):
        return {
            "record_id": session["record_id"],
            "session_id": session_id,
            "turn_count": len(history),
            "structured_feedback": session["feedback_record"],
            "already_finalized": True
        }

    try:
        groq_llm = get_llm_provider()
        extraction = await groq_llm.extract_structured_feedback(
            conversation_history=history,
            telemetry=session["telemetry"]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Feedback extraction error: {str(e)}")

    record_id = f"fb_{uuid.uuid4().hex[:6]}"
    feedback_record = dict(extraction["feedback"])
    feedback_record.update({
        "record_id": record_id,
        "session_id": session_id,
        "turn_count": len(history),
        "extraction_status": extraction["extraction_status"],
        "model_used": extraction["model_used"],
        "sentiment_score": extraction["feedback"].get("sentiment_score"),
        "transcript": history,
    })

    # Persist: pretty per-call JSON + line-delimited JSONL for DB bulk ingestion
    feedback_path = POST_CALL_DIR / f"{record_id}_feedback.json"
    with open(feedback_path, "w", encoding="utf-8") as f:
        json.dump(feedback_record, f, ensure_ascii=False, indent=2)

    jsonl_path = POST_CALL_DIR / "feedback_records.jsonl"
    with open(jsonl_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(feedback_record, ensure_ascii=False) + "\n")

    session_manager.mark_finalized(session_id, record_id, feedback_record)

    return {
        "record_id": record_id,
        "session_id": session_id,
        "turn_count": len(history),
        "structured_feedback": feedback_record,
        "already_finalized": False
    }