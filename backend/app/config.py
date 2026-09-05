import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
# Load .env file if present
load_dotenv(BASE_DIR / ".env")

RECORDINGS_DIR = BASE_DIR / "recordings"
RESULTS_DIR = BASE_DIR / "results"
DEFAULT_MODEL = "indic-conformer-onnx"

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
DEFAULT_VOICE_LANGUAGE = "hi"

RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

VOICE_ASSISTANT_SYSTEM_PROMPT = (
    "You are a helpful, courteous customer service voice assistant. "
    "Respond in clear, conversational Hindi (or Hinglish if the user asks in Hinglish). "
    "Keep your answers concise (1 to 2 sentences maximum), friendly, and direct, suitable for speech synthesis."
)

__all__ = [
    "BASE_DIR",
    "RECORDINGS_DIR",
    "RESULTS_DIR",
    "DEFAULT_MODEL",
    "GROQ_API_KEY",
    "GROQ_MODEL",
    "DEFAULT_VOICE_LANGUAGE",
    "VOICE_ASSISTANT_SYSTEM_PROMPT",
]

