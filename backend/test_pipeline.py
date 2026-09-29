import httpx
import asyncio
import io
import soundfile as sf
import numpy as np

async def test_interact():
    # Generate 1.5 seconds of 16kHz audio (sine tone) to simulate microphone audio
    sample_rate = 16000
    t = np.linspace(0, 1.5, int(sample_rate * 1.5), False)
    tone = np.sin(2 * np.pi * 440 * t) * 0.3
    
    buf = io.BytesIO()
    sf.write(buf, tone, sample_rate, format='WAV')
    audio_bytes = buf.getvalue()

    async with httpx.AsyncClient(timeout=30.0) as client:
        print("[TEST] Sending greet request...")
        greet_res = await client.post("http://127.0.0.1:8000/api/voice-assistant/greet", data={"persona_id": "vaani_inbound", "tts_engine": "edge-tts"})
        print(f"[TEST] Greet status: {greet_res.status_code}")
        greet_data = greet_res.json()
        print(f"[TEST] Greet text: {greet_data.get('text')}")

        print("[TEST] Sending interact turn request...")
        files = {"audio": ("test_turn.wav", audio_bytes, "audio/wav")}
        data = {
            "stt_model": "indic-conformer-onnx",
            "persona_id": "vaani_inbound",
            "tts_engine": "edge-tts"
        }
        interact_res = await client.post("http://127.0.0.1:8000/api/voice-assistant/interact", files=files, data=data)
        print(f"[TEST] Interact status: {interact_res.status_code}")
        interact_json = interact_res.json()
        print(f"[TEST] LLM Response: {interact_json.get('llm_response')}")
        print(f"[TEST] Telemetry: {interact_json.get('telemetry')}")
        print(f"[TEST] Latency: {interact_json.get('latency')}")

if __name__ == "__main__":
    asyncio.run(test_interact())
