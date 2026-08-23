# Hindi/Hinglish STT Benchmark Project Context

## 1. Project Goal

This project is a speech-to-text benchmarking and evaluation system focused on Hindi and Hinglish audio. The primary goal is to reliably transcribe customer/service-call audio and compare different STT models on the same recording.

The project is intentionally structured to evolve in phases:

1. Phase 1: Build a stable, production-like STT foundation.
2. Phase 2: Benchmark multiple models on the same audio.
3. Phase 3: Add Gemini-based analysis after STT.
4. Phase 4: Add free Hindi/Hinglish TTS.
5. Phase 5: Build a full conversational feedback agent.
6. Phase 6: Emit structured feedback JSON for downstream use.

Important: do not implement Phases 2–6 before Phase 1 is highly reliable.

---

## 2. Current State of the Project

The project has been started with a FastAPI backend and a modular STT provider architecture.

### Current backend structure

```text
hindi-stt-benchmark/
  backend/
    app/
      __init__.py
      config.py
      main.py
      stt/
        __init__.py
        base.py
        faster_whisper_provider.py
    recordings/
    results/
    requirements.txt
    venv/
  frontend/
```

### What exists already

- FastAPI application in `backend/app/main.py`
- STT abstraction in `backend/app/stt/base.py`
- Faster Whisper implementation in `backend/app/stt/faster_whisper_provider.py`
- configuration constants in `backend/app/config.py`
- audio upload endpoint for transcription
- model metadata endpoint
- result persistence to disk
- benchmark endpoint that runs multiple models on one audio input

### Core functionality already implemented

- Accept uploaded audio via HTTP
- Save uploaded file to disk
- Run transcription with a selected STT model
- Return transcript and timing data in JSON
- Save results as a JSON file in the `results/` directory
- Provide model list metadata to frontend clients

---

## 3. Architecture Overview

### Backend

The backend is designed around a modular audio transcription pipeline.

#### Primary components

- `app/main.py`
  - API routes
  - model registry
  - benchmark orchestration
  - file handling
  - request validation

- `app/config.py`
  - stores directories for recordings and results
  - defines default model configuration

- `app/stt/base.py`
  - abstract provider contract for STT backends

- `app/stt/faster_whisper_provider.py`
  - concrete provider that wraps `faster-whisper`

### Data flow

```text
Audio upload
  ↓
Validate input
  ↓
Save audio to recordings/
  ↓
Load STT provider
  ↓
Transcribe audio
  ↓
Return transcript and timing metrics
  ↓
Persist result JSON in results/
```

---

## 4. Project Purpose in Business Terms

This project is intended to support customer support and service-quality workflows for Hindi/Hinglish conversations, especially where speech is the main input channel. It can later evolve into:

- call evaluation
- customer sentiment analysis
- agent performance scoring
- feedback summarization
- voice-based AI support assistant

---

## 5. Product Vision Across Phases

### Phase 1: Reliable foundational STT pipeline

Focus areas:

- robust upload handling
- clear validation rules
- reliable model initialization
- consistent transcript output
- stable error handling
- file cleanup on failure
- logging + reproducibility
- deterministic response structure

This is the highest priority because all later phases depend on the STT layer being trustworthy.

### Phase 2: Benchmark multiple STT models

Purpose:

- upload one audio file
- run several STT engines
- collect transcripts and timings
- compare outputs and performance metrics

Expected output:

- one benchmark result set with multiple models
- processing time comparison
- real-time factor (RTF)
- transcript comparison for same input

### Phase 3: Add Gemini

Flow:

```text
STT → Gemini → Response
```

Purpose:

- analyze the transcript using Gemini
- classify, summarize, or reason over customer problems
- produce a response or next-step recommendation

### Phase 4: Add free Hindi/Hinglish TTS

Flow:

```text
STT → Gemini → TTS
```

Purpose:

- speak AI-generated responses in Hindi/Hinglish
- make the system conversational and voice-based
- support service feedback and coaching scenarios

### Phase 5: Full conversational feedback agent

Flow:

```text
Customer
  ↓
STT
  ↓
Gemini feedback logic
  ↓
TTS
  ↓
Customer
```

Purpose:

- create a looped voice AI that listens to customer experience feedback
- evaluate the customer message
- respond in voice
- support a conversational, full-turn interaction

### Phase 6: Structured feedback JSON

Purpose:

- make results machine-readable
- enable dashboards, reporting, downstream systems, and record keeping

Example output:

```json
{
  "overall_rating": 4,
  "sentiment": "positive",
  "agent_helpfulness": "positive",
  "resolution": "resolved",
  "pain_points": [
    "Long waiting time"
  ],
  "improvement_suggestions": [
    "Reduce processing time"
  ]
}
```

---

## 6. Important Engineering Rule

Do not implement Phase 2 through Phase 6 before Phase 1 is extremely reliable.

This project should not jump to advanced AI features before the foundational STT backend is robust, testable, and repeatable.

---

## 7. Recommended Build Sequence

1. Stabilize the upload pipeline
2. Confirm the STT model loading path works reliably
3. Validate transcript output on real Hindi/Hinglish sample audio
4. Test failure scenarios consistently
5. Add benchmark comparison across models
6. Add Gemini analysis after transcript generation
7. Add TTS for spoken responses
8. Add conversational loop for live feedback agent
9. Add structured feedback schema and evaluation outputs

---

## 8. Implementation Guidance for Rebuilding from Scratch on Another Device

Use this document as a blueprint when recreating the project elsewhere.

### Required software

- Python 3.10+
- virtual environment
- FastAPI
- uvicorn
- python-multipart
- pydantic
- faster-whisper

### Installation pattern

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

On Windows PowerShell:

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### Run the backend

```bash
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Expected project mindset

When building from scratch with a different AI or on another machine:

- keep the architecture modular
- keep STT as a pluggable provider layer
- separate configuration and runtime folders
- keep results and recordings in explicit filesystem locations
- prefer a clean API contract over ad hoc logic
- treat reliability as the top priority

---

## 9. Recommended Future Enhancement Notes

- Add tests for upload validation and file cleanup
- Add logging for every transcription attempt
- Track model name, transcript, timing, and file metadata together
- Add a health check endpoint
- Add versioning for model configs and benchmark outputs
- Add frontend UI for comparing benchmark results side by side
- Introduce Gemini as a separate service layer rather than embedding it inside the main route logic
- Keep TTS separate from STT and LLM logic for easier testing

---

## 10. Summary

This project is a Hindi/Hinglish STT benchmarking system that is evolving toward a full AI-powered conversation and feedback workflow. The current implementation is a strong start, but the correct engineering priority is Phase 1: make the STT pipeline extremely reliable before moving into benchmarking, Gemini analysis, TTS, and conversational AI.

The project is intentionally modular and should be straightforward to re-create on another machine by following the structure and architecture laid out here.
