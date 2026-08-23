from abc import ABC, abstractmethod
from typing import Dict, Any

class STTProvider(ABC):
    @abstractmethod
    def transcribe(self, audio_path: str, language: str = None) -> Dict[str, Any]:
        """
        Transcribes an audio file.
        Returns a dict with:
        - transcript: str
        - audio_duration: float (in seconds)
        - processing_time: float (in seconds)
        """
        pass