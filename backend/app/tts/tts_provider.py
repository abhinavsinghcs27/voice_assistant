import asyncio
import io
import time
import logging
import tempfile
import os
import re
import edge_tts
import numpy as np
import av

from faster_whisper.audio import decode_audio

from app.config import DEFAULT_TTS_VOICE_HINDI, DEFAULT_TTS_VOICE_ENGLISH, TTS_RATE

logger = logging.getLogger("edge_tts_provider")

# Split text at sentence/clause boundaries for chunked streaming synthesis
SENTENCE_SPLIT_RE = re.compile(r'(?<=[.!?।])\s+')
MAX_CONCURRENT_FRAGMENTS = 3

# Post-processing: edge-tts pads ~0.7-1s of dead air at each sentence boundary.
# We trim fragment margins and stitch with a short, natural gap.
RATE = TTS_RATE
SAMPLE_RATE = 16000
TRIM_PAD_S = 0.06          # keep 60ms of silence at fragment edges
JOIN_GAP_S = 0.14          # natural pause inserted between joined fragments


def is_devanagari(text: str) -> bool:
    """Check if the text contains Devanagari characters (Hindi script)."""
    return bool(re.search(r'[\u0900-\u097F]', text))


def split_sentences(text: str) -> list:
    """Split text into sentence fragments at `.`, `!`, `?`, and `।` boundaries."""
    parts = [p.strip() for p in SENTENCE_SPLIT_RE.split(text)]
    return [p for p in parts if p]


def _trim_edges_f32(samples: np.ndarray) -> np.ndarray:
    """Cut leading/trailing silence from a fragment (absolute threshold trimmed by 60ms margin)."""
    if len(samples) == 0:
        return samples
    energy = np.abs(samples)
    threshold = max(energy.max() * 0.15, 0.001)
    mask = energy > threshold
    idx = np.where(mask)[0]
    if len(idx) == 0:
        return samples
    pad = int(TRIM_PAD_S * SAMPLE_RATE)
    start = max(idx[0] - pad, 0)
    end = min(idx[-1] + pad, len(samples))
    return samples[start:end]


def _encode_mp3_f32(samples: np.ndarray) -> bytes:
    """Encode float32 mono audio into MP3 bytes via PyAV (bundled ffmpeg)."""
    arr = np.clip(samples, -1.0, 1.0) * 32767
    arr16 = arr.astype(np.int16)
    buffer = io.BytesIO()
    container = av.open(buffer, "w", format="mp3")
    stream = container.add_stream("mp3", rate=SAMPLE_RATE)
    frame = av.AudioFrame(format="s16p", layout="mono", samples=len(arr16))
    frame.rate = SAMPLE_RATE
    frame.pts = 0
    frame.planes[0].update(arr16.tobytes())
    for pkg in stream.encode(frame):
        container.mux(pkg)
    for pkg in stream.encode(None):
        container.mux(pkg)
    container.close()
    return buffer.getvalue()


def _trim_and_join(fragments: list) -> bytes:
    """Trim each fragment's margins then stitch with short gaps, re-encoding to MP3.
    Removes edge-tts's padded dead air at sentence boundaries without touching speech."""
    parts = []
    gap = np.zeros(int(JOIN_GAP_S * SAMPLE_RATE))
    for i, fragment_bytes in enumerate(fragments):
        raw = decode_audio(io.BytesIO(fragment_bytes), sampling_rate=SAMPLE_RATE)
        if i:
            parts.append(gap)
        parts.append(_trim_edges_f32(raw))
    if not parts:
        return b""
    audio = np.concatenate(parts)
    return _encode_mp3_f32(audio)


class GTTSProvider:
    """Edge‑TTS based provider keeping the original GTTSProvider interface.

    Fully in-memory (no temp files) with sentence-chunked concurrent synthesis:
    fragments are synthesized in parallel and concatenated in order, so long
    replies stop at ~1 sentence-fragment time instead of the whole reply time.
    """

    def __init__(self, default_lang: str = "en"):
        self.default_lang = default_lang
        # Natural voice pair: Devanagari -> hi-IN-SwaraNeural (Hindi, female),
        # Latin/Hinglish -> en-IN-NeerjaNeural (Indian English, female).
        # Rate boost removes edge-tts's slow drawl.
        self.hindi_voice = DEFAULT_TTS_VOICE_HINDI
        self.english_voice = DEFAULT_TTS_VOICE_ENGLISH
        self.rate = TTS_RATE

    def _select_voice(self, text: str, lang: str | None) -> str:
        """Select the natural voice based on script/language."""
        if lang and lang.startswith("hi"):
            return self.hindi_voice
        if is_devanagari(text):
            return self.hindi_voice
        return self.english_voice

    def _sanitize(self, text: str) -> str:
        """Normalize punctuation that edge-tts reads awkwardly (dashes, spacing)."""
        text = text.replace("—", ", ").replace("–", ", ").replace("-", " ")
        text = re.sub(r"\s+", " ", text).strip()
        return text

    async def _synthesize_to_bytes(self, text: str, voice: str) -> bytes:
        """Synthesize text into raw MP3 bytes entirely in memory via edge-tts streaming."""
        communicator = edge_tts.Communicate(text, voice, rate=self.rate)
        buffer = io.BytesIO()
        async for chunk in communicator.stream():
            if chunk.get("type") == "audio":
                buffer.write(chunk["data"])
        return buffer.getvalue()

    async def _synthesize_async(self, text: str, voice: str) -> bytes:
        """In-memory edge-tts synthesis with retry + temp-file fallback."""
        last_error = None
        for attempt in range(2):
            try:
                return await self._synthesize_to_bytes(text, voice)
            except Exception as e:
                last_error = e
                logger.warning(f"edge-tts in-memory attempt {attempt + 1} failed ({text[:30]}...): {e}")
                await asyncio.sleep(0.3)
        logger.warning(f"edge-tts retries exhausted, using temp-file fallback: {last_error}")
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp:
            temp_path = tmp.name
        try:
            await edge_tts.Communicate(text, voice, rate=self.rate).save(temp_path)
            with open(temp_path, "rb") as f:
                audio_bytes = f.read()
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        return audio_bytes

    async def synthesize(self, text: str, lang: str = None) -> dict:
        """
        Synthesize text to MP3 using Edge-TTS.
        Async — must be awaited inside FastAPI/uvicorn event loop.
        Returns a dict with keys: audio_bytes, mime_type, processing_time.
        """
        start_time = time.time()

        if not text or not text.strip():
            text = "Kripya punah bolein."

        text = self._sanitize(text)
        voice = self._select_voice(text, lang)

        try:
            sentences = split_sentences(text)
            sem = asyncio.Semaphore(MAX_CONCURRENT_FRAGMENTS)

            async def synth_fragment(fragment: str) -> bytes:
                async with sem:
                    return await self._synthesize_async(fragment, voice)

            fragments = await asyncio.gather(*(synth_fragment(s) for s in sentences))
            audio_bytes = await asyncio.to_thread(_trim_and_join, fragments)

            elapsed_time = round(time.time() - start_time, 3)
            return {
                "audio_bytes": audio_bytes,
                "mime_type": "audio/mp3",
                "processing_time": elapsed_time,
            }
        except Exception as e:
            logger.error(f"Edge‑TTS synthesis failed for text '{text[:30]}...': {e}")
            raise RuntimeError(f"Speech synthesis failed: {e}")