"""
Scorer validation: measuring whether the scorer's own verdicts are trustworthy.

The rest of this project evaluates models. This module evaluates the evaluator.
It replays a hand-labelled fixture through the exact production scoring path
(`backend.judge.chain.judge_output`) and compares the result against two random
baselines. Without a baseline, "86% accurate" is a number with no scale.

Positive class is `fail` — i.e. the scorer's job is framed as *detecting a
hallucination*, so precision/recall describe how well it catches fabrication.
"""
import json
import os
import random
from datetime import datetime, timezone

from backend.judge.chain import ScorerConfig, judge_output

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
DEFAULT_FIXTURE = "hallucination_benchmark_v1"
HELDOUT_FIXTURE = "hallucination_heldout_v1"
BASELINE_TRIALS = 1000
DEFAULT_SEED = 1337

LABEL_PASS = "pass"
LABEL_FAIL = "fail"


def load_fixture(version: str = DEFAULT_FIXTURE) -> dict:
    """Load a benchmark fixture by file stem (e.g. 'hallucination_benchmark_v1')."""
    safe = os.path.basename(version)
    if not safe.endswith(".json"):
        safe += ".json"
    path = os.path.join(FIXTURE_DIR, safe)
    if not os.path.exists(path):
        raise FileNotFoundError(f"No fixture named {version!r} in {FIXTURE_DIR}")
    with open(path) as f:
        return json.load(f)


def list_fixtures() -> list[str]:
    """
    Benchmark fixtures only. The directory also holds `scorer_baseline.json`
    (the accuracy CI gates against), which is not something you can validate
    against — a fixture is a file with labelled `cases`.
    """
    if not os.path.isdir(FIXTURE_DIR):
        return []

    names = []
    for filename in sorted(os.listdir(FIXTURE_DIR)):
        if not filename.endswith(".json"):
            continue
        try:
            with open(os.path.join(FIXTURE_DIR, filename)) as f:
                if json.load(f).get("cases"):
                    names.append(filename[:-5])
        except (json.JSONDecodeError, OSError):
            continue
    return names


# ── metrics ────────────────────────────────────────────────────────────────

def confusion_counts(pairs: list[tuple[str, str]]) -> dict:
    """
    pairs: (human_label, predicted_label). Positive class is `fail`.
    Returns the raw 2x2 counts plus tp/fp/tn/fn aliases.
    """
    matrix = {
        "actual_pass": {"predicted_pass": 0, "predicted_fail": 0},
        "actual_fail": {"predicted_pass": 0, "predicted_fail": 0},
    }
    for actual, predicted in pairs:
        matrix[f"actual_{actual}"][f"predicted_{predicted}"] += 1

    tp = matrix["actual_fail"]["predicted_fail"]
    fn = matrix["actual_fail"]["predicted_pass"]
    fp = matrix["actual_pass"]["predicted_fail"]
    tn = matrix["actual_pass"]["predicted_pass"]
    matrix["true_positive"] = tp
    matrix["false_negative"] = fn
    matrix["false_positive"] = fp
    matrix["true_negative"] = tn
    matrix["total"] = tp + fn + fp + tn
    return matrix


def metrics_from_confusion(matrix: dict) -> dict:
    tp = matrix["true_positive"]
    fn = matrix["false_negative"]
    fp = matrix["false_positive"]
    tn = matrix["true_negative"]
    total = tp + fn + fp + tn

    accuracy = (tp + tn) / total if total else 0.0
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    pass_recall = tn / (tn + fp) if (tn + fp) else 0.0

    return {
        "accuracy": round(accuracy, 4),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "pass_recall": round(pass_recall, 4),
    }


def _baseline_accuracy(labels: list[str], seed: int, prior: float | None, trials: int) -> dict:
    """
    Mean accuracy of a random classifier over `trials` seeded draws.

    prior=None  -> unbiased 50/50 coin.
    prior=p     -> predicts `fail` with probability p (the fixture's own fail rate).
    """
    rng = random.Random(seed)
    p_fail = 0.5 if prior is None else prior
    accuracies = []
    aggregate = [0, 0, 0, 0]  # tp, fn, fp, tn

    for _ in range(trials):
        pairs = [
            (actual, LABEL_FAIL if rng.random() < p_fail else LABEL_PASS)
            for actual in labels
        ]
        matrix = confusion_counts(pairs)
        aggregate[0] += matrix["true_positive"]
        aggregate[1] += matrix["false_negative"]
        aggregate[2] += matrix["false_positive"]
        aggregate[3] += matrix["true_negative"]
        accuracies.append(metrics_from_confusion(matrix)["accuracy"])

    mean_matrix = {
        "true_positive": aggregate[0] / trials,
        "false_negative": aggregate[1] / trials,
        "false_positive": aggregate[2] / trials,
        "true_negative": aggregate[3] / trials,
    }
    mean = sum(accuracies) / len(accuracies)
    return {
        "accuracy": round(mean, 4),
        "min_accuracy": round(min(accuracies), 4),
        "max_accuracy": round(max(accuracies), 4),
        "p_fail": round(p_fail, 4),
        "trials": trials,
        "mean_metrics": metrics_from_confusion(mean_matrix),
    }


# ── the harness ────────────────────────────────────────────────────────────

def run_validation(
    config: ScorerConfig | None = None,
    fixture_version: str = DEFAULT_FIXTURE,
    seed: int = DEFAULT_SEED,
    trials: int = BASELINE_TRIALS,
) -> dict:
    """
    Score every fixture case with the given scorer config and report how well the
    scorer agrees with the human labels, against both random baselines.
    """
    config = config or ScorerConfig()
    fixture = load_fixture(fixture_version)
    cases = fixture["cases"]
    expected_template = fixture.get("scorer_expected", {"type": "hallucination"})

    case_results = []
    pairs = []
    escalated = 0
    tier_counts: dict[str, int] = {}
    total_judge_latency = 0
    total_tokens = 0

    for case in cases:
        expected = dict(expected_template)
        verdict = judge_output(case["model_output"], expected, config)
        predicted = LABEL_PASS if verdict.score >= config.pass_threshold else LABEL_FAIL
        correct = predicted == case["human_label"]

        pairs.append((case["human_label"], predicted))
        escalated += 1 if verdict.escalated else 0
        tier_counts[verdict.tier] = tier_counts.get(verdict.tier, 0) + 1
        total_judge_latency += verdict.latency_ms
        total_tokens += verdict.tokens_used

        case_results.append({
            "id": case["id"],
            "category": case["category"],
            "prompt": case["prompt"],
            "model_output": case["model_output"],
            "human_label": case["human_label"],
            "label_rationale": case.get("label_rationale", ""),
            "predicted_label": predicted,
            "correct": correct,
            "cell": f"actual_{case['human_label']}__predicted_{predicted}",
            "score": verdict.score,
            "judge_tier": verdict.tier,
            "tier_confidence": round(verdict.confidence, 4),
            "escalated": verdict.escalated,
            "judge_reason": verdict.reason,
            "tiers_attempted": [t.to_dict() for t in verdict.tiers_attempted],
        })

    matrix = confusion_counts(pairs)
    scorer_metrics = metrics_from_confusion(matrix)

    labels = [c["human_label"] for c in cases]
    fail_rate = labels.count(LABEL_FAIL) / len(labels) if labels else 0.5
    baseline_random = _baseline_accuracy(labels, seed, None, trials)
    baseline_prior = _baseline_accuracy(labels, seed + 1, fail_rate, trials)

    return {
        "fixture_version": fixture.get("version", fixture_version),
        "fixture_name": fixture_version,
        "fixture_case_count": len(cases),
        # True when the fixture was authored after the rules were frozen, so its
        # accuracy is a generalisation estimate rather than an upper bound.
        "held_out": bool(fixture.get("held_out", False)),
        "rules_frozen_at": fixture.get("rules_frozen_at"),
        "scorer_config": config.to_dict(),
        "scorer_config_hash": config.config_hash(),
        **scorer_metrics,
        "confusion_matrix": matrix,
        "baseline_random": baseline_random["accuracy"],
        "baseline_label_prior": baseline_prior["accuracy"],
        "baseline_detail": {"random": baseline_random, "label_prior": baseline_prior},
        "baseline_seed": seed,
        "baseline_trials": trials,
        "per_category_breakdown": _per_category(case_results),
        "escalation_rate": round(escalated / len(cases), 4) if cases else 0.0,
        "tier_distribution": tier_counts,
        "judge_latency_ms": total_judge_latency,
        "judge_tokens_used": total_tokens,
        "case_results": case_results,
        "limitations": fixture.get("limitations", []),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def _per_category(case_results: list[dict]) -> dict:
    buckets: dict[str, list[dict]] = {}
    for case in case_results:
        buckets.setdefault(case["category"], []).append(case)

    breakdown = {}
    for category, items in sorted(buckets.items()):
        pairs = [(c["human_label"], c["predicted_label"]) for c in items]
        matrix = confusion_counts(pairs)
        breakdown[category] = {
            "cases": len(items),
            "correct": sum(1 for c in items if c["correct"]),
            **metrics_from_confusion(matrix),
            "confusion_matrix": matrix,
        }
    return breakdown
