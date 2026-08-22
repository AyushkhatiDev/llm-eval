"""
Flakiness check: run the same test N times and report score variance.

A suite that reports 93% but silently returns a different 93% each time is not a
regression gate. Repeating a single test under a fixed config isolates the
non-determinism that remains after temperature and seed are pinned — provider
nondeterminism, judge variance, or a rule that sits right on a threshold.
"""
import statistics

from backend.eval.runner import run_single_eval
from backend.judge.chain import ScorerConfig

DEFAULT_REPEATS = 5
# Above this standard deviation a test's verdict is not stable enough to gate on.
UNSTABLE_STDEV = 0.15


def check_test_flakiness(
    prompt: str,
    expected: dict,
    model_endpoint: str = "groq",
    model: str | None = None,
    test_id: str | None = None,
    messages: list[dict] | None = None,
    repeats: int = DEFAULT_REPEATS,
    scorer_config: ScorerConfig | None = None,
) -> dict:
    config = scorer_config or ScorerConfig.from_expected(expected)
    runs = []
    for index in range(repeats):
        result = run_single_eval(
            prompt=prompt,
            model_endpoint=model_endpoint,
            expected=expected,
            model=model,
            test_id=test_id,
            messages=messages,
            scorer_config=config,
        )
        runs.append({
            "iteration": index + 1,
            "score": result["score"],
            "passed": result["passed"],
            "judge_tier": result["judge_tier"],
            "escalated": result["escalated"],
            "latency_ms": result["latency_ms"],
            "reason": result["reason"],
            "output": result["output"],
            "error": result.get("error"),
        })

    scores = [r["score"] for r in runs]
    verdicts = [r["passed"] for r in runs]
    stdev = statistics.pstdev(scores) if len(scores) > 1 else 0.0
    flipped = len(set(verdicts)) > 1

    return {
        "test_id": test_id,
        "repeats": repeats,
        "scores": scores,
        "mean_score": round(statistics.fmean(scores), 4) if scores else 0.0,
        "min_score": min(scores) if scores else 0.0,
        "max_score": max(scores) if scores else 0.0,
        "score_range": round(max(scores) - min(scores), 4) if scores else 0.0,
        "stdev": round(stdev, 4),
        "pass_count": sum(1 for v in verdicts if v),
        "verdict_flipped": flipped,
        # A verdict that flips at all is unreliable regardless of variance size:
        # it is the difference between a green build and a red one.
        "unstable": flipped or stdev > UNSTABLE_STDEV,
        "unstable_reason": (
            "pass/fail verdict changed between identical runs" if flipped
            else f"score stdev {stdev:.3f} exceeds {UNSTABLE_STDEV}" if stdev > UNSTABLE_STDEV
            else None
        ),
        "scorer_config_hash": config.config_hash(),
        "runs": runs,
    }
