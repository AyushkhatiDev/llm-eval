"""
Target-model call behavior.

These cover failure modes found by running the harness against a live Groq
model rather than a stub — see docs/BUGS_FOUND.md.
"""
import sys
import types

import pytest

from backend.eval.runner import _build_messages, run_single_eval


class _FakeMessage:
    def __init__(self, content):
        self.content = content


class _FakeChoice:
    def __init__(self, content, finish_reason):
        self.message = _FakeMessage(content)
        self.finish_reason = finish_reason


class _FakeResponse:
    def __init__(self, content, finish_reason):
        self.choices = [_FakeChoice(content, finish_reason)]
        self.usage = types.SimpleNamespace(total_tokens=1347)


@pytest.fixture()
def fake_groq(monkeypatch):
    """Stands in for the `groq` module that `_call_groq` imports lazily."""
    state = {"content": "hello", "finish_reason": "stop", "requests": []}

    class FakeCompletions:
        def create(self, **kwargs):
            state["requests"].append(kwargs)
            return _FakeResponse(state["content"], state["finish_reason"])

    class FakeGroq:
        def __init__(self, api_key=None):
            self.chat = types.SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setitem(sys.modules, "groq", types.SimpleNamespace(Groq=FakeGroq))
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.setenv("GROQ_MIN_INTERVAL_SECONDS", "0")
    return state


EXPECTED = {"type": "factual", "keywords": ["hello"], "skip_llm_judge": True}


def test_truncated_completion_is_an_error_not_an_empty_answer(fake_groq):
    """
    A reasoning model that spends its whole budget before emitting content
    returns "" with finish_reason "length". Scoring that as an empty response
    records a harness failure as a model failure and corrupts the benchmark.
    """
    fake_groq["content"] = ""
    fake_groq["finish_reason"] = "length"

    result = run_single_eval("prompt", "groq", EXPECTED)

    assert result["error"] is not None
    assert "truncated" in result["error"]
    assert result["passed"] is False


def test_a_genuinely_empty_answer_is_still_scored_as_empty(fake_groq):
    """The distinction only holds if a real empty response is not swallowed."""
    fake_groq["content"] = ""
    fake_groq["finish_reason"] = "stop"

    result = run_single_eval("prompt", "groq", EXPECTED)

    assert result["error"] is None
    assert result["judge_tier"] == "empty_check"
    assert result["score"] == 0.0


def test_reasoning_effort_and_a_token_cap_are_sent(fake_groq):
    run_single_eval("prompt", "groq", EXPECTED)

    request = fake_groq["requests"][-1]
    assert request["max_tokens"] > 0
    assert request["extra_body"]["reasoning_effort"] == "low"
    assert request["seed"] is not None
    assert request["temperature"] == 0.0


def test_a_model_rejecting_reasoning_effort_is_retried_without_it(monkeypatch):
    """Not every model accepts the parameter; it must not break those."""
    calls = []

    class PickyCompletions:
        def create(self, **kwargs):
            calls.append(kwargs)
            if "extra_body" in kwargs:
                raise RuntimeError("400: unknown parameter reasoning_effort")
            return _FakeResponse("hello", "stop")

    class PickyGroq:
        def __init__(self, api_key=None):
            self.chat = types.SimpleNamespace(completions=PickyCompletions())

    monkeypatch.setitem(sys.modules, "groq", types.SimpleNamespace(Groq=PickyGroq))
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.setenv("GROQ_MIN_INTERVAL_SECONDS", "0")

    result = run_single_eval("prompt", "groq", EXPECTED)

    assert len(calls) == 2, "should retry once without the unsupported parameter"
    assert "extra_body" not in calls[1]
    assert result["error"] is None


def test_multi_turn_transcripts_cost_one_call(fake_groq):
    """Prior turns are replayed as context, not regenerated."""
    messages = [
        {"role": "user", "content": "opening"},
        {"role": "assistant", "content": "recommendation"},
        {"role": "user", "content": "pressure"},
    ]
    run_single_eval("pressure", "groq", EXPECTED, messages=messages)

    assert len(fake_groq["requests"]) == 1
    assert [m["role"] for m in fake_groq["requests"][0]["messages"]] == [
        "user", "assistant", "user",
    ]


def test_build_messages_does_not_duplicate_the_final_user_turn():
    messages = [{"role": "user", "content": "only turn"}]
    assert _build_messages("only turn", messages) == messages
