import asyncio
import io
import time
import logging
import tempfile
import os
import re
import ssl
import numpy as np
import av
from faster_whisper.audio import decode_audio

# Attempt to import all three TTS backends
import edge_tts

try:
    from gtts import gTTS
    HAS_GTTS = True
except ImportError:
    HAS_GTTS = False

try:
    import pyttsx3
    HAS_PYTTSX3 = True
except ImportError:
    HAS_PYTTSX3 = False

from app.config import (
    DEFAULT_TTS_VOICE_HINDI,
    DEFAULT_TTS_VOICE_ENGLISH,
    TTS_RATE,
    DEFAULT_TTS_ENGINE
)

logger = logging.getLogger("multi_engine_tts_provider")

SENTENCE_SPLIT_RE = re.compile(r'(?<=[.!?।\n])\s+')
MAX_CONCURRENT_FRAGMENTS = 3

RATE = TTS_RATE
SAMPLE_RATE = 16000
TRIM_PAD_S = 0.06          # keep 60ms of silence at fragment edges
JOIN_GAP_S = 0.14          # natural pause inserted between joined fragments


def is_devanagari(text: str) -> bool:
    """Check if the text contains Devanagari characters (Hindi script)."""
    return bool(re.search(r'[\u0900-\u097F]', text))


def split_sentences(text: str) -> list:
    """Split text into sentence fragments at `.`, `!`, `?`, `\n`, and `।` boundaries."""
    parts = [p.strip() for p in SENTENCE_SPLIT_RE.split(text)]
    return [p for p in parts if p]


def _trim_edges_f32(samples: np.ndarray) -> np.ndarray:
    """Cut leading/trailing silence from a fragment."""
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
    """Trim each fragment's margins then stitch with short gaps, re-encoding to MP3."""
    parts = []
    gap = np.zeros(int(JOIN_GAP_S * SAMPLE_RATE))
    for i, fragment_bytes in enumerate(fragments):
        if not fragment_bytes:
            continue
        raw = decode_audio(io.BytesIO(fragment_bytes), sampling_rate=SAMPLE_RATE)
        if i and len(parts) > 0:
            parts.append(gap)
        parts.append(_trim_edges_f32(raw))
    if not parts:
        return b""
    audio = np.concatenate(parts)
    return _encode_mp3_f32(audio)


class MultiEngineTTSProvider:
    """
    Unified Multi-Engine TTS Provider supporting:
    1. Microsoft Edge Neural (hi-IN-SwaraNeural / en-IN-NeerjaNeural) with progressive sentence chunking
    2. Google TTS (gTTS) with global SSL unverified context patch for corporate proxies
    3. Local OS Engine (pyttsx3 / SAPI5) for 100% offline synthesis with zero network calls
    """

    def __init__(self, default_engine: str = DEFAULT_TTS_ENGINE):
        self.default_engine = default_engine
        self.hindi_voice = DEFAULT_TTS_VOICE_HINDI
        self.english_voice = DEFAULT_TTS_VOICE_ENGLISH
        self.rate = TTS_RATE

    def get_supported_engines(self) -> list:
        return [
            {
                "id": "edge-tts",
                "name": "Microsoft Edge Neural",
                "voices": ["hi-IN-SwaraNeural", "en-IN-NeerjaNeural"],
                "description": "Natural neural voice with sentence-chunked streaming",
                "is_offline": False,
                "available": True
            },
            {
                "id": "gtts",
                "name": "Google TTS (gTTS)",
                "voices": ["hi (Hindi)", "en (English)"],
                "description": "Standard HTTPS TTS with corporate SSL tolerance",
                "is_offline": False,
                "available": HAS_GTTS
            },
            {
                "id": "pyttsx3",
                "name": "Local OS Engine (SAPI5 / pyttsx3)",
                "voices": ["System Default SAPI5"],
                "description": "Completely offline TTS, 0 network calls, proxy/firewall immune",
                "is_offline": True,
                "available": HAS_PYTTSX3
            }
        ]

    def _select_edge_voice(self, text: str, lang: str | None, voice_override: str | None = None) -> str:
        if voice_override:
            return voice_override
        if lang and lang.startswith("hi"):
            return self.hindi_voice
        if is_devanagari(text):
            return self.hindi_voice
        return self.english_voice

    def _sanitize(self, text: str) -> str:
        text = text.replace("—", ", ").replace("–", ", ").replace("-", " ")
        text = re.sub(r"\s+", " ", text).strip()
        return text

    async def _synth_edge_bytes(self, text: str, voice: str) -> bytes:
        communicator = edge_tts.Communicate(text, voice, rate=self.rate)
        buffer = io.BytesIO()
        async for chunk in communicator.stream():
            if chunk.get("type") == "audio":
                buffer.write(chunk["data"])
        return buffer.getvalue()

    async def _synth_edge_async(self, text: str, voice: str) -> bytes:
        for attempt in range(2):
            try:
                return await self._synth_edge_bytes(text, voice)
            except Exception as e:
                logger.warning(f"edge-tts attempt {attempt + 1} failed: {e}")
                await asyncio.sleep(0.2)
        # Temp file fallback
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp:
            temp_path = tmp.name
        try:
            await edge_tts.Communicate(text, voice, rate=self.rate).save(temp_path)
            with open(temp_path, "rb") as f:
                return f.read()
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    def _synth_gtts_sync(self, text: str, lang: str = "en") -> bytes:
        if not HAS_GTTS:
            raise RuntimeError("gTTS package is not installed.")
        # Ensure SSL verification is bypassed for corporate proxies
        try:
            ssl._create_default_https_context = ssl._create_unverified_context
        except Exception:
            pass
        target_lang = "hi" if (lang and lang.startswith("hi")) or is_devanagari(text) else "en"
        tts = gTTS(text=text, lang=target_lang, slow=False)
        fp = io.BytesIO()
        tts.write_to_fp(fp)
        return fp.getvalue()

    def _synth_pyttsx3_sync(self, text: str) -> bytes:
        if not HAS_PYTTSX3:
            raise RuntimeError("pyttsx3 package is not installed.")
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
            temp_path = tmp.name
        try:
            engine = pyttsx3.init()
            engine.setProperty('rate', 170)
            engine.save_to_file(text, temp_path)
            engine.runAndWait()
            with open(temp_path, "rb") as f:
                raw_wav = f.read()
            raw_audio = decode_audio(io.BytesIO(raw_wav), sampling_rate=SAMPLE_RATE)
            return _encode_mp3_f32(raw_audio)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    async def synthesize(
        self,
        text: str,
        lang: str = None,
        engine: str = None,
        voice: str = None
    ) -> dict:
        """
        Synthesizes text using the chosen engine (edge-tts, gtts, pyttsx3).
        Defaults to Edge-TTS with sentence-chunked progressive streaming.
        """
        start_time = time.time()
        chosen_engine = (engine or self.default_engine).lower().strip()

        if not text or not text.strip():
            text = "Kripya punah bolein."

        sanitized_text = self._sanitize(text)

        try:
            if chosen_engine == "pyttsx3" and HAS_PYTTSX3:
                audio_bytes = await asyncio.to_thread(self._synth_pyttsx3_sync, sanitized_text)
            elif chosen_engine == "gtts" and HAS_GTTS:
                audio_bytes = await asyncio.to_thread(self._synth_gtts_sync, sanitized_text, lang)
            else:
                # Default: Edge-TTS with sentence-chunked concurrent synthesis
                selected_voice = self._select_edge_voice(sanitized_text, lang, voice)
                sentences = split_sentences(sanitized_text)
                if not sentences:
                    sentences = [sanitized_text]

                sem = asyncio.Semaphore(MAX_CONCURRENT_FRAGMENTS)

                async def synth_frag(fragment: str) -> bytes:
                    async with sem:
                        return await self._synth_edge_async(fragment, selected_voice)

                fragments = await asyncio.gather(*(synth_frag(s) for s in sentences))
                audio_bytes = await asyncio.to_thread(_trim_and_join, fragments)

            elapsed = round(time.time() - start_time, 3)
            return {
                "audio_bytes": audio_bytes,
                "mime_type": "audio/mp3",
                "processing_time": elapsed,
                "engine_used": chosen_engine
            }
        except Exception as e:
            logger.warning(f"Engine {chosen_engine} failed: {e}. Falling back to default edge-tts.")
            try:
                selected_voice = self._select_edge_voice(sanitized_text, lang, voice)
                audio_bytes = await self._synth_edge_async(sanitized_text, selected_voice)
                elapsed = round(time.time() - start_time, 3)
                return {
                    "audio_bytes": audio_bytes,
                    "mime_type": "audio/mp3",
                    "processing_time": elapsed,
                    "engine_used": "edge-tts-fallback"
                }
            except Exception as final_e:
                raise RuntimeError(f"Speech synthesis completely failed: {final_e}")


# Maintain backward compatibility alias
GTTSProvider = MultiEngineTTSProvider