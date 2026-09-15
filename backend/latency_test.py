import asyncio
import io
import json
import time
import base64
import httpx
from faster_whisper.audio import decode_audio
from app.tts.tts_provider import GTTSProvider

BASE = "http://127.0.0.1:8000"
WEBM = r"recordings/rec_f9cd94.webm"


def aud_dur_bytes(b) -> float:
    if isinstance(b, str):
        b = base64.b64decode(b.split(",")[-1])
    s = decode_audio(io.BytesIO(b), sampling_rate=16000)
    return len(s) / 16000.0


async def main():
    async with httpx.AsyncClient(timeout=300.0) as c:
        t0 = time.time()
        r = await c.post(f"{BASE}/api/voice-assistant/greet")
        g = r.json()
        print(
            "GREET  http_total %.3fs  text %r  audio_dur %.2fs"
            % (time.time() - t0, g["text"], aud_dur_bytes(g["audio_url"].split(",")[1]))
        )

        with open(WEBM, "rb") as f:
            data = f.read()
        print("\n%-28s %8s %8s %8s %8s %8s" % ("MODEL", "stt_s", "llm_s", "tts_s", "total_s", "reply_s"))
        for model in [
            "groq-whisper-large-v3-turbo",
            "indic-conformer-onnx",
            "faster-whisper-large-v3",
        ]:
            http_start = time.time()
            r = await c.post(
                f"{BASE}/api/voice-assistant/interact",
                data={"stt_model": model, "session_id": "lat_test_" + model.split("-")[0]},
                files={"audio": ("a.webm", data, "video/webm")},
            )
            payload = r.json()
            lat = payload.get("latency")
            if not lat:
                print("%-28s ERROR %s %s" % (model, r.status_code, str(payload)[:200]))
                continue
            reply_dur = aud_dur_bytes(payload["audio_url"].split(",")[1])
            print(
                "%-28s %8.3f %8.3f %8.3f %8.3f %8.2f  (http %.2fs)"
                % (model, lat["stt_seconds"], lat["llm_seconds"], lat["tts_seconds"], lat["total_seconds"], reply_dur, time.time() - http_start)
            )

    p = GTTSProvider()
    txt = ("Theek hai, main aapki madad kar sakta hoon. Please tell me, "
           "kya koi aur dikkat hai? Aur kuch baat karni ho to bataiye.")
    t = time.time()
    res = await p.synthesize(txt)
    dt = time.time() - t
    print("\nTTS isolated (2 sentences): %.3fs synth | audio %.2fs | bytes %d | fragments ok" % (dt, aud_dur_bytes(res["audio_bytes"]), len(res["audio_bytes"])))


if __name__ == "__main__":
    asyncio.run(main())