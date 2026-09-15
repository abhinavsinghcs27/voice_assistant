# Optimal Implementation Plan — Latency & Architecture Roadmap

> Replaces the previous 4-target plan (instant greeting, chat UI, post-call folder, two-button flow — **all shipped & verified**).

## How to read this plan

The "given options" (architectural modules) are first **reality-checked against the actual code**, then ranked by **ROI = impact ÷ effort** and split into an **optimized near-term plan (P0/P1)** plus a **future roadmap (P2→P6)**.

Primary metric: **time from end-of-speech to first audible assistant sound** (per-turn critical path):

```
current:  STT → LLM → TTS → telemetry        ≈ 2.2–3.5s + telemetry ~0.5s
target0:  STT → (LLM ∥ telemetry) → TTS(sync) ≈ 1.4–1.8s
target1:  STT → streamed (LLM → chunked TTS)  ≈ 0.9–1.2s TTFB
```

---

## A. Reality check of the listed modules (what's actually live)

| Breakdown item | Reality in code | Status |
|---|---|---|
| FastAPI async / CORS / multi-turn endpoints | `/interact`, `/finalize`, `/greet`, `/session/reset` | ✅ live |
| "In-memory `BytesIO` audio" | **False** — `interact` + `benchmark` write `/recordings` then delete; edge-tts uses `tempfile` | ⚠️ plumb bytes |
| Groq Whisper cloud STT (`whisper-large-v3-turbo`) | **Not present** — STT is local: conformer (default) + faster-whisper-large-v3/medium | ➕ optional |
| Local `faster-whisper` + `IndicConformer` | `stt/faster_whisper_provider.py`, `stt/indic_conformer_provider.py`, model-cached in `loaded_providers` | ✅ live |
| Groq LLM conversational engine | `llm/groq_provider.py` (`GROQ_MODELS` failover chain) | ✅ live |
| gTTS proxy-bypass + sentence-chunked streaming | **False** — `edge-tts` single-shot, no chunking, no gTTS | ➕ chunk/stream |
| MarianMT offline hi→en translation | **False** — `formatter.py` calls GoogleTranslator/MyMemory (network) every turn | ➕ offline/lazy |
| Session telemetry & per-turn latency | `session_manager.py` (in-memory) + telemetry LLM call | ✅ live (fix #1 below) |
| Browser hands-free UI + VAD | `App.jsx` — persistent mic, AnalyserNode silence (1.5s), auto-relisten | ✅ live |

---

## B. Optimal near-term plan — ranked by ROI

### P0-1 ⚡ Parallelize telemetry off the critical path (highest ROI, ~10 lines)
`backend/app/main.py` `voice_assistant_interact` runs telemetry extraction **serially after TTS**. Telemetry only needs `user_text` + `existing_history` (both known before the LLM call).
- Use `asyncio.gather(llm_res, telemetry_res)` before TTS.
- **Effect:** removes ~0.4–0.6s (the full telemetry LLM round-trip) from every turn at zero cost.
- Verify: inspect `latency.total_seconds` regression on clean audio.

### P0-2 ⚡ Streaming/chunked TTS (the single biggest latency block)
TTS is currently one edge-tts call on the whole assembled LLM reply (~1.2–1.5s for long answers, no audio until done).
- **Step 1 (sync-split, no protocol change):** sentence-split the finished LLM text (`.`, `?`, `!`, `।`) and synthesize sentences **concurrently** (bounded, e.g. 3 in-flight), concatenate in order → long replies drop to ~1 sentence-fragment time.
- **Step 2 (true streaming):** `groq_provider` switch to `stream=True`; push text as chunks into a small sentence-buffer; as each sentence completes, edge-tts emits the fragment → emit fragments in order (new `/flush`-style agg or per-fragment data-URLs). Frontend queues fragments on a single `<audio>` via blob segments or MSE.
- Verify: TTFB (first sound) ≈ first sentence TTS ≈ 0.3–0.5s.

### P0-3 ⚡ True in-memory audio (kill all temp-file I/O)
- `stt` providers: accept `AudioData` bytes → sherpa-ONNX (`read_sound_file` from `io.BytesIO`) / faster-whisper via `BytesIO`; drop `RECORDINGS_DIR` save/delete in `interact`. Keep disk only for the benchmark tab (or scope it too).
- `tts_provider.py:43`: replace `NamedTemporaryFile` with `edge_tts.Communicate.stream()` → accumulate bytes in `io.BytesIO`.
- **Effect:** removes write+read+unlink per turn (two places) and first-call temp fragility.

### P1-4 🛡️ Offline / lazy translation (remove network from the turn)
`format_speech_output` calls GoogleTranslator per turn (network, proxy-sensitive, adds latency + failure modes).
- Make English translation **lazy/optional**: compute romanised (already offline via ITRANS) always; fetch English only when the UI asks (or off by default in `interact`, on in benchmark).
- Optionally add a **local MarianMT** fallback (heavy — CPU model ~300MB) behind a feature flag for fully-offline operation.
- **Effect:** removes ~0.2–1s network variability and the corporate-proxy failure surface from every turn.

### P1-5 📦 Session + report persistence & GET endpoint
`session_manager` is in-memory → server restart loses `finalized_at`/`feedback_record`; re-finalize would duplicate.
- Persist session state → `backend/post-call-analysis/` sidecar (or a small SQLite `sessions.db`), replay on startup; keep JSONL untouched.
- Add `GET /api/voice-assistant/sessions/<id>` and `GET /api/reports` (list + fetch) for the UI.
- **Effect:** crash-safe idempotent finalize, report retrieval without file reads in the browser.

---

## C. Future phases & steps

### Phase 2 — Robustness (single-device hardening)
1. **STT fallback chain:** conformer → faster-whisper-medium → (flagged) cloud `whisper-large-v3-turbo` via Groq; trigger on low-confidence/blank transcript or RTF spikes. Keeps $0 cloud by default.
2. **Groq resilience:** per-model timeout+backoff, `max_tokens` tuning, retry taxonomy; log request-id on every turn.
3. **Health & metrics:** `GET /api/health` (model loaded, sessions, avg latencies); per-turn latency tags (STT/LLM/TTS/telemetry) → JSONL metrics file for the dashboard.
4. **Session GC:** TTL expiry + max-session cap to bound memory.

### Phase 3 — Reporting & analytics productization
1. Ingest `feedback_records.jsonl` into SQLite (or CS: store, query, export).
2. Dashboard panel (React): record history, sentiment distribution, CSAT means, escalation rate, RTF regression vs. model.
3. Export CSV/Excel + retention/cleanup policy on `recordings/`.

### Phase 4 — Concurrency & scale
1. Async-safe session store (replace module-level dict writes with a lock-free/DB-backed store) → supports multi-worker uvicorn.
2. Queue-based ingestion for burst (bounded concurrent turns; uploads streamed).
3. Optional cost switch: local (free) ↔ cloud (Groq whisper/TTS) per model tier; per-tenant config.

### Phase 5 — Quality & evaluation
1. **VAD tuning:** per-noise-profile silence thresholds; silence-burst trimming; utterance-length guardrails (avoid 200ms accidental submits).
2. **ASR consistency checks:** detect `"[Audio unclear]"` loops → proactive reprompt; transcript↔LLM grounding sanity.
3. **Regression harness:** automate the existing benchmark tab (fixed audio corpus) to track RTF/WER across model & code changes.

### Phase 6 — Deployment & productization
1. Package backend (`requirements.txt` pinned, `models/` bundled) → Docker image + systemd/PM2 run scripts.
2. Auth (device/persona key) + rate limiting + HTTPS; Vite build served from FastAPI (single-origin, no CORS).
3. Observability (trace id → STT/LLM/TTS spans) and structured logs; `.env.example` docs.
4. Offline-first mode: all-local stack (conformer + local translation + rule-based fallback LLM) for zero-internet kiosk use.

---

## File-change map (near-term P0/P1)

| File | P0-1 | P0-2 | P0-3 | P1-4 | P1-5 |
|---|---|---|---|---|---|
| `backend/app/main.py` | `asyncio.gather` | stream/agg wiring | in-mem transcribe | plumb lazy-translate | GET endpoints |
| `backend/app/llm/groq_provider.py` | — | `stream=True` | — | — | — |
| `backend/app/tts/tts_provider.py` | — | sentence-split + `stream()` | `StreamReader`→BytesIO | — | — |
| `backend/app/stt/*` | — | — | accept bytes | — | — |
| `backend/app/formatter.py` | — | — | — | lazy/offline EN | — |
| `backend/app/session_manager.py` | — | — | — | — | persistence |
| `backend/app/config.py` | — | — | — | `TRANSLATE_MODE` | DB/sidecar paths |
| `frontend/src/App.jsx` | — | queue fragments (MSE/segments) | — | EN on-demand | reports view |

## Verification gate (after P0)
1. Clean-audio turn: `latency.total_seconds` drops by the telemetry round-trip (P0-1).
2. First-sound TTFB ≈ first sentence (~0.3–0.5s) on multi-sentence replies (P0-2).
3. `RECORDINGS_DIR` untouched during `interact`; no temp files under `TMP` during TTS (P0-3).
4. Full loop still passes the two-button smoke test; finalize idempotent across a backend restart (P1-5).