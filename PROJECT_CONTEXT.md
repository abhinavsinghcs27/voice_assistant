# Hindi/Hinglish STT Benchmark & Sub-Second Voice Assistant - Full Project Context

## 1. Project Goal & Overview

This project is a high-performance **Hindi and Hinglish Speech-to-Text (STT) Benchmarking and Conversational Voice Assistant System**, built to operate efficiently on an **office laptop (CPU-bound)** with **zero cloud costs ($0)**.

The system serves two core operational modes:
1. **STT Benchmark Suite**: Multi-model evaluation comparing transcript quality, Devanagari Hindi text, Romanised Hinglish, English translation, processing time, and Real-Time Factor (RTF) across:
   - `AI4Bharat IndicConformer (Sherpa-ONNX INT8)` (~200ms CPU inference)
   - `Faster Whisper Large-V3`
   - `Faster Whisper Medium`
2. **Sub-Second Voice Assistant Engine**: Low-latency voice-to-voice interaction loop:
   `Audio Input -> Fast STT -> Groq Cloud LLaMA 3.3 70B LLM -> gTTS Audio Output`

---

## 2. Full Directory Tree Structure

```text
hindi-stt-benchmark/
├── PROJECT_CONTEXT.md
├── implementation_plan.md
├── backend/
│   ├── .env
│   ├── .env.example
│   ├── requirements.txt
│   ├── app/
│   │   ├── __init__.py
│   │   ├── config.py
│   │   ├── formatter.py
│   │   ├── main.py
│   │   ├── llm/
│   │   │   ├── __init__.py
│   │   │   └── groq_provider.py
│   │   ├── stt/
│   │   │   ├── __init__.py
│   │   │   ├── base.py
│   │   │   ├── faster_whisper_provider.py
│   │   │   └── indic_conformer_provider.py
│   │   └── tts/
│   │       ├── __init__.py
│   │       └── tts_provider.py
│   ├── models/            # Local ONNX storage for offline execution
│   ├── recordings/        # Runtime temporary audio storage (auto-created)
│   └── results/           # Runtime benchmark result persistence (auto-created)
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
gTTS==2.5.1
groq==0.4.2
httpx==0.27.0
python-dotenv==1.0.1
```

### Environment Variables (`backend/.env`)
```ini
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=openai/gpt-oss-20b
```

---

## 4. Replication Steps for Antigravity on Device 2

1. **Clone/Create Repository Root**:
   `mkdir hindi-stt-benchmark && cd hindi-stt-benchmark`

2. **Backend Setup**:
   ```powershell
   cd backend
   python -m venv venv
   .\venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   ```
   Add your `GROQ_API_KEY` to `backend/.env`.

3. **Start Servers**:
   - Backend: `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`
   - Frontend: `npm install && npm run dev`

