"""
Single-shot eval runner.

Deployment is synchronous on a free tier, so this stays deliberately simple:
one target-model call per test, throttled, with the staged scorer applied to the
result. Everything that could change the score is recorded alongside it.
"""
import os
import re
import threading
import time

import httpx
from dotenv import load_dotenv

from backend.judge.chain import ScorerConfig, judge_output

# The runner is used standalone by scripts and the flakiness checker, not only
# through the Flask app, so it loads its own environment.
load_dotenv()

_groq_lock = threading.Lock()
_last_groq_call_at = 0.0

DEFAULT_TEMPERATURE = float(os.getenv("TARGET_TEMPERATURE", "0.0"))
DEFAULT_SEED = int(os.getenv("TARGET_SEED", "42"))
MAX_OUTPUT_TOKENS = int(os.getenv("TARGET_MAX_TOKENS", "1200"))
PROMPT_TEMPLATE_VERSION = "prompt-v1"


def _is_groq_endpoint(model_endpoint: str | None) -> bool:
    endpoint = (model_endpoint or "groq").strip().lower()
    return endpoint in {"", "groq"} or "groq" in endpoint


def default_target_model() -> str:
    """
    Groq retires model ids periodically — `llama-3.1-8b-instant` was the
    previous default and now 404s. Override with GROQ_TARGET_MODEL rather than
    editing this constant.
    """
    return (
        os.getenv("GROQ_TARGET_MODEL")
        or os.getenv("GROQ_MODEL")
        or "openai/gpt-oss-20b"
    )


def _throttle_groq_call():
    """Free-tier rate limits are the binding constraint, not throughput."""
    global _last_groq_call_at

    min_interval = float(os.getenv("GROQ_MIN_INTERVAL_SECONDS", "2.2"))
    with _groq_lock:
        elapsed = time.monotonic() - _last_groq_call_at
        if elapsed < min_interval:
            time.sleep(min_interval - elapsed)
        _last_groq_call_at = time.monotonic()


def _build_messages(prompt: str, messages: list[dict] | None) -> list[dict]:
    """
    Multi-turn cases carry their own transcript. They still cost exactly one
    API call — the prior turns are replayed as context, not re-generated.
    """
    if messages:
        turns = [{"role": m["role"], "content": m["content"]} for m in messages]
        if prompt and (not turns or turns[-1].get("content") != prompt):
            if turns[-1]["role"] != "user":
                turns.append({"role": "user", "content": prompt})
        return turns
    return [{"role": "user", "content": prompt}]


def _reasoning_effort() -> str | None:
    """
    Reasoning models on Groq (the gpt-oss family) spend their token budget on
    hidden reasoning first. Left unconstrained they hit the completion cap
    before emitting any content, and the harness sees an empty answer that is
    really a truncation. Low effort keeps a short answer inside the budget.
    """
    effort = os.getenv("GROQ_REASONING_EFFORT", "low").strip().lower()
    return effort or None


def _call_groq(
    prompt: str,
    model: str | None = None,
    messages: list[dict] | None = None,
    temperature: float | None = None,
    seed: int | None = None,
) -> str:
    from groq import Groq

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not configured")

    model_name = model or default_target_model()
    client = Groq(api_key=api_key)
    request = {
        "model": model_name,
        "messages": _build_messages(prompt, messages),
        "temperature": DEFAULT_TEMPERATURE if temperature is None else temperature,
        "seed": DEFAULT_SEED if seed is None else seed,
        "max_tokens": MAX_OUTPUT_TOKENS,
    }
    effort = _reasoning_effort()
    if effort:
        request["extra_body"] = {"reasoning_effort": effort}

    response = None
    for attempt in range(5):
        try:
            _throttle_groq_call()
            response = client.chat.completions.create(**request)
            break
        except Exception as e:
            message = str(e).lower()
            # Models that do not accept reasoning_effort reject the whole call.
            if "reasoning_effort" in message and "extra_body" in request:
                request.pop("extra_body")
                continue
            if "rate_limit" not in message or attempt == 4:
                raise
            match = re.search(r"try again in ([0-9.]+)s", str(e), re.IGNORECASE)
            retry_after = float(match.group(1)) if match else 5.0
            time.sleep(retry_after + 2.0)

    choice = response.choices[0]
    content = choice.message.content or ""
    if not content.strip() and choice.finish_reason == "length":
        # An empty answer because the model ran out of budget is a harness
        # problem, not a model refusal — do not score it as an empty response.
        raise RuntimeError(
            f"truncated: {model_name} exhausted its {MAX_OUTPUT_TOKENS}-token budget "
            "before producing an answer"
        )
    return content


def _call_http_model(
    prompt: str,
    model_endpoint: str,
    model: str | None = None,
    messages: list[dict] | None = None,
    temperature: float | None = None,
    seed: int | None = None,
) -> str:
    if _is_groq_endpoint(model_endpoint):
        return _call_groq(prompt, model=model, messages=messages, temperature=temperature, seed=seed)

    model_name = model or os.getenv("OLLAMA_MODEL", "llama3.1:8b")
    transcript = prompt
    if messages:
        transcript = "\n\n".join(f"{m['role'].upper()}: {m['content']}" for m in messages)
    response = httpx.post(
        model_endpoint,
        json={
            "model": model_name,
            "prompt": transcript,
            "stream": False,
            "options": {
                "temperature": DEFAULT_TEMPERATURE if temperature is None else temperature,
                "seed": DEFAULT_SEED if seed is None else seed,
            },
        },
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
    messages: list[dict] | None = None,
    temperature: float | None = None,
    seed: int | None = None,
    scorer_config: ScorerConfig | None = None,
) -> dict:
    config = scorer_config or ScorerConfig.from_expected(expected)
    temperature = DEFAULT_TEMPERATURE if temperature is None else temperature
    seed = DEFAULT_SEED if seed is None else seed

    start = time.time()
    try:
        output = _call_http_model(
            prompt, model_endpoint, model=model, messages=messages,
            temperature=temperature, seed=seed,
        )
        error = None
    except httpx.TimeoutException:
        output = ""
        error = "timeout"
    except Exception as e:
        output = ""
        error = str(e)

    latency_ms = int((time.time() - start) * 1000)
    verdict = judge_output(output, expected, config)

    return {
        "test_id": test_id,
        "prompt": prompt,
        "model_endpoint": model_endpoint,
        "output": output,
        "passed": verdict.score >= config.pass_threshold,
        "latency_ms": latency_ms,
        "reason": verdict.reason,
        "error": error,
        "severity": float(expected.get("severity", 1.0)),
        "config": {
            "target_model": model or (default_target_model() if _is_groq_endpoint(model_endpoint) else model_endpoint),
            "temperature": temperature,
            "seed": seed,
            "judge_model": config.judge_model if config.llm_judge_enabled else None,
            "scorer_config_hash": config.config_hash(),
            "prompt_template_version": PROMPT_TEMPLATE_VERSION,
        },
        **verdict.to_dict(),
    }
