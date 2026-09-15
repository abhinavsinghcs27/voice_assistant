import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
# Load .env file if present
load_dotenv(BASE_DIR / ".env")

RECORDINGS_DIR = BASE_DIR / "recordings"
RESULTS_DIR = BASE_DIR / "results"
POST_CALL_DIR = BASE_DIR / "post-call-analysis"
DEFAULT_MODEL = "indic-conformer-onnx"

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
DEFAULT_VOICE_LANGUAGE = "en"

# Natural neural voices (Edge-TTS). TTS_VOICE is the single override knob.
# Defaults: en-IN-NeerjaNeural for Hinglish/Latin text (assistant persona), hi-IN-SwaraNeural for Devanagari.
TTS_VOICE = os.getenv("TTS_VOICE", "en-IN-NeerjaNeural")
DEFAULT_TTS_VOICE_HINDI = os.getenv("TTS_VOICE_HINDI", "hi-IN-SwaraNeural")
DEFAULT_TTS_VOICE_ENGLISH = os.getenv("TTS_VOICE_ENGLISH", TTS_VOICE)
# Neutral speaking rate. Latency is fixed by trimming edge-tts's dead-air pads
# and stitching short gaps between sentences — NOT by making the voice faster.
TTS_RATE = os.getenv("TTS_RATE", "+0%")

RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
POST_CALL_DIR.mkdir(parents=True, exist_ok=True)

VOICE_ASSISTANT_SYSTEM_PROMPT = (
    "You are Vaani, a warm, professional customer service voice assistant for a payments company. "
    "LANGUAGE RULE (MANDATORY): Always reply in natural conversational Hinglish - Hindi words written "
    "in Latin/Roman script (e.g. 'kaise ho', 'thoda sa', 'bilkul theek hai') - or in Hindi or English. "
    "NEVER speak any other language (no Spanish, French, Germanic, Scandinavian, or any non-Indic language), "
    "and never mirror a foreign language even if the user seems to speak it or the transcript looks garbled. "
    "If the user's message appears garbled, silent, or is in a language other than Hindi/Hinglish/English, "
    "politely ask them to repeat themselves in Hinglish. "
    "Keep replies to 1-2 short, friendly sentences that read naturally aloud for speech synthesis, "
    "and never sound robotic or scripted."
)

GREETING_PROMPT = (
    "You are Vaani, a warm post-call customer feedback voice assistant for a payment services company. "
    "Greet the customer in exactly 1 short sentence, in Hindi or Hinglish, and invite them to share "
    "feedback about their recent experience. Keep it natural and friendly for speech synthesis."
)

GREETING_TEXT = (
    "Hey, I'm Vaani. Aapka recent experience smooth raha, ya koi dikkat aayi?"
)

FEEDBACK_EXTRACTION_PROMPT = (
    "You are a post-call transcript analyst for a customer service team. Analyze the full voice "
    "conversation transcript below and extract structured feedback. "
    "Output ONLY a valid JSON object with no markdown block markers, matching EXACTLY this schema:\n"
    '{\n'
    '  "schema_version": "1.0",\n'
    '  "aggregate_sentiment": "positive" | "neutral" | "negative",\n'
    '  "sentiment_score": float between -1.0 and 1.0,\n'
    '  "overall_satisfaction": integer between 1 and 5,\n'
    '  "primary_complaints": ["..."],\n'
    '  "positive_highlights": ["..."],\n'
    '  "suggestions": ["..."],\n'
    '  "key_topics": ["..."],\n'
    '  "follow_up_required": boolean,\n'
    '  "action_items": ["..."],\n'
    '  "resolution_status": "resolved" | "pending" | "escalated",\n'
    '  "summary_hindi": "2-3 sentence summary in Hindi",\n'
    '  "summary_english": "2-3 sentence summary in English"\n'
    "}\n"
    "Do not fabricate information not present in the transcript."
)

__all__ = [
    "BASE_DIR",
    "RECORDINGS_DIR",
    "RESULTS_DIR",
    "POST_CALL_DIR",
    "DEFAULT_MODEL",
    "GROQ_API_KEY",
    "GROQ_MODEL",
    "DEFAULT_VOICE_LANGUAGE",
    "DEFAULT_TTS_VOICE_HINDI",
    "DEFAULT_TTS_VOICE_ENGLISH",
    "TTS_RATE",
    "VOICE_ASSISTANT_SYSTEM_PROMPT",
    "GREETING_PROMPT",
    "GREETING_TEXT",
    "FEEDBACK_EXTRACTION_PROMPT",
]

