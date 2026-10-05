# Hindi/Hinglish STT Benchmark & Sub-Second Voice Assistant - Full Project Context

## 1. Project Goal & Overview

This project is a high-performance **Hindi and Hinglish Speech-to-Text (STT) Benchmarking and Conversational Voice Assistant System**, built to operate efficiently on an **office laptop (CPU-bound)** with **zero cloud costs ($0)**.

The system serves three core operational modules:
1. **STT Benchmark Suite**: Multi-model evaluation comparing transcript quality, Devanagari Hindi text, Romanised Hinglish, English translation, processing time, WER/CER, and Real-Time Factor (RTF) across:
   - `AI4Bharat IndicConformer (Sherpa-ONNX INT8)` (~200ms CPU inference)
   - `Faster Whisper Large-V3` / `Faster Whisper Medium`
   - `Groq Cloud Whisper (whisper-large-v3)` (<400ms ultra-fast cloud inference)
2. **Sub-Second Voice Assistant Engine**:
   - Multi-persona studio (Vaani Customer Support, CNH Telematics Specialist, Krishi Mitra Agri Advisor).
   - Zero-latency client barge-in interruption detection.
   - Ultra-fast conversational fillers & audio backchanneling (pre-baked at startup) to eliminate perceptual latency.
   - Simulated external tool calling & dynamic CRM actions (`lookup_order`, `lookup_cnh_dtc_fault`, `create_support_ticket`).
   - Multi-engine TTS (Edge-TTS Neural, gTTS, pyttsx3) with automatic Hinglish transliteration.
3. **Session Audio Recording Archival & Post-Call Analytics**:
   - Turn-by-turn user and assistant audio recording archival in `backend/session-recordings/`.
   - Comprehensive post-call reporting (CSAT, sentiment scoring, intent resolution, escalation flags, slot tracking) with direct in-browser recording playback.

---

## 2. Full Directory Tree Structure

```text
hindi-stt-benchmark/
├── PROJECT_CONTEXT.md
├── backend/
│   ├── .env
│   ├── .env.example
│   ├── requirements.txt
│   ├── test_pipeline_features.py
│   ├── app/
│   │   ├── __init__.py
│   │   ├── config.py
│   │   ├── formatter.py
│   │   ├── main.py
│   │   ├── session_manager.py
│   │   ├── tools.py
│   │   ├── llm/
│   │   │   ├── __init__.py
│   │   │   └── groq_provider.py
│   │   ├── stt/
│   │   │   ├── __init__.py
│   │   │   ├── base.py
│   │   │   ├── faster_whisper_provider.py
│   │   │   ├── groq_whisper_provider.py
│   │   │   └── indic_conformer_provider.py
│   │   └── tts/
│   │       ├── __init__.py
│   │       └── tts_provider.py
│   ├── models/            # Local ONNX storage for offline execution
│   ├── post-call-analysis/# Persisted structured post-call JSON & JSONL records
│   ├── session-recordings/# Turn-by-turn audio storage (.webm & .mp3)
│   ├── recordings/        # Runtime temporary benchmark audio storage
│   └── results/           # Runtime benchmark comparative JSON persistence
└── frontend/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── App.jsx
        ├── App.css
        ├── index.css
        └── main.jsx
```

---

## 3. Environment & Configuration

### Backend Requirements (`backend/requirements.txt`)
```text
fastapi==0.110.0
uvicorn==0.28.0
python-multipart==0.0.9
pydantic==2.6.4
faster-whisper==1.0.3
sherpa-onnx==1.13.6
soundfile==0.14.0
indic-transliteration==2.3.82
deep-translator==1.11.4
edge-tts>=6.1.9
gTTS==2.5.1
pyttsx3>=2.90
groq==0.4.2
httpx==0.27.0
python-dotenv==1.0.1
```

### Environment Variables (`backend/.env`)
```ini
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=llama-3.3-70b-versatile
```

---

## 4. Running the Development Servers

1. **Backend Server** (Port 8000):
   ```powershell
   cd backend
   .\venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```

2. **Frontend Server** (Port 3000):
   ```powershell
   cd frontend
   npm run dev
   ```


