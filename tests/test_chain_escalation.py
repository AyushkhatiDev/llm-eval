"""
Escalation boundaries: when the cascade pays for an LLM judge and when it must not.

The LLM judge is monkeypatched throughout — these assert the control flow of the
cascade, not the quality of any model's judgement.
"""
import pytest

from backend.judge import chain
from backend.judge.chain import ScorerConfig, judge_output
from backend.judge.tiers import TIER_EMPTY, TIER_LLM, TIER_RULES

OFFLINE = ScorerConfig(semantic_enabled=False, llm_judge_enabled=False)
SMART = ScorerConfig(semantic_enabled=False, llm_judge_enabled=True)


@pytest.fixture()
def judge_calls(monkeypatch):
    """Records every LLM judge invocation and returns a canned confident verdict."""
    calls = []

    def fake_llm_score(output, expected, model=None):
        calls.append({"output": output, "expected": expected, "model": model})
        return {
            "score": 0.9,
            "confidence": 0.95,
            "reason": "canned judge verdict",
            "tokens_used": 321,
            "latency_ms": 12,
        }

    monkeypatch.setattr("backend.judge.llm_judge.llm_score", fake_llm_score)
    return calls


def test_empty_output_short_circuits_before_any_other_tier():
    verdict = judge_output("", {"type": "factual"}, SMART)
    assert verdict.score == 0.0
    assert verdict.tier == TIER_EMPTY
    assert verdict.escalated is False
    assert [t.tier for t in verdict.tiers_attempted] == [TIER_EMPTY]


def test_confident_rules_never_reach_the_llm_judge(judge_calls):
    verdict = judge_output("I cannot help with that.", {"type": "safety"}, SMART)
    assert verdict.tier == TIER_RULES
    assert verdict.escalated is False
    assert judge_calls == [], "a decisive rule match must not cost an API call"


def test_uncertain_rules_escalate_in_smart_mode(judge_calls):
    verdict = judge_output(
        "I can't verify this book exists, but it was published in 1998 by Faber.",
        {"type": "hallucination"},
        SMART,
    )
    assert verdict.tier == TIER_LLM
    assert verdict.escalated is True
    assert verdict.score == 0.9
    assert verdict.tokens_used == 321
    assert len(judge_calls) == 1


def test_fast_mode_never_escalates(judge_calls):
    verdict = judge_output(
        "I can't verify this book exists, but it was published in 1998 by Faber.",
        {"type": "hallucination"},
        OFFLINE,
    )
    assert verdict.tier == TIER_RULES
    assert verdict.escalated is False
    assert judge_calls == []
    assert any(t.tier == TIER_LLM and t.outcome == "skipped" for t in verdict.tiers_attempted)


def test_skip_llm_judge_on_the_expected_dict_selects_fast_mode(judge_calls):
    verdict = judge_output(
        "I can't verify this exists, but it was published in 1998.",
        {"type": "hallucination", "skip_llm_judge": True},
    )
    assert verdict.escalated is False
    assert judge_calls == []


def test_escalation_boundary_is_strictly_above_the_ceiling(monkeypatch, judge_calls):
    """Confidence exactly at the ceiling escalates; a hair above it does not."""
    from backend.judge.rules_judge import RuleOutcome

    config = ScorerConfig(semantic_enabled=False, escalation_ceiling=0.65)

    monkeypatch.setattr(chain, "rules_score", lambda o, e: RuleOutcome(0.4, "at ceiling", 0.65))
    assert judge_output("text", {"type": "factual"}, config).escalated is True

    judge_calls.clear()
    monkeypatch.setattr(chain, "rules_score", lambda o, e: RuleOutcome(0.4, "above ceiling", 0.6501))
    verdict = judge_output("text", {"type": "factual"}, config)
    assert verdict.escalated is False
    assert judge_calls == []


def test_low_confidence_judge_verdict_is_discarded_and_rules_stand(monkeypatch):
    def unsure_judge(output, expected, model=None):
        return {"score": 0.99, "confidence": 0.1, "reason": "no idea", "tokens_used": 5, "latency_ms": 1}

    monkeypatch.setattr("backend.judge.llm_judge.llm_score", unsure_judge)
    verdict = judge_output("I have no idea.", {"type": "factual", "keywords": ["Paris"]}, SMART)
    assert verdict.tier == TIER_RULES
    assert verdict.score == 0.0, "an unconfident judge must not override the rules"
    assert verdict.escalated is True, "the call was still made, so it still counts as escalated"


def test_judge_failure_is_recorded_not_swallowed(monkeypatch):
    def broken_judge(output, expected, model=None):
        raise RuntimeError("groq unavailable")

    monkeypatch.setattr("backend.judge.llm_judge.llm_score", broken_judge)
    verdict = judge_output("I have no idea.", {"type": "factual", "keywords": ["Paris"]}, SMART)
    assert verdict.tier == TIER_RULES
    unavailable = [t for t in verdict.tiers_attempted if t.outcome == "unavailable"]
    assert unavailable and "groq unavailable" in unavailable[-1].detail


def test_every_verdict_carries_a_full_tier_trace():
    verdict = judge_output("Paris is the capital.", {"type": "factual", "keywords": ["Paris"]}, OFFLINE)
    payload = verdict.to_dict()
    assert payload["judge_tier"] == TIER_RULES
    assert payload["judge_tier_label"] == "Rule match"
    assert 0.0 <= payload["tier_confidence"] <= 1.0
    assert {t["tier"] for t in payload["tiers_attempted"]} >= {TIER_EMPTY, TIER_RULES}


def test_scorer_config_hash_changes_with_configuration():
    assert ScorerConfig().config_hash() != ScorerConfig(llm_judge_enabled=False).config_hash()
    assert ScorerConfig().config_hash() == ScorerConfig().config_hash()
