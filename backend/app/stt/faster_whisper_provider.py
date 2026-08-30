import time
from typing import Dict, Any
from faster_whisper import WhisperModel
from app.stt.base import STTProvider

# Known Whisper hallucinations on silence / non-speech noise
HALLUCINATIONS = {
    "thank you.", "thank you", "thanks for watching.", "thanks for watching!",
    "subtitles by", "subtitles by the amara.org community", "amara.org",
    "you", "bye.", "bye", "subscribe", "please subscribe", "...", "."
}

class FasterWhisperProvider(STTProvider):
    def __init__(self, model_size: str = "large-v3", device: str = "auto", compute_type: str = "auto"):
        print(f"Loading faster-whisper ({model_size}) on device '{device}'...")
        # 'auto' selects CUDA if available, otherwise CPU (with int8 quantization for speed)
        self.model = WhisperModel(model_size, device=device, compute_type=compute_type)
        print("Model loaded successfully.")

    def transcribe(self, audio_path: str, language: str = None) -> Dict[str, Any]:
        start_time = time.time()

        try:
            # Enable VAD filter to strip leading/trailing silence and prevent hallucinations
            segments, info = self.model.transcribe(
                audio_path,
                beam_size=5,
                language=language if language else None,
                task="transcribe",
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=400, speech_pad_ms=200),
                condition_on_previous_text=False
            )

            # Combine transcribed segments
            transcript_text = " ".join([segment.text for segment in segments]).strip()
            
            # Check for known silence hallucinations
            if transcript_text.lower().strip() in HALLUCINATIONS:
                transcript_text = ""

            duration = round(info.duration, 2) if (info and info.duration) else 0.0

        except Exception as e:
            print(f"Whisper transcription warning: {e}")
            transcript_text = ""
            duration = 0.0

        processing_time = time.time() - start_time

        return {
            "transcript": transcript_text,
            "audio_duration": duration,
            "processing_time": round(processing_time, 2)
        }