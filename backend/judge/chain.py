"""
The staged scorer.

    empty check  ->  semantic  ->  rules  ->  llm judge (only if still unsure)

Each tier can decide or decline. The first tier that is confident enough wins,
and the cascade records what every tier did on the way there. That trace is what
turns a bare score into something auditable: you can see whether a 1.0 came from
a free keyword match or from a paid LLM call, and whether the run escalated.

The cascade's own accuracy is measured, not assumed — see
`backend.eval.scorer_validation`, which replays a hand-labelled fixture through
this exact code path and compares it against random baselines.
"""
import hashlib
import json
import time
from dataclasses import asdict, dataclass

from backend.judge.rules_judge import rules_score
from backend.judge.tiers import (
    TIER_EMPTY,
    TIER_LLM,
    TIER_RULES,
    TIER_SEMANTIC,
    JudgeVerdict,
    TierAttempt,
)

SCORER_VERSION = "scorer-v2"
PASS_THRESHOLD = 0.7


@dataclass(frozen=True)
class ScorerConfig:
    """
    Everything that can change a score. Hashed and persisted with every run and
    every validation, so a number can always be traced back to the exact
    configuration that produced it.
    """

    scorer_version: str = SCORER_VERSION
    semantic_enabled: bool = True
    rules_enabled: bool = True
    llm_judge_enabled: bool = True
    judge_model: str = "openai/gpt-oss-20b"
    semantic_threshold: float = 0.85
    nli_entailment_threshold: float = 0.85
    nli_contradiction_score: float = 0.3
    escalation_ceiling: float = 0.65
    llm_confidence_threshold: float = 0.65
    pass_threshold: float = PASS_THRESHOLD

    def to_dict(self) -> dict:
        return asdict(self)

    def config_hash(self) -> str:
        canonical = json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode()).hexdigest()[:12]

    @classmethod
    def from_expected(cls, expected: dict, **overrides) -> "ScorerConfig":
        """Fast mode is expressed per-test as `skip_llm_judge`."""
        if expected.get("skip_llm_judge"):
            overrides.setdefault("llm_judge_enabled", False)
        return cls(**overrides)


DEFAULT_CONFIG = ScorerConfig()
FAST_CONFIG = ScorerConfig(llm_judge_enabled=False)


def judge_output(output: str, expected: dict, config: ScorerConfig | None = None) -> JudgeVerdict:
    """Run the cascade and return the verdict together with its full trace."""
    config = config or ScorerConfig.from_expected(expected)
    attempts: list[TierAttempt] = []
    started = time.time()

    # --- Tier: empty check -------------------------------------------------
    if not output or not output.strip():
        attempts.append(TierAttempt(TIER_EMPTY, "decided", 1.0, 0.0, "Output was empty"))
        return _finalize(0.0, "Empty output", TIER_EMPTY, 1.0, False, attempts, started, 0)
    attempts.append(TierAttempt(TIER_EMPTY, "declined", 1.0, None, "Output is non-empty"))

    # --- Tier: semantic / NLI ---------------------------------------------
    if config.semantic_enabled:
        verdict = _try_semantic(output, expected, config, attempts)
        if verdict is not None:
            score, reason, confidence = verdict
            return _finalize(score, reason, TIER_SEMANTIC, confidence, False, attempts, started, 0)
    else:
        attempts.append(TierAttempt(TIER_SEMANTIC, "skipped", None, None, "Disabled by scorer config"))

    # --- Tier: rules -------------------------------------------------------
    outcome = rules_score(output, expected)
    rules_confident = outcome.confidence > config.escalation_ceiling
    attempts.append(
        TierAttempt(
            TIER_RULES,
            "decided" if rules_confident else "declined",
            outcome.confidence,
            outcome.score,
            outcome.reason,
        )
    )
    if rules_confident or not config.llm_judge_enabled:
        if not rules_confident:
            attempts.append(
                TierAttempt(TIER_LLM, "skipped", None, None, "Fast mode: LLM judge disabled")
            )
        return _finalize(
            outcome.score, outcome.reason, TIER_RULES, outcome.confidence, False, attempts, started, 0
        )

    # --- Tier: LLM judge ---------------------------------------------------
    try:
        from backend.judge.llm_judge import llm_score

        result = llm_score(output, expected, model=config.judge_model)
        attempts.append(
            TierAttempt(
                TIER_LLM,
                "decided" if result["confidence"] >= config.llm_confidence_threshold else "declined",
                result["confidence"],
                result["score"],
                result["reason"],
                result.get("latency_ms", 0),
            )
        )
        if result["confidence"] >= config.llm_confidence_threshold:
            reason = f"Rules uncertain ({outcome.confidence:.2f}) → escalated to LLM judge: {result['reason']}"
            return _finalize(
                result["score"],
                reason,
                TIER_LLM,
                result["confidence"],
                True,
                attempts,
                started,
                result.get("tokens_used", 0),
            )
    except Exception as exc:  # judge unavailable — fall back, but say so
        attempts.append(TierAttempt(TIER_LLM, "unavailable", None, None, f"{type(exc).__name__}: {exc}"))

    reason = f"Rules uncertain ({outcome.confidence:.2f}), LLM judge inconclusive: {outcome.reason}"
    return _finalize(outcome.score, reason, TIER_RULES, outcome.confidence, True, attempts, started, 0)


def _try_semantic(output, expected, config, attempts) -> tuple[float, str, float] | None:
    """Returns (score, reason, confidence) if the semantic tier decides, else None."""
    reference = expected.get("reference") or expected.get("description", "")
    tier_started = time.time()

    try:
        from backend.judge.semantic_judge import semantic_score

        similarity = semantic_score(output, expected)
    except Exception as exc:
        attempts.append(
            TierAttempt(
                TIER_SEMANTIC,
                "unavailable",
                None,
                None,
                f"Embedding model not installed ({type(exc).__name__})",
                int((time.time() - tier_started) * 1000),
            )
        )
        return None

    if similarity >= config.semantic_threshold:
        attempts.append(
            TierAttempt(
                TIER_SEMANTIC,
                "decided",
                similarity,
                similarity,
                f"Semantic match: {similarity:.3f}",
                int((time.time() - tier_started) * 1000),
            )
        )
        return similarity, f"Semantic match: {similarity:.3f}", similarity

    if reference:
        try:
            from backend.judge.semantic_judge import nli_score

            nli = nli_score(output, reference)
            if nli["verdict"] == "contradiction":
                detail = f"NLI contradiction (confidence {nli['score']:.3f})"
                attempts.append(
                    TierAttempt(TIER_SEMANTIC, "decided", nli["score"], config.nli_contradiction_score, detail)
                )
                return config.nli_contradiction_score, detail, nli["score"]
            if nli["verdict"] == "entailment" and nli["score"] >= config.nli_entailment_threshold:
                detail = f"NLI entailment confirmed (confidence {nli['score']:.3f})"
                attempts.append(TierAttempt(TIER_SEMANTIC, "decided", nli["score"], nli["score"], detail))
                return nli["score"], detail, nli["score"]
        except Exception:
            pass

    attempts.append(
        TierAttempt(
            TIER_SEMANTIC,
            "declined",
            similarity,
            similarity,
            f"Similarity {similarity:.3f} below threshold {config.semantic_threshold}",
            int((time.time() - tier_started) * 1000),
        )
    )
    return None


def _finalize(score, reason, tier, confidence, escalated, attempts, started, tokens) -> JudgeVerdict:
    return JudgeVerdict(
        score=round(float(score), 4),
        reason=reason,
        tier=tier,
        confidence=float(confidence),
        escalated=escalated,
        tiers_attempted=attempts,
        latency_ms=int((time.time() - started) * 1000),
        tokens_used=tokens,
    )
