import io
import time
import logging
from gtts import gTTS
import re

logger = logging.getLogger("gtts_provider")

def is_devanagari(text: str) -> bool:
    """Check if the text contains Devanagari characters (Hindi script)."""
    return bool(re.search(r'[\u0900-\u097F]', text))

class GTTSProvider:
    def __init__(self, default_lang: str = "hi"):
        self.default_lang = default_lang

    def synthesize(self, text: str, lang: str = None) -> dict:
        """
        Synthesizes text into MP3 audio in memory (io.BytesIO).
        Returns dict with: audio_bytes (bytes), mime_type, processing_time
        """
        start_time = time.time()
        
        if not text or not text.strip():
            text = "Kripya punah bolein."

        # Detect language based on script if not explicitly provided
        if not lang:
            if is_devanagari(text):
                selected_lang = "hi"
            else:
                selected_lang = "hi"  # gTTS handles Hinglish reasonably in Hindi accent or "en"

        try:
            tts = gTTS(text=text, lang=selected_lang, slow=False)
            fp = io.BytesIO()
            tts.write_to_fp(fp)
            fp.seek(0)
            audio_bytes = fp.read()
            
            elapsed_time = round(time.time() - start_time, 3)

            return {
                "audio_bytes": audio_bytes,
                "mime_type": "audio/mp3",
                "processing_time": elapsed_time
            }
        except Exception as e:
            logger.error(f"gTTS Synthesis failed for text '{text[:30]}...': {e}")
            # Fallback to English synthesis if Hindi fails
            try:
                tts = gTTS(text=text, lang="en", slow=False)
                fp = io.BytesIO()
                tts.write_to_fp(fp)
                fp.seek(0)
                audio_bytes = fp.read()
                elapsed_time = round(time.time() - start_time, 3)
                return {
                    "audio_bytes": audio_bytes,
                    "mime_type": "audio/mp3",
                    "processing_time": elapsed_time
                }
            except Exception as inner_e:
                raise RuntimeError(f"Speech synthesis completely failed: {inner_e}")
