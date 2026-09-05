import os
import ssl
import time
from pathlib import Path
from typing import Dict, Any
import sherpa_onnx
from huggingface_hub import hf_hub_download
from faster_whisper.audio import decode_audio

from app.stt.base import STTProvider

# Bypass corporate proxy SSL interception (Zscaler / Fortinet / company firewalls)
os.environ["HF_HUB_DISABLE_SSL_VERIFY"] = "1"
os.environ["CURL_CA_BUNDLE"] = ""
os.environ["REQUESTS_CA_BUNDLE"] = ""
try:
    ssl._create_default_https_context = ssl._create_unverified_context
except AttributeError:
    pass

class IndicConformerProvider(STTProvider):
    """
    AI4Bharat IndicConformer ASR model running on Sherpa-ONNX runtime (INT8 quantized).
    Ultra-low latency non-autoregressive CTC model optimized for Hindi & Indic speech.
    Supports both offline local directory loading and automatic HuggingFace Hub download.
    """
    def __init__(
        self,
        repo_id: str = "meetsync/indic-conformer-onnx-sherpa",
        model_filename: str = "model.int8.onnx",
        tokens_filename: str = "tokens.txt",
        num_threads: int = 4
    ):
        print(f"Initializing AI4Bharat IndicConformer ONNX Engine...")

        # 1. Check for offline local model directory first (e.g. backend/models/indic_conformer/)
        local_model_dir = Path(__file__).resolve().parent.parent.parent / "models" / "indic_conformer"
        local_model_path = local_model_dir / model_filename
        local_tokens_path = local_model_dir / tokens_filename

        if local_model_path.exists() and local_tokens_path.exists():
            print(f"Loading IndicConformer from local directory: {local_model_dir}")
            model_path = str(local_model_path)
            tokens_path = str(local_tokens_path)
        else:
            # 2. Fallback to Hugging Face Hub download (with corporate SSL bypass)
            print(f"Downloading/loading IndicConformer from HuggingFace Hub ({repo_id})...")
            model_path = hf_hub_download(repo_id, model_filename)
            tokens_path = hf_hub_download(repo_id, tokens_filename)

        self.recognizer = sherpa_onnx.OfflineRecognizer.from_nemo_ctc(
            model=model_path,
            tokens=tokens_path,
            num_threads=num_threads,
            debug=False
        )
        print("IndicConformer loaded successfully.")

    def transcribe(self, audio_path: str, language: str = None) -> Dict[str, Any]:
        start_time = time.time()

        # Decode any audio format (webm, wav, mp3) to 16kHz mono float32
        samples = decode_audio(audio_path, sampling_rate=16000)
        audio_duration = round(len(samples) / 16000.0, 2)

        stream = self.recognizer.create_stream()
        stream.accept_waveform(16000, samples)
        self.recognizer.decode_stream(stream)
        
        transcript_text = stream.result.text.strip()
        processing_time = time.time() - start_time

        return {
            "transcript": transcript_text,
            "audio_duration": audio_duration,
            "processing_time": round(processing_time, 2)
        }
