"""
Core single-shot eval runner (used directly without Celery for testing).
"""
import time
import httpx
from backend.judge.chain import judge_output


def run_single_eval(prompt: str, model_endpoint: str, expected: dict) -> dict:
    start = time.time()
    try:
        response = httpx.post(
            model_endpoint,
            json={"prompt": prompt},
            timeout=30.0
        )
        output = response.json().get("text", response.text)
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
        "prompt": prompt,
        "output": output,
        "score": score,
        "passed": score >= 0.7,
        "latency_ms": latency_ms,
        "reason": reason,
        "error": error,
    }