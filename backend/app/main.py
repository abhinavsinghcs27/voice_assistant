import json
import uuid
import shutil
import asyncio
import inspect
import base64
import time
import ssl
import logging
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger("main_api")

# Global SSL Unverified Context Bypass for Corporate Proxies
try:
    _unverified_context = ssl._create_unverified_context
    ssl._create_default_https_context = _unverified_context
except (AttributeError, Exception):
    pass

from app.config import (
    RECORDINGS_DIR,
    RESULTS_DIR,
    POST_CALL_DIR,
    GROQ_API_KEY,
    VOICE_ASSISTANT_SYSTEM_PROMPT,
    GREETING_TEXT,
    PERSONA_PRESETS,
    DEFAULT_PERSONA,
    DEFAULT_TTS_ENGINE
)
from app.stt.faster_whisper_provider import FasterWhisperProvider
from app.stt.indic_conformer_provider import IndicConformerProvider
from app.stt.groq_whisper_provider import GroqWhisperProvider
from app.llm.groq_provider import GroqLLMProvider
from app.tts.tts_provider import MultiEngineTTSProvider
from app.formatter import format_speech_output
from app.session_manager import session_manager

app = FastAPI(title="Hindi/Hinglish STT Benchmark & Voice Assistant API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registry of STT model configurations
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
tts_provider = MultiEngineTTSProvider()

# Pre-baked greetings cache keyed by persona_id + tts_engine
greeting_audio_cache = {}


def compute_levenshtein(seq1: list, seq2: list) -> int:
    """Exact Levenshtein distance calculation for words or characters."""
    size_x = len(seq1) + 1
    size_y = len(seq2) + 1
    matrix = [[0] * size_y for _ in range(size_x)]
    for x in range(size_x):
        matrix[x][0] = x
    for y in range(size_y):
        matrix[0][y] = y
    for x in range(1, size_x):
        for y in range(1, size_y):
            if seq1[x - 1] == seq2[y - 1]:
                matrix[x][y] = matrix[x - 1][y - 1]
            else:
                matrix[x][y] = min(
                    matrix[x - 1][y] + 1,      # deletion
                    matrix[x - 1][y - 1] + 1,  # substitution
                    matrix[x][y - 1] + 1       # insertion
                )
    return matrix[size_x - 1][size_y - 1]


def calculate_wer_cer(reference: str, hypothesis: str) -> dict:
    """Calculates exact Word Error Rate (WER %) and Character Error Rate (CER %)."""
    if not reference or not reference.strip():
        return {"wer": None, "cer": None}
    
    clean_ref = reference.strip().lower()
    clean_hyp = hypothesis.strip().lower()
    
    ref_words = clean_ref.split()
    hyp_words = clean_hyp.split()
    
    ref_chars = list(clean_ref.replace(" ", ""))
    hyp_chars = list(clean_hyp.replace(" ", ""))
    
    if len(ref_words) == 0:
        return {"wer": None, "cer": None}
        
    word_dist = compute_levenshtein(ref_words, hyp_words)
    wer = round((word_dist / len(ref_words)) * 100, 2)
    
    char_dist = compute_levenshtein(ref_chars, hyp_chars) if len(ref_chars) > 0 else 0
    cer = round((char_dist / max(len(ref_chars), 1)) * 100, 2) if len(ref_chars) > 0 else 0.0
    
    return {"wer": wer, "cer": cer}


@app.on_event("startup")
async def warm_greeting():
    """Synthesize the default greeting at startup for instant ~0ms start."""
    try:
        tts_res = await tts_provider.synthesize(text=GREETING_TEXT, engine="edge-tts")
        greeting_audio_cache["vaani_inbound_edge-tts"] = tts_res["audio_bytes"]
        print("Default greeting pre-baked at startup.")
    except Exception as e:
        print(f"Greeting pre-bake error: {e}")


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


@app.get("/api/tts/engines")
async def get_tts_engines():
    """Returns available TTS engines including Edge Neural, Google TTS, and Local pyttsx3."""
    return tts_provider.get_supported_engines()


@app.get("/api/personas")
async def get_personas():
    """Returns the Multi-Domain Persona Studio presets."""
    return list(PERSONA_PRESETS.values())


@app.post("/api/benchmark")
async def benchmark_audio(
    audio: UploadFile = File(...),
    models: str = Form("indic-conformer-onnx,faster-whisper-large-v3,faster-whisper-medium"),
    language: str = Form(None),
    reference_text: str = Form(None)
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
            
            # Compute WER and CER if reference text was supplied
            eval_metrics = calculate_wer_cer(reference_text, formatted["devanagari"] or formatted["transcript"])

            benchmark_results.append({
                "model_id": model_key,
                "model_name": MODEL_SPECS[model_key]["name"],
                "transcript": formatted["transcript"],
                "devanagari": formatted["devanagari"],
                "romanised": formatted["romanised"],
                "english": formatted["english"],
                "processing_time": proc_time,
                "real_time_factor": rtf,
                "wer": eval_metrics["wer"],
                "cer": eval_metrics["cer"]
            })

        response_payload = {
            "id": rec_id,
            "audio_duration": audio_duration,
            "reference_text": reference_text,
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
    persona_id: str = Form("vaani_inbound"),
    tts_engine: str = Form("edge-tts"),
    custom_system_prompt: str = Form(None),
    language: str = Form(None),
    return_binary: bool = Form(False)
):
    """
    Multi-Turn End-to-End Voice Assistant Pipeline:
    Audio -> STT (In-Memory) -> Persona System Prompt + History -> Groq LLM (Parallel with Telemetry/Slots) -> Multi-Engine TTS -> Response
    """
    total_start = time.time()
    rec_id = f"va_{uuid.uuid4().hex[:6]}"

    # Retrieve active session or create new session
    session = session_manager.get_or_create_session(session_id, persona_id=persona_id)
    active_session_id = session["session_id"]
    existing_history = session_manager.get_history(active_session_id)
    existing_slots = session["telemetry"].get("slots", {})

    try:
        audio_data = await audio.read()
        if not audio_data:
            raise HTTPException(status_code=400, detail="Empty audio upload.")

        # Stage 1: STT (fully in-memory)
        stt_start = time.time()
        stt_provider_inst = get_provider(stt_model)
        stt_call = stt_provider_inst.transcribe_buffer(audio_data, language=language)
        if inspect.isawaitable(stt_call):
            stt_res = await stt_call
        else:
            stt_res = stt_call
        stt_latency = round(time.time() - stt_start, 3)

        raw_transcript = stt_res["transcript"]
        user_text = raw_transcript.strip() or "[Audio unclear or silent]"
        format_task = asyncio.create_task(asyncio.to_thread(format_speech_output, raw_transcript))

        # Stage 2 & 4: LLM reasoning + telemetry / slot extraction run concurrently
        llm_start = time.time()
        groq_llm = get_llm_provider()

        # Determine system prompt based on active persona or custom override
        active_persona = PERSONA_PRESETS.get(persona_id, PERSONA_PRESETS[DEFAULT_PERSONA])
        system_prompt = custom_system_prompt.strip() if custom_system_prompt and custom_system_prompt.strip() else active_persona["system_prompt"]

        messages_payload = [{"role": "system", "content": system_prompt}]
        messages_payload.extend(existing_history)
        messages_payload.append({"role": "user", "content": user_text})

        llm_task = groq_llm.generate_conversation_response(messages=messages_payload)
        telemetry_task = asyncio.create_task(
            groq_llm.analyze_sentiment_and_telemetry(
                user_message=user_text,
                conversation_history=existing_history,
                existing_slots=existing_slots
            )
        )

        llm_res = await llm_task
        llm_latency = llm_res["processing_time"]
        llm_text = llm_res["text"]

        # Stage 3: Multi-Engine TTS (Edge-TTS, gTTS, or pyttsx3)
        tts_start = time.time()
        tts_res = await tts_provider.synthesize(text=llm_text, engine=tts_engine)
        tts_latency = tts_res["processing_time"]
        audio_bytes = tts_res["audio_bytes"]

        # Record turns in session state
        session_manager.add_turn(active_session_id, "user", user_text)
        session_manager.add_turn(active_session_id, "assistant", llm_text)

        total_latency = round(time.time() - total_start, 3)

        # Telemetry & Slot persistence
        telemetry_res = None
        try:
            telemetry_res = await asyncio.wait_for(asyncio.shield(telemetry_task), timeout=0.45)
        except Exception:
            pass
        if telemetry_res:
            session_manager.update_telemetry(active_session_id, telemetry_res)

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

        audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
        audio_data_url = f"data:audio/mp3;base64,{audio_b64}"

        updated_session = session_manager.get_or_create_session(active_session_id)

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
            "persona_id": persona_id,
            "tts_engine_used": tts_res.get("engine_used", tts_engine),
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


@app.post("/api/voice-assistant/barge-in")
async def register_barge_in(session_id: str = Form(...)):
    """
    Registers a zero-latency client barge-in event.
    Appends an interruption tag to the active turn context so the LLM knows the user cut in.
    """
    if not session_id or not session_manager.has_session(session_id):
        return {"status": "ignored", "detail": "Session not found"}
    
    session_manager.record_interruption(session_id)
    return {"status": "success", "session_id": session_id, "interrupted": True}


@app.post("/api/voice-assistant/session/reset")
async def reset_session(
    session_id: str = Form(None),
    persona_id: str = Form("vaani_inbound")
):
    """
    Resets conversation history for a given session.
    """
    new_sid = session_manager.reset_session(session_id, persona_id=persona_id)
    return {
        "status": "success",
        "session_id": new_sid,
        "persona_id": persona_id,
        "message": "Conversation history reset successfully."
    }


@app.post("/api/voice-assistant/greet")
async def voice_assistant_greet(
    persona_id: str = Form("vaani_inbound"),
    tts_engine: str = Form("edge-tts"),
    custom_greeting: str = Form(None)
):
    """
    Returns persona-specific greeting with the selected TTS engine.
    """
    persona = PERSONA_PRESETS.get(persona_id, PERSONA_PRESETS[DEFAULT_PERSONA])
    greeting_text = custom_greeting.strip() if custom_greeting and custom_greeting.strip() else persona["greeting"]

    cache_key = f"{persona_id}_{tts_engine}_{greeting_text}"
    if cache_key in greeting_audio_cache:
        audio_bytes = greeting_audio_cache[cache_key]
    else:
        tts_res = await tts_provider.synthesize(text=greeting_text, engine=tts_engine)
        audio_bytes = tts_res["audio_bytes"]
        greeting_audio_cache[cache_key] = audio_bytes

    audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
    return {
        "persona_id": persona_id,
        "text": greeting_text,
        "audio_url": f"data:audio/mp3;base64,{audio_b64}"
    }


@app.post("/api/voice-assistant/finalize")
async def finalize_session(session_id: str = Form(None)):
    """
    Ends the call and compiles transcript history, resolved memory slots, and sentiment analytics
    into structured JSON report files saved in backend/post-call-analysis/.
    """
    if not session_id or not session_manager.has_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found.")

    session = session_manager.sessions[session_id]
    history = session_manager.get_history(session_id)
    persona_id = session.get("persona_id", DEFAULT_PERSONA)
    persona_info = PERSONA_PRESETS.get(persona_id, PERSONA_PRESETS[DEFAULT_PERSONA])

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
            telemetry=session["telemetry"],
            persona_info=persona_info
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Feedback extraction error: {str(e)}")

    record_id = f"fb_{uuid.uuid4().hex[:6]}"
    feedback_record = dict(extraction["feedback"])
    feedback_record.update({
        "record_id": record_id,
        "session_id": session_id,
        "persona_id": persona_id,
        "persona_name": persona_info["name"],
        "turn_count": len(history),
        "created_at": time.time(),
        "created_timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "extraction_status": extraction["extraction_status"],
        "model_used": extraction["model_used"],
        "sentiment_score": extraction["feedback"].get("sentiment_score"),
        "transcript": history,
    })

    # Persist: pretty per-call JSON + line-delimited JSONL
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


@app.get("/api/voice-assistant/reports")
async def get_all_reports():
    """
    Returns list of all saved post-call reports alongside aggregated executive metrics
    (total calls, avg CSAT, positive sentiment %, escalation count).
    """
    reports = []
    total_csat = 0
    positive_count = 0
    escalation_count = 0

    if POST_CALL_DIR.exists():
        json_files = sorted(POST_CALL_DIR.glob("*_feedback.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        for jf in json_files:
            try:
                with open(jf, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    reports.append(data)
                    csat = data.get("overall_satisfaction", 3)
                    total_csat += csat
                    sent = data.get("aggregate_sentiment", "neutral")
                    if sent == "positive":
                        positive_count += 1
                    if data.get("resolution_status") == "escalated" or data.get("follow_up_required"):
                        escalation_count += 1
            except Exception as e:
                logger.warning(f"Error reading report {jf}: {e}")

    total_calls = len(reports)
    avg_csat = round(total_csat / total_calls, 2) if total_calls > 0 else 0.0
    positive_pct = round((positive_count / total_calls) * 100, 1) if total_calls > 0 else 0.0

    return {
        "analytics": {
            "total_calls": total_calls,
            "average_csat": avg_csat,
            "positive_sentiment_percent": positive_pct,
            "escalation_count": escalation_count
        },
        "reports": reports
    }


@app.get("/api/voice-assistant/reports/{record_id}")
async def get_report_by_id(record_id: str):
    """
    Fetches an individual post-call structured feedback JSON report by record ID.
    """
    report_file = POST_CALL_DIR / f"{record_id}_feedback.json"
    if not report_file.exists():
        raise HTTPException(status_code=404, detail="Report not found.")
    with open(report_file, "r", encoding="utf-8") as f:
        return json.load(f)