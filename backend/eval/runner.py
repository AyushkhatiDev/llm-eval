"""
Core single-shot eval runner (used directly without Celery for testing).
"""
import time
import os
import httpx
from backend.judge.chain import judge_output


def run_single_eval(prompt: str, model_endpoint: str, expected: dict, model: str | None = None) -> dict:
    start = time.time()
    try:
        model_name = model or os.getenv("OLLAMA_MODEL", "llama3.1:8b")
        response = httpx.post(
            model_endpoint,
            json={"model": model_name, "prompt": prompt, "stream": False},
            timeout=120.0
        )
        response.raise_for_status()
        body = response.json()
        output = body.get("response") or body.get("text") or body.get("output") or response.text
        error = None
    except httpx.TimeoutException:
        output = ""
        error = "timeout"
    except ValueError:
        output = response.text
        error = None
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
