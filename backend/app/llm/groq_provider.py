import json
import time
import logging
from typing import List, Dict
from groq import AsyncGroq, GroqError
from app.config import GROQ_API_KEY, GROQ_MODEL, VOICE_ASSISTANT_SYSTEM_PROMPT, FEEDBACK_EXTRACTION_PROMPT

logger = logging.getLogger("groq_llm")

# Active candidate models in order of priority
GROQ_MODELS = [
    GROQ_MODEL,
    "openai/gpt-oss-20b",
    "openai/gpt-oss-120b",
    "groq/compound-mini",
    "qwen/qwen3.6-27b"
]

TELEMETRY_SYSTEM_PROMPT = """You are an automated customer conversation analyst for a Razorpay payment voice assistant.
Analyze the user's speech message and the conversation context.
Output ONLY a valid JSON object matching this exact schema:
{
  "sentiment": "positive" | "neutral" | "frustrated",
  "sentiment_score": float between -1.0 and 1.0,
  "csat_estimate": integer between 1 and 5,
  "detected_intent": short string describing user intent (e.g. "Refund Inquiry", "QR Settlement", "UPI Failure", "General Support"),
  "human_escalation_flag": boolean (true if user shows high frustration, anger, or explicitly demands a human agent, else false)
}
Do NOT include markdown block markers (no ```json). Output pure JSON only."""

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
        temperature: float = 0.7
    ) -> dict:
        """
        Single-turn LLM completion fallback.
        """
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ]
        return await self.generate_conversation_response(messages=messages, temperature=temperature)

    async def generate_conversation_response(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7
    ) -> dict:
        """
        Generates LLM completion for multi-turn conversation messages.
        """
        start_time = time.time()
        last_error = None

        candidate_models = []
        for m in GROQ_MODELS:
            if m and m not in candidate_models:
                candidate_models.append(m)

        for model_name in candidate_models:
            try:
                logger.info(f"Sending multi-turn conversation prompt to Groq model: {model_name}")
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
        conversation_history: List[Dict[str, str]] = None
    ) -> dict:
        """
        Extracts real-time sentiment, CSAT rating, intent, and human escalation flags.
        """
        history_summary = ""
        if conversation_history:
            history_summary = "\n".join([f"{m['role'].upper()}: {m['content']}" for m in conversation_history[-4:]])

        prompt_input = f"Conversation History:\n{history_summary}\nLatest User Input: {user_message}"

        for model_name in GROQ_MODELS:
            try:
                response = await self.client.chat.completions.create(
                    model=model_name,
                    messages=[
                        {"role": "system", "content": TELEMETRY_SYSTEM_PROMPT},
                        {"role": "user", "content": prompt_input}
                    ],
                    temperature=0.1,
                    max_tokens=150
                )
                raw_json = response.choices[0].message.content.strip()
                # Clean up any potential markdown formatting
                if raw_json.startswith("```"):
                    raw_json = raw_json.split("```")[1]
                    if raw_json.startswith("json"):
                        raw_json = raw_json[4:]
                    raw_json = raw_json.strip()

                telemetry = json.loads(raw_json)
                return {
                    "sentiment": telemetry.get("sentiment", "neutral"),
                    "sentiment_score": float(telemetry.get("sentiment_score", 0.0)),
                    "csat_estimate": int(telemetry.get("csat_estimate", 3)),
                    "detected_intent": str(telemetry.get("detected_intent", "General Inquiry")),
                    "human_escalation_flag": bool(telemetry.get("human_escalation_flag", False))
                }
            except Exception as e:
                logger.warning(f"Telemetry analysis with {model_name} failed: {e}")
                continue

        # Fallback default if LLM telemetry call fails
        is_frustrated = any(w in user_message.lower() for w in ["bad", "worst", "fail", "fraud", "problem", "angry", "kyon nahi", "stuck"])
        return {
            "sentiment": "frustrated" if is_frustrated else "neutral",
            "sentiment_score": -0.5 if is_frustrated else 0.0,
            "csat_estimate": 2 if is_frustrated else 4,
            "detected_intent": "Customer Support",
            "human_escalation_flag": is_frustrated
        }

    async def extract_structured_feedback(
        self,
        conversation_history: List[Dict[str, str]],
        telemetry: dict = None
    ) -> dict:
        """
        Phase 2: Aggregates the full conversation transcript into a single
        structured feedback JSON record for customer service DB ingestion.

        Returns a dict with keys:
        - feedback: structured JSON record
        - model_used: str or None (None in degraded mode)
        - processing_time: float
        - extraction_status: "success" | "fallback_heuristic"
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
        prompt_input = f"Full Conversation Transcript:\n{transcript_text}"

        last_error = None
        for model_name in GROQ_MODELS:
            try:
                logger.info(f"Extracting structured feedback with Groq model: {model_name}")
                response = await self.client.chat.completions.create(
                    model=model_name,
                    messages=[
                        {"role": "system", "content": FEEDBACK_EXTRACTION_PROMPT},
                        {"role": "user", "content": prompt_input}
                    ],
                    temperature=0.1,
                    max_tokens=800
                )
                raw_json = response.choices[0].message.content.strip()
                if raw_json.startswith("```"):
                    raw_json = raw_json.split("```")[1]
                    if raw_json.startswith("json"):
                        raw_json = raw_json[4:]
                    raw_json = raw_json.strip()

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

        # Degraded mode: build a valid record from per-turn telemetry so DB ingestion
        # never receives a 500.
        if telemetry:
            flag = bool(telemetry.get("human_escalation_flag", False))
            sentiment_map = {"positive": "positive", "frustrated": "negative", "neutral": "neutral"}
            aggregate = sentiment_map.get(telemetry.get("sentiment", "neutral"), "neutral")
            feedback = {
                "schema_version": "1.0",
                "aggregate_sentiment": aggregate,
                "sentiment_score": float(telemetry.get("sentiment_score", 0.0)),
                "overall_satisfaction": int(telemetry.get("csat_estimate", 3)),
                "primary_complaints": ["[unable to auto-extract complaints]"] if aggregate == "negative" else [],
                "positive_highlights": [],
                "suggestions": [],
                "key_topics": [str(telemetry.get("detected_intent", "General Inquiry"))],
                "follow_up_required": flag,
                "action_items": ["Review session for follow-up"] if flag else [],
                "resolution_status": "escalated" if flag else "resolved",
                "summary_hindi": "",
                "summary_english": ""
            }
            return {
                "feedback": feedback,
                "model_used": None,
                "processing_time": round(time.time() - start_time, 3),
                "extraction_status": "fallback_heuristic"
            }

        raise RuntimeError(f"Structured feedback extraction failed. Last error: {last_error}")
