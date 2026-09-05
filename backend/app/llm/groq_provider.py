import time
import logging
from groq import AsyncGroq, GroqError
from app.config import GROQ_API_KEY, GROQ_MODEL, VOICE_ASSISTANT_SYSTEM_PROMPT

logger = logging.getLogger("groq_llm")

# Active candidate models in order of priority
GROQ_MODELS = [
    GROQ_MODEL,
    "openai/gpt-oss-20b",
    "openai/gpt-oss-120b",
    "groq/compound-mini",
    "qwen/qwen3.6-27b"
]

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
        Generates a concise LLM completion via Groq API with robust model fallback handling.
        Returns dict with: text, model_used, processing_time
        """
        start_time = time.time()
        last_error = None

        # Remove duplicate model names while preserving order
        candidate_models = []
        for m in GROQ_MODELS:
            if m and m not in candidate_models:
                candidate_models.append(m)

        for model_name in candidate_models:
            try:
                logger.info(f"Sending prompt to Groq model: {model_name}")
                response = await self.client.chat.completions.create(
                    model=model_name,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_message}
                    ],
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
