import json
import time
import logging
from typing import List, Dict, Optional
from groq import AsyncGroq, GroqError
from app.config import (
    GROQ_API_KEY,
    GROQ_MODEL,
    VOICE_ASSISTANT_SYSTEM_PROMPT,
    FEEDBACK_EXTRACTION_PROMPT
)

logger = logging.getLogger("groq_llm")

# Active candidate models in order of priority (exact active Groq model IDs)
GROQ_MODELS = [
    GROQ_MODEL,
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "qwen/qwen3.8-27b",
]

TELEMETRY_SYSTEM_PROMPT = """You are an automated real-time conversation analyst for a multi-domain voice assistant.
Analyze the user's speech message and the conversation context.
Extract sentiment, estimated CSAT rating, intent, human escalation flag, and any active entity slots (e.g. order_id, product, issue_category, machinery_model, fault_code, status).
Output ONLY a valid JSON object matching this exact schema:
{
  "sentiment": "positive" | "neutral" | "negative" | "frustrated",
  "sentiment_score": float between -1.0 and 1.0,
  "csat_estimate": integer between 1 and 5,
  "detected_intent": short string describing user intent,
  "human_escalation_flag": boolean,
  "slots": {
    "order_id": "extracted string or null",
    "product": "extracted string or null",
    "issue_category": "extracted string or null",
    "machinery_model": "extracted string or null",
    "fault_code": "extracted string or null",
    "resolution_status": "in_progress" | "resolved" | "escalated"
  }
}
Do NOT include markdown block markers (no ```json). Output pure JSON only."""


def _clean_json_str(raw: str) -> str:
    raw = raw.strip()
    if "```" in raw:
        parts = raw.split("```")
        for part in parts:
            p = part.strip()
            if p.startswith("json"):
                p = p[4:].strip()
            if p.startswith("{") and p.endswith("}"):
                return p
    first_brace = raw.find("{")
    last_brace = raw.rfind("}")
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        return raw[first_brace:last_brace + 1]
    return raw


class GroqLLMProvider:
    def __init__(self, api_key: str = None):
        self.api_key = api_key or GROQ_API_KEY
        if not self.api_key:
            raise ValueError("Groq API key is required. Please set GROQ_API_KEY environment variable or in .env.")
        self.client = AsyncGroq(api_key=self.api_key)

    async def generate_response(
        self,
        user_message: str,
        system_prompt: str = VOICE_ASSISTANT_SYSTEM_PROMPT,
        temperature: float = 0.6
    ) -> dict:
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ]
        return await self.generate_conversation_response(messages=messages, temperature=temperature)

    async def generate_conversation_response(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.6
    ) -> dict:
        start_time = time.time()
        last_error = None

        candidate_models = []
        for m in GROQ_MODELS:
            if m and m not in candidate_models:
                candidate_models.append(m)

        for model_name in candidate_models:
            try:
                response = await self.client.chat.completions.create(
                    model=model_name,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=256
                )

                elapsed_time = round(time.time() - start_time, 3)
                reply_text = response.choices[0].message.content.strip()

                return {
                    "text": reply_text,
                    "model_used": model_name,
                    "processing_time": elapsed_time
                }
            except GroqError as ge:
                logger.warning(f"Groq model {model_name} failed: {ge}")
                last_error = ge
            except Exception as e:
                logger.warning(f"Unexpected error with Groq model {model_name}: {e}")
                last_error = e

        raise RuntimeError(f"All Groq model attempts failed. Last error: {last_error}")

    async def analyze_sentiment_and_telemetry(
        self,
        user_message: str,
        conversation_history: List[Dict[str, str]] = None,
        existing_slots: dict = None
    ) -> dict:
        """
        Extracts real-time sentiment, CSAT rating, intent, human escalation flags, and memory slots.
        """
        history_summary = ""
        if conversation_history:
            history_summary = "\n".join([f"{m['role'].upper()}: {m['content']}" for m in conversation_history[-4:]])

        prompt_input = (
            f"Conversation History:\n{history_summary}\n"
            f"Current Known Slots: {json.dumps(existing_slots or {})}\n"
            f"Latest User Input: {user_message}"
        )

        for model_name in GROQ_MODELS:
            try:
                response = await self.client.chat.completions.create(
                    model=model_name,
                    messages=[
                        {"role": "system", "content": TELEMETRY_SYSTEM_PROMPT},
                        {"role": "user", "content": prompt_input}
                    ],
                    temperature=0.1,
                    max_tokens=220
                )
                raw_json = _clean_json_str(response.choices[0].message.content)
                telemetry = json.loads(raw_json)
                extracted_slots = telemetry.get("slots", {}) or {}
                # Merge with existing slots
                merged_slots = dict(existing_slots or {})
                for k, v in extracted_slots.items():
                    if v is not None and str(v).strip() != "":
                        merged_slots[k] = v

                return {
                    "sentiment": telemetry.get("sentiment", "neutral"),
                    "sentiment_score": float(telemetry.get("sentiment_score", 0.0)),
                    "csat_estimate": int(telemetry.get("csat_estimate", 3)),
                    "detected_intent": str(telemetry.get("detected_intent", "General Inquiry")),
                    "human_escalation_flag": bool(telemetry.get("human_escalation_flag", False)),
                    "slots": merged_slots
                }
            except Exception as e:
                logger.warning(f"Telemetry analysis with {model_name} failed: {e}")
                continue

        # Fallback heuristic
        is_frustrated = any(w in user_message.lower() for w in ["bad", "worst", "fail", "fraud", "problem", "angry", "kyon nahi", "stuck", "kharab", "nahi chal raha"])
        return {
            "sentiment": "frustrated" if is_frustrated else "neutral",
            "sentiment_score": -0.5 if is_frustrated else 0.0,
            "csat_estimate": 2 if is_frustrated else 4,
            "detected_intent": "Customer Support",
            "human_escalation_flag": is_frustrated,
            "slots": existing_slots or {}
        }

    async def extract_structured_feedback(
        self,
        conversation_history: List[Dict[str, str]],
        telemetry: dict = None,
        persona_info: dict = None
    ) -> dict:
        """
        Aggregates the full conversation transcript and resolved memory slots into a
        structured feedback JSON record for post-call analysis.
        """
        start_time = time.time()

        turns = conversation_history[-20:]
        lines = []
        for m in turns:
            role = "Customer" if m.get("role") == "user" else "Assistant"
            content = m.get("content", "") or ""
            if len(content) > 600:
                content = content[:600] + "..."
            lines.append(f"{role}: {content}")
        transcript_text = "\n".join(lines)
        prompt_input = (
            f"Persona Info: {json.dumps(persona_info or {})}\n"
            f"Accumulated Telemetry & Slots: {json.dumps(telemetry or {})}\n\n"
            f"Full Conversation Transcript:\n{transcript_text}"
        )

        last_error = None
        for model_name in GROQ_MODELS:
            try:
                response = await self.client.chat.completions.create(
                    model=model_name,
                    messages=[
                        {"role": "system", "content": FEEDBACK_EXTRACTION_PROMPT},
                        {"role": "user", "content": prompt_input}
                    ],
                    temperature=0.1,
                    max_tokens=850
                )
                raw_json = _clean_json_str(response.choices[0].message.content)
                feedback = json.loads(raw_json)
                return {
                    "feedback": feedback,
                    "model_used": model_name,
                    "processing_time": round(time.time() - start_time, 3),
                    "extraction_status": "success"
                }
            except Exception as e:
                logger.warning(f"Structured feedback extraction with {model_name} failed: {e}")
                last_error = e

        # Degraded fallback
        if telemetry:
            flag = bool(telemetry.get("human_escalation_flag", False))
            sentiment_map = {"positive": "positive", "frustrated": "frustrated", "negative": "negative", "neutral": "neutral"}
            aggregate = sentiment_map.get(telemetry.get("sentiment", "neutral"), "neutral")
            feedback = {
                "schema_version": "2.0",
                "aggregate_sentiment": aggregate,
                "sentiment_score": float(telemetry.get("sentiment_score", 0.0)),
                "overall_satisfaction": int(telemetry.get("csat_estimate", 3)),
                "primary_complaints": ["[unable to auto-extract complaints]"] if aggregate in ["negative", "frustrated"] else [],
                "positive_highlights": [],
                "suggestions": [],
                "key_topics": [str(telemetry.get("detected_intent", "General Inquiry"))],
                "follow_up_required": flag,
                "action_items": ["Review session for follow-up"] if flag else [],
                "resolution_status": "escalated" if flag else "resolved",
                "extracted_slots": telemetry.get("slots", {}),
                "summary_hindi": "Call complete hui.",
                "summary_english": "Call completed successfully."
            }
            return {
                "feedback": feedback,
                "model_used": None,
                "processing_time": round(time.time() - start_time, 3),
                "extraction_status": "fallback_heuristic"
            }

        raise RuntimeError(f"Structured feedback extraction failed. Last error: {last_error}")
