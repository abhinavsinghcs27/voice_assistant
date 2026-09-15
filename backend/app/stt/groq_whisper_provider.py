import asyncio
import io
import time
import mimetypes
from typing import Dict, Any

import httpx

from app.stt.base import STTProvider
from app.config import GROQ_API_KEY

GROQ_WHISPER_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
DEFAULT_GROQ_WHISPER_MODEL = "whisper-large-v3-turbo"


class GroqWhisperProvider(STTProvider):
    """
    Cloud STT via Groq's whisper-large-v3-turbo (executed on Groq GPU).
    Uploads raw audio bytes directly to the REST endpoint — no local model, no disk file.
    """

    def __init__(self, model: str = DEFAULT_GROQ_WHISPER_MODEL, api_key: str = None):
        if not (api_key or GROQ_API_KEY):
            raise ValueError("GROQ_API_KEY is required for Groq Whisper STT.")
        self.model = model
        self.api_key = api_key or GROQ_API_KEY
        self._client = httpx.AsyncClient()

    async def _transcribe_data(self, audio_data: bytes, content_type: str, language: str = None) -> Dict[str, Any]:
        start_time = time.time()
        text = ""
        duration = 0.0
        try:
            files = {"file": ("audio.webm", audio_data, content_type or "audio/webm")}
            data = {"model": self.model}
            if language:
                data["language"] = language
            response = await self._client.post(
                GROQ_WHISPER_URL,
                headers={"Authorization": f"Bearer {self.api_key}"},
                files=files,
                data=data,
                timeout=60.0
            )
            response.raise_for_status()
            payload = response.json()
            text = (payload.get("text") or "").strip()
        except Exception as e:
            print(f"Groq Whisper transcription error: {e}")
        return {
            "transcript": text,
            "audio_duration": duration,
            "processing_time": round(time.time() - start_time, 3)
        }

    async def transcribe_buffer(self, audio_data: bytes, language: str = None) -> Dict[str, Any]:
        """Transcribe raw audio bytes fully in memory (cloud round-trip, no disk)."""
        return await self._transcribe_data(audio_data, "audio/webm", language)

    async def transcribe_async(self, audio_path: str, language: str = None) -> Dict[str, Any]:
        """Async path used by the benchmark endpoint (audio already on disk)."""
        with open(audio_path, "rb") as f:
            audio_data = f.read()
        return await self._transcribe_data(
            audio_data,
            mimetypes.guess_type(audio_path)[0] or "audio/webm",
            language
        )

    def transcribe(self, audio_path: str, language: str = None) -> Dict[str, Any]:
        """Sync wrapper (only safe outside a running event loop)."""
        return asyncio.run(self.transcribe_async(audio_path, language))