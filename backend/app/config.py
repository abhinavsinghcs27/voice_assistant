from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
RECORDINGS_DIR = BASE_DIR / "recordings"
RESULTS_DIR = BASE_DIR / "results"
DEFAULT_MODEL = "faster-whisper-large-v3"

RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

__all__ = [
    "BASE_DIR",
    "RECORDINGS_DIR",
    "RESULTS_DIR",
    "DEFAULT_MODEL",
]
