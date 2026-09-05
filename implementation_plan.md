# Comprehensive Low-Latency Voice Assistant Architecture & Latency Reduction Plan ($0 Cost)

## Overview & Goals

This plan outlines the architecture and optimization strategy to transform the **Hindi/Hinglish STT Benchmark** into a **sub-second, ultra-low-latency conversational voice assistant** operating entirely at **$0 cost**, tailored specifically for execution on an **office laptop** (CPU-bound, corporate network proxies, thermal/RAM constraints).

### Key Constraints & Environment Considerations:
1. **Office Laptop Hardware**: Standard multi-core CPU (Intel i5/i7 or AMD Ryzen), limited/no CUDA GPU, 8-16GB RAM. High thermal throttling risk when running heavy local PyTorch models.
2. **Corporate Environment**: Corporate SSL inspection (Zscaler, Fortinet, Netskope) requiring proxy-safe network requests.
3. **Zero-Cost Mandate ($0)**: All cloud services must utilize generous free tiers with no credit card requirement.
4. **Latency Target**: Sub-1 second end-to-end voice-to-voice turn (Speech-to-Text → LLM Reasoning → Text-to-Speech).

---

## Technical Latency Breakdown & Target Budget

| Stage | Baseline (Local Faster-Whisper CPU) | Proposed Cloud-Accelerated Architecture | Target Latency |
| :--- | :--- | :--- | :--- |
| **Audio Capture & VAD** | Client records full audio clip (manual stop or long silence) | WebAudio / Silero VAD (Client-side fast silence trim) | ~150 - 200 ms |
| **STT (Speech-to-Text)** | Local `faster-whisper-large-v3` on CPU (~3,000 - 8,000 ms) | **Groq Cloud API (`whisper-large-v3-turbo`)** | **~150 - 250 ms** |
| **LLM Inference** | N/A (or slow local 7B model on CPU) | **Groq Cloud API (`llama-3.3-70b-versatile`)** / **Gemini 2.5 Flash** (Streaming) | **~150 - 200 ms (TTFT)** |
| **TTS (Speech Synth)** | N/A | **Edge-TTS Neural Voice** (Streamed MP3) / **Web Speech API** | **~200 - 300 ms** |
| **Total End-to-End** | **> 5,000 ms (Unusable for live voice)** | **Sub-Second Streaming Pipeline** | **~650 - 950 ms** |

---

## User Review Required

> [!IMPORTANT]
> **API Keys Required ($0 Cost)**:
> 1. **Groq Cloud API Key**: Required for zero-cost sub-200ms Whisper STT & LLaMA 3.3 70B LLM inference. (Free signup at `console.groq.com`).
> 2. **Google Gemini API Key (Optional Backup)**: Required if using Gemini 2.5 Flash as an alternative free LLM engine.

> [!NOTE]
> **Office Laptop Fallback Strategy**:
> If the office laptop is disconnected from the internet or corporate VPN blocks cloud API endpoints, the system will seamlessly auto-fallback to the local **AI4Bharat IndicConformer (Sherpa-ONNX INT8)** model (~200ms CPU latency).

---

## Architecture & Proposed Changes

```mermaid
flowchart TD
    subgraph Client [Browser - React Frontend]
        Mic[Microphone Input] --> VAD[Client-Side VAD / Audio Chunking]
        VAD --> WS_Out[WebSocket / HTTP Stream]
        WS_In[Audio Stream Player / Speech Synth] <-- WebSpeech / Audio Element
    end

    subgraph Office Laptop Backend [FastAPI Server]
        WS_Out --> Router[FastAPI Router & Pipeline Orchestrator]
        Router --> STT_Selector{Network Status?}
        
        STT_Selector -->|Online| GroqSTT[Groq Fast Whisper Provider]
        STT_Selector -->|Offline / Fallback| ONNX_STT[Sherpa-ONNX IndicConformer Provider]
        
        GroqSTT --> LLM[Streaming LLM Provider - Groq LLaMA 3.3 / Gemini]
        ONNX_STT --> LLM
        
        LLM -->|Streamed Tokens| SSE[SSE / WebSocket Engine]
        SSE -->|Tokens| Client
        
        LLM --> TTS[Edge-TTS Provider]
        TTS -->|Audio Chunk Stream| WS_In
    end

    subgraph Free Cloud Services [$0 Cost Cloud Layer]
        GroqSTT <--> GroqWhisper[Groq Cloud API: whisper-large-v3-turbo]
        LLM <--> GroqLLM[Groq Cloud API: llama-3.3-70b-versatile]
        TTS <--> EdgeTTS[Microsoft Edge Neural Speech Service]
    end
```

---

### Component Breakdown

#### 1. Cloud STT Provider: Groq Fast Whisper API Provider
#### [NEW] [`groq_whisper_provider.py`](file:///c:/Users/recab/Desktop/work/dev_docs/riyay/cnh/hindi-stt-benchmark/backend/app/stt/groq_whisper_provider.py)

- **Goal**: Implement `STTProvider` interface using `groq` python SDK or `httpx` asynchronous HTTP requests targeting `whisper-large-v3-turbo` or `whisper-large-v3`.
- **Features**:
  - Outbound proxy SSL tolerance for corporate firewalls (Zscaler / Fortinet bypass integration matching [`indic_conformer_provider.py`](file:///c:/Users/recab/Desktop/work/dev_docs/riyay/cnh/hindi-stt-benchmark/backend/app/stt/indic_conformer_provider.py#L12-L19)).
  - Real-Time Factor (RTF) tracking (< 0.05x).
  - Audio pre-compression (convert webm/wav to 16kHz mono lightweight buffer prior to POST upload).

#### 2. Streaming LLM Service Layer
#### [NEW] [`llm_provider.py`](file:///c:/Users/recab/Desktop/work/dev_docs/riyay/cnh/hindi-stt-benchmark/backend/app/llm/llm_provider.py)

- **Goal**: Provide ultra-fast streaming conversational responses for customer feedback analysis & voice assistant interaction.
- **Provider Options ($0 Cost)**:
  - **Groq LLaMA 3.3 70B Versatile** (Primary): Inference speed ~500+ tokens/sec. TTFT (Time To First Token) ~150ms.
  - **Gemini 2.5 Flash** (Secondary): Strong Hinglish understanding & zero-cost tier.
- **System Prompt Design**: System prompts tuned specifically for concise, natural Hindi/Hinglish spoken output (1-2 sentences max for voice loop to minimize TTS latency).

#### 3. Free Neural TTS Engine
#### [NEW] [`tts_provider.py`](file:///c:/Users/recab/Desktop/work/dev_docs/riyay/cnh/hindi-stt-benchmark/backend/app/tts/tts_provider.py)

- **Goal**: Convert LLM streamed text into clear Hindi/Hinglish speech with zero API costs.
- **Implementation**:
  - **Edge-TTS (`edge-tts`)**: Wraps Microsoft Edge neural TTS. Free, no rate limit issues, zero cost.
  - Voice selection: `hi-IN-SwaraNeural` (Hindi Female), `hi-IN-MadhurNeural` (Hindi Male), or `en-IN-NeerjaNeural` (Indian English/Hinglish).
  - Sentence-chunked audio synthesis: As soon as the LLM yields a punctuation mark (`.`, `?`, `!`, `।`), send that sentence to TTS immediately without waiting for full LLM completion.

#### 4. Office Laptop Optimization & FastAPI Streaming Pipeline
#### [MODIFY] [`main.py`](file:///c:/Users/recab/Desktop/work/dev_docs/riyay/cnh/hindi-stt-benchmark/backend/app/main.py)
#### [NEW] [`pipeline_router.py`](file:///c:/Users/recab/Desktop/work/dev_docs/riyay/cnh/hindi-stt-benchmark/backend/app/api/pipeline_router.py)

- **FastAPI Endpoints**:
  - `/api/voice-assistant/stream`: Server-Sent Events (SSE) or WebSocket route handling real-time audio chunk upload -> STT -> LLM streaming -> TTS stream.
  - CPU & Thermal Protection: Offloads heavy computation to Groq Cloud while maintaining lightweight local ONNX runtime for fallback.

---

## Implementation Roadmap & Sequence

1. **Phase 1: Groq Cloud STT Integration (`groq_whisper_provider.py`)**
   - Implement Groq Whisper provider in backend registry.
   - Benchmark Groq Cloud Whisper vs Local Sherpa-ONNX vs Local Faster-Whisper on sample Hindi/Hinglish audio.
2. **Phase 2: Free LLM Integration & Streaming Engine (`llm_provider.py`)**
   - Add Groq LLaMA 3.3 70B & Gemini Flash streaming integration.
   - Craft low-latency Hinglish persona prompts.
3. **Phase 3: Zero-Cost Neural TTS (`tts_provider.py`)**
   - Integrate `edge-tts` with sentence-based chunking.
   - Add browser-side Web Speech API fallback.
4. **Phase 4: Full Sub-Second Conversational Pipeline**
   - Connect Client VAD + Groq STT + Streaming LLM + Chunked TTS in WebSocket/SSE endpoint.
   - Verify performance and latency on the office laptop.

---

## Verification Plan

### Automated Verification
- Run backend latency test script benchmarking:
  - `groq-whisper-large-v3` response time vs audio length.
  - LLM Time-to-First-Token (TTFT).
  - TTS sentence generation time.

### Manual Verification
- Test interactive voice dialogue in the frontend interface.
- Confirm full round-trip speech-to-speech latency stays under 1.0 second on office Wi-Fi / corporate proxy network.
