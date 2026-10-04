import uuid
import time
from typing import Dict, List, Optional

class SessionManager:
    """
    Session manager for storing multi-turn conversation history,
    active persona settings, entity memory slots, and real-time telemetry state.
    """
    def __init__(self, max_idle_seconds: int = 1800):
        self.sessions: Dict[str, dict] = {}
        self.max_idle_seconds = max_idle_seconds

    def _cleanup_expired(self):
        now = time.time()
        expired_ids = [
            sid for sid, data in self.sessions.items()
            if (now - data.get("last_active", 0)) > self.max_idle_seconds
        ]
        for sid in expired_ids:
            del self.sessions[sid]

    def get_or_create_session(self, session_id: Optional[str] = None, persona_id: str = "vaani_inbound") -> dict:
        self._cleanup_expired()
        if not session_id or session_id not in self.sessions:
            session_id = f"sess_{uuid.uuid4().hex[:8]}"
            self.sessions[session_id] = {
                "session_id": session_id,
                "persona_id": persona_id,
                "history": [],
                "telemetry": {
                    "sentiment": "neutral",
                    "sentiment_score": 0.0,
                    "csat_estimate": 3,
                    "detected_intent": "General Inquiry",
                    "human_escalation_flag": False,
                    "slots": {}
                },
                "finalized_at": None,
                "record_id": None,
                "feedback_record": None,
                "created_at": time.time(),
                "last_active": time.time()
            }
        else:
            self.sessions[session_id]["last_active"] = time.time()
            if persona_id and "persona_id" not in self.sessions[session_id]:
                self.sessions[session_id]["persona_id"] = persona_id
        
        return self.sessions[session_id]

    def add_turn(self, session_id: str, role: str, content: str, metadata: Optional[dict] = None):
        session = self.get_or_create_session(session_id)
        turn_entry = {
            "role": role,
            "content": content,
            "timestamp": time.time()
        }
        if metadata and isinstance(metadata, dict):
            turn_entry.update(metadata)
        session["history"].append(turn_entry)
        session["last_active"] = time.time()

    def record_interruption(self, session_id: str):
        """Append an interruption flag to the session history so LLM context remains accurate."""
        if session_id in self.sessions:
            history = self.sessions[session_id]["history"]
            if history and history[-1]["role"] == "assistant":
                if "[Interrupted by User]" not in history[-1]["content"]:
                    history[-1]["content"] += " [Interrupted by User]"
            else:
                self.add_turn(session_id, "system", "[Assistant turn was interrupted by User barge-in]")

    def get_history(self, session_id: str) -> List[dict]:
        if session_id in self.sessions:
            return [
                {"role": turn["role"], "content": turn["content"]}
                for turn in self.sessions[session_id]["history"]
            ]
        return []

    def has_session(self, session_id: str) -> bool:
        return session_id in self.sessions

    def get_turn_count(self, session_id: str) -> int:
        session = self.sessions.get(session_id)
        return len(session["history"]) if session else 0

    def mark_finalized(self, session_id: str, record_id: str, feedback_record: dict):
        if session_id in self.sessions:
            self.sessions[session_id]["finalized_at"] = time.time()
            self.sessions[session_id]["record_id"] = record_id
            self.sessions[session_id]["feedback_record"] = feedback_record

    def update_telemetry(self, session_id: str, telemetry_data: dict):
        if session_id in self.sessions:
            telemetry = self.sessions[session_id]["telemetry"]
            for k, v in telemetry_data.items():
                if k == "slots" and isinstance(v, dict):
                    if "slots" not in telemetry:
                        telemetry["slots"] = {}
                    telemetry["slots"].update(v)
                else:
                    telemetry[k] = v

    def reset_session(self, session_id: str, persona_id: str = "vaani_inbound") -> str:
        if session_id in self.sessions:
            del self.sessions[session_id]
        new_session = self.get_or_create_session(persona_id=persona_id)
        return new_session["session_id"]

# Global singleton session manager
session_manager = SessionManager()
