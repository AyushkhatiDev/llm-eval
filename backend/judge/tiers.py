"""
Vocabulary shared by the staged scorer.

The scorer is a cascade. Each stage ("tier") either returns a verdict it is
confident about, or declines and lets the next tier try. Recording which tier
actually fired is what makes an eval result auditable: a 1.0 from `rules` and a
1.0 from `llm_judge` cost very different amounts and carry different reliability.
"""
from dataclasses import dataclass, field

TIER_EMPTY = "empty_check"
TIER_SEMANTIC = "semantic"
TIER_RULES = "rules"
TIER_LLM = "llm_judge"

TIER_ORDER = [TIER_EMPTY, TIER_SEMANTIC, TIER_RULES, TIER_LLM]

TIER_LABELS = {
    TIER_EMPTY: "Empty check",
    TIER_SEMANTIC: "Semantic",
    TIER_RULES: "Rule match",
    TIER_LLM: "LLM judge",
}


@dataclass
class TierAttempt:
    """One stage of the cascade, whether or not it produced the final verdict."""

    tier: str
    outcome: str  # decided | declined | unavailable | skipped
    confidence: float | None = None
    score: float | None = None
    detail: str = ""
    latency_ms: int = 0

    def to_dict(self) -> dict:
        return {
            "tier": self.tier,
            "label": TIER_LABELS.get(self.tier, self.tier),
            "outcome": self.outcome,
            "confidence": round(self.confidence, 4) if self.confidence is not None else None,
            "score": round(self.score, 4) if self.score is not None else None,
            "detail": self.detail,
            "latency_ms": self.latency_ms,
        }


@dataclass
class JudgeVerdict:
    """The final scoring decision plus the trace of how it was reached."""

    score: float
    reason: str
    tier: str
    confidence: float
    escalated: bool = False
    tiers_attempted: list[TierAttempt] = field(default_factory=list)
    latency_ms: int = 0
    tokens_used: int = 0

    def to_dict(self) -> dict:
        return {
            "score": round(self.score, 4),
            "reason": self.reason,
            "judge_tier": self.tier,
            "judge_tier_label": TIER_LABELS.get(self.tier, self.tier),
            "tier_confidence": round(self.confidence, 4),
            "escalated": self.escalated,
            "tiers_attempted": [t.to_dict() for t in self.tiers_attempted],
            "judge_latency_ms": self.latency_ms,
            "judge_tokens_used": self.tokens_used,
        }
