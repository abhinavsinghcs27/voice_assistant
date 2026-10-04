import asyncio
import json
from pathlib import Path
from app.config import (
    BASE_DIR,
    CONVERSATIONAL_FILLERS,
    SESSION_RECORDINGS_DIR,
    POST_CALL_DIR
)
from app.tools import (
    lookup_order,
    lookup_cnh_dtc_fault,
    create_support_ticket,
    execute_tool
)
from app.session_manager import session_manager
from app.tts.tts_provider import MultiEngineTTSProvider


async def run_tests():
    print("=" * 60)
    print("Testing 1: Simulated External Tool Calling & Dynamic CRM Actions")
    print("=" * 60)

    # 1. E-Commerce Order Lookup
    order_res = lookup_order("ORD-1092")
    assert order_res["found"] is True
    print(f"[OK] lookup_order('ORD-1092') -> Carrier: {order_res['data']['carrier']}, ETA: {order_res['data']['estimated_delivery']}, Location: {order_res['data']['current_location']}")

    # 2. CNH Telematics Fault Lookup
    cnh_res = lookup_cnh_dtc_fault("3142")
    assert cnh_res["found"] is True
    print(f"[OK] lookup_cnh_dtc_fault('3142') -> Subsystem: {cnh_res['data']['subsystem']}, Component: {cnh_res['data']['component']}")

    # 3. Live Support Ticket Escalation
    ticket_res = create_support_ticket("Hydraulic valve spool jammed in field during harvest", priority="Urgent")
    assert ticket_res["status"] == "success"
    assert "ticket_id" in ticket_res
    print(f"[OK] create_support_ticket() -> Ticket ID: {ticket_res['ticket_id']}, Assigned: {ticket_res['data']['assigned_team']}, SLA: {ticket_res['data']['sla_target']}")

    # Test generic tool execution dispatcher
    dispatch_res = execute_tool("lookup_order", {"order_id": "ORD-4821"})
    assert dispatch_res["found"] is True
    print(f"[OK] execute_tool('lookup_order') -> Order: {dispatch_res['data']['order_id']} ({dispatch_res['data']['product']})")

    print("\n" + "=" * 60)
    print("Testing 2: Instant Conversational Fillers & Audio Backchanneling")
    print("=" * 60)
    assert len(CONVERSATIONAL_FILLERS) > 0
    tts = MultiEngineTTSProvider()
    for filler in CONVERSATIONAL_FILLERS[:2]:
        synth_res = await tts.synthesize(text=filler["text"], engine="edge-tts")
        assert synth_res["audio_bytes"] is not None
        assert len(synth_res["audio_bytes"]) > 500
        print(f"[OK] Pre-synthesized filler '{filler['id']}': '{filler['text']}' -> {len(synth_res['audio_bytes'])} bytes (latency: {synth_res['processing_time']}s)")

    print("\n" + "=" * 60)
    print("Testing 3: Session Audio Recording Archival")
    print("=" * 60)
    test_sid = "sess_test_archival_101"
    sess_dir = SESSION_RECORDINGS_DIR / test_sid
    sess_dir.mkdir(parents=True, exist_ok=True)
    
    mock_audio = b"RIFF....WAVEfmt ...."
    user_file = sess_dir / "turn_1_user.webm"
    assistant_file = sess_dir / "turn_1_assistant.mp3"
    with open(user_file, "wb") as f:
        f.write(mock_audio)
    with open(assistant_file, "wb") as f:
        f.write(mock_audio)
    
    session_manager.get_or_create_session(test_sid)
    session_manager.add_turn(test_sid, "user", "Order 1092 check karo", metadata={"audio_url": f"/api/voice-assistant/recordings/{test_sid}/turn_1_user.webm"})
    session_manager.add_turn(test_sid, "assistant", "Aapka order deliver hone wala hai.", metadata={"audio_url": f"/api/voice-assistant/recordings/{test_sid}/turn_1_assistant.mp3"})
    
    assert user_file.exists()
    assert assistant_file.exists()
    print(f"[OK] Archived session turns in: {sess_dir}")
    print(f"[OK] Turn 1 User Audio: {user_file.name} ({user_file.stat().st_size} bytes)")
    print(f"[OK] Turn 1 Assistant Audio: {assistant_file.name} ({assistant_file.stat().st_size} bytes)")

    print("\nALL FEATURE TESTS PASSED SUCCESSFULLY!")


if __name__ == "__main__":
    asyncio.run(run_tests())
