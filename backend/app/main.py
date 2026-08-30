import json
import uuid
import shutil
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.config import RECORDINGS_DIR, RESULTS_DIR
from app.stt.faster_whisper_provider import FasterWhisperProvider
from app.stt.indic_conformer_provider import IndicConformerProvider
from app.formatter import format_speech_output

app = FastAPI(title="Hindi/Hinglish STT Benchmark API", version="1.2.0")

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