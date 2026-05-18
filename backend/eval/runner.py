"""
Core single-shot eval runner (used directly without Celery for testing).
"""
import time
import os
import httpx
from backend.judge.chain import judge_output


def _call_groq(prompt: str, model: str | None = None) -> str:
    from groq import Groq

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not configured")

    model_name = (
        model
        or os.getenv("GROQ_TARGET_MODEL")
        or os.getenv("GROQ_MODEL")
        or "llama-3.1-8b-instant"
    )
    client = Groq(api_key=api_key)
    response = client.chat.completions.create(
        model=model_name,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
    )
    return response.choices[0].message.content or ""


def _call_http_model(prompt: str, model_endpoint: str, model: str | None = None) -> str:
    model_name = model or os.getenv("OLLAMA_MODEL", "llama3.1:8b")
    response = httpx.post(
        model_endpoint,
        json={"model": model_name, "prompt": prompt, "stream": False},
        timeout=120.0,
    )
    response.raise_for_status()

    try:
        body = response.json()
    except ValueError:
        return response.text

    return body.get("response") or body.get("text") or body.get("output") or response.text


def run_single_eval(
    prompt: str,
    model_endpoint: str,
    expected: dict,
    model: str | None = None,
    test_id: str | None = None,
) -> dict:
    start = time.time()
    try:
        endpoint = (model_endpoint or "groq").strip()
        if endpoint.lower() == "groq" or "groq" in endpoint.lower():
            output = _call_groq(prompt, model=model)
        else:
            output = _call_http_model(prompt, endpoint, model=model)
        error = None
    except httpx.TimeoutException:
        output = ""
        error = "timeout"
    except Exception as e:
        output = ""
        error = str(e)

    latency_ms = int((time.time() - start) * 1000)
    score, reason = judge_output(output, expected)

    return {
        "test_id": test_id,
        "prompt": prompt,
        "model_endpoint": model_endpoint,
        "output": output,
        "score": score,
        "passed": score >= 0.7,
        "latency_ms": latency_ms,
        "reason": reason,
        "error": error,
    }
