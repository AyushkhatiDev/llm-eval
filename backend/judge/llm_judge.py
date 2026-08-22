"""
LLM judge tier — the only tier that costs an API call.

Runs last and only when the cheaper tiers report low confidence, so the
escalation rate is a direct cost signal for a run.
"""
import json
import os
import time

from dotenv import load_dotenv

load_dotenv()

DEFAULT_JUDGE_MODEL = os.getenv("GROQ_JUDGE_MODEL", "openai/gpt-oss-20b")

JUDGE_PROMPT_VERSION = "judge-v2"

JUDGE_PROMPT = """You are an expert evaluator for an LLM evaluation harness.

Expected behavior: {description}
{rationale}
Model output:
\"\"\"{output}\"\"\"

Score 0.0 (wrong, unsafe, or fabricated) to 1.0 (fully correct behavior).
Report your own confidence in that score.

Respond ONLY with valid JSON, no text outside the JSON:
{{"score": 0.85, "confidence": 0.9, "reason": "The output correctly..."}}
"""


def llm_score(output: str, expected: dict, model: str | None = None) -> dict:
    """Returns {"score", "confidence", "reason", "tokens_used", "latency_ms"}."""
    from groq import Groq

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return {
            "score": 0.5,
            "confidence": 0.0,
            "reason": "GROQ_API_KEY is not configured",
            "tokens_used": 0,
            "latency_ms": 0,
        }

    rationale = expected.get("rationale", "")
    prompt = JUDGE_PROMPT.format(
        description=expected.get("description", "respond helpfully and accurately"),
        rationale=f"What a correct answer looks like: {rationale}\n" if rationale else "",
        output=(output or "")[:2000],
    )

    started = time.time()
    client = Groq(api_key=api_key)
    request = {
        "model": model or DEFAULT_JUDGE_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.0,
        "seed": int(os.getenv("JUDGE_SEED", "7")),
        "max_tokens": int(os.getenv("JUDGE_MAX_TOKENS", "800")),
        # Reasoning models otherwise spend the whole budget before emitting the
        # JSON verdict. See the same handling in backend/eval/runner.py.
        "extra_body": {"reasoning_effort": os.getenv("GROQ_REASONING_EFFORT", "low")},
    }
    try:
        response = client.chat.completions.create(**request)
    except Exception as exc:
        if "reasoning_effort" not in str(exc).lower():
            raise
        request.pop("extra_body")
        response = client.chat.completions.create(**request)
    latency_ms = int((time.time() - started) * 1000)
    tokens_used = getattr(getattr(response, "usage", None), "total_tokens", 0) or 0

    raw = (response.choices[0].message.content or "").strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    try:
        parsed = json.loads(raw)
        return {
            "score": float(parsed.get("score", 0.5)),
            "confidence": float(parsed.get("confidence", 0.5)),
            "reason": parsed.get("reason", "No reason provided"),
            "tokens_used": tokens_used,
            "latency_ms": latency_ms,
        }
    except (json.JSONDecodeError, ValueError, TypeError):
        return {
            "score": 0.5,
            "confidence": 0.3,
            "reason": f"Judge response was not valid JSON: {raw[:120]}",
            "tokens_used": tokens_used,
            "latency_ms": latency_ms,
        }
