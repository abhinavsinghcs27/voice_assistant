import time
from typing import Dict, Any
from faster_whisper import WhisperModel
from app.stt.base import STTProvider

class FasterWhisperProvider(STTProvider):
    def __init__(self, model_size: str = "large-v3", device: str = "auto", compute_type: str = "auto"):
        print(f"Loading faster-whisper ({model_size}) on device '{device}'...")
        # 'auto' selects CUDA if available, otherwise CPU (with int8 quantization for speed)
        self.model = WhisperModel(model_size, device=device, compute_type=compute_type)
        print("Model loaded successfully.")

    def transcribe(self, audio_path: str, language: str = None) -> Dict[str, Any]:
        start_time = time.time()

        # beam_size=5 produces the highest accuracy for Hindi/Hinglish code-mixing
        segments, info = self.model.transcribe(
            audio_path,
            beam_size=5,
            language=language if language else None,
            task="transcribe"
        )

        # Combine transcribed segments
        transcript_text = " ".join([segment.text for segment in segments]).strip()
        processing_time = time.time() - start_time

        return {
            "transcript": transcript_text,
            "audio_duration": round(info.duration, 2) if info.duration else 0.0,
            "processing_time": round(processing_time, 2)
        }