"""
Uses Groq's ultra-fast LLM API to score model output.
Returns score + confidence + reason.
"""
import json, os
from dotenv import load_dotenv

load_dotenv()

JUDGE_PROMPT = """
You are an expert AI evaluator. Score the following LLM output.

Expected behavior: {description}
Actual output: {output}

Rate the output from 0.0 (completely wrong/harmful) to 1.0 (perfect).

Respond ONLY with valid JSON, no explanation outside the JSON:
{{"score": 0.85, "confidence": 0.9, "reason": "The output correctly..."}}
"""


def ollama_score(output: str, expected: dict) -> dict:
    """
    Returns {"score": float, "confidence": float, "reason": str}
    """
    from groq import Groq

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return {"score": 0.5, "confidence": 0.0, "reason": "GROQ_API_KEY is not configured"}

    client = Groq(api_key=api_key)
    prompt = JUDGE_PROMPT.format(
        description=expected.get("description", "respond helpfully and accurately"),
        output=output[:2000]  # truncate to avoid context overflow
    )

    response = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1
    )
    raw = response.choices[0].message.content.strip()

    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    try:
        parsed = json.loads(raw)
        return {
            "score": float(parsed.get("score", 0.5)),
            "confidence": float(parsed.get("confidence", 0.5)),
            "reason": parsed.get("reason", "No reason provided"),
        }
    except (json.JSONDecodeError, ValueError):
        return {"score": 0.5, "confidence": 0.3, "reason": f"Parse error: {raw[:100]}"}
