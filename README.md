# Vaani AI - Real-Time Hindi & Hinglish Voice Assistant & STT Benchmark

Vaani AI is a sub-second, zero-cost conversational voice assistant and speech-to-text (STT) benchmarking platform built specifically for **Hindi and code-mixed Hinglish** customer conversations.

---

## 🌟 Key Features

1. **Sub-Second Voice-to-Voice Turns**:
   - **Local STT**: AI4Bharat IndicConformer ONNX (~200ms CPU latency, RTF < 0.05x).
   - **Cloud STT**: Groq Whisper Large V3 Turbo for high accuracy in noisy audio.
   - **LLM Reasoning**: Groq LPU acceleration (`qwen/qwen3.8-27b` / `openai/gpt-oss-120b`).
   - **Neural TTS**: Edge-TTS (`en-IN-NeerjaNeural`, `hi-IN-SwaraNeural`), gTTS, and pyttsx3.

2. **Persona Studio Presets**:
   - **Vaani (Inbound)**: Customer Care & feedback collector.
   - **Vaani (Outbound)**: Proactive product experience & satisfaction survey.
   - **Rohan (E-Commerce)**: Delivery logistics, tracking, and order support.
   - **CNH Tech Expert**: Machinery diagnostics and precision agriculture guidance.

3. **Live Telemetry & Barge-In**:
   - Real-time sentiment tracking, CSAT estimation, intent detection, and human escalation flags.
   - Instant speech cancellation / barge-in support during user speech.

4. **Post-Call Analytics Dashboard**:
   - Automated structured JSON feedback reports with entity slot extraction, resolution status, and bilingual summaries saved to `backend/post-call-analysis/`.

5. **Multi-Model STT Benchmarking**:
   - Side-by-side comparison of multiple STT engines on the same audio recording.
   - 3-modality output: Devanagari Hindi, Romanised Hinglish, and English translation.

---

## 🏗️ Architecture

```
User Voice Input (WebM/WAV)
       ↓
STT Layer (IndicConformer ONNX / Groq Whisper)
       ↓
Groq LLM Reasoning Engine (Multi-turn Persona Context)
       ↓
Neural TTS Synthesis (Edge-TTS / gTTS / pyttsx3)
       ↓
Base64 Audio Stream Player + Live Telemetry & Post-Call Feedback Extraction
```

---

## 🚀 Quick Start

### 1. Backend Setup (FastAPI)

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Configure your Groq API key in backend/.env
echo "GROQ_API_KEY=your_groq_api_key" > .env
echo "GROQ_MODEL=qwen/qwen3.8-27b" >> .env

# Run FastAPI Server
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

- **API Docs**: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

### 2. Frontend Setup (React + Vite)

```bash
cd frontend
npm install
npm run dev
```

- **Frontend App**: [http://localhost:3000](http://localhost:3000)

---

## ⚙️ Environment Variables (`backend/.env`)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `GROQ_API_KEY` | `""` | Required for Groq LLM & Groq Whisper STT |
| `GROQ_MODEL` | `qwen/qwen3.8-27b` | Primary Groq conversational LLM |
| `TTS_VOICE` | `en-IN-NeerjaNeural` | Default Edge-TTS voice |
| `TTS_ENGINE` | `edge-tts` | Default TTS provider (`edge-tts`, `gtts`, `pyttsx3`) |
| `DEFAULT_MODEL` | `indic-conformer-onnx` | Default STT engine |
