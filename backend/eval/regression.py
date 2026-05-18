"""

""""""
Compares two eval runs and surfaces regressions and improvements.
"""


def compute_regression(run_a: dict, results_a: dict, run_b: dict, results_b: dict) -> dict:
    """
    Diff run_a (baseline) vs run_b (new version).
    Returns a structured regression report.
    """
    new_failures = []
    new_passes = []
    score_deltas = []

    all_test_ids = set(results_a.keys()) | set(results_b.keys())

    for test_id in all_test_ids:
        a = results_a.get(test_id)
        b = results_b.get(test_id)

        if a and b:
            a_passed = a.get("passed", False)
            b_passed = b.get("passed", False)
            delta = (b.get("score", 0) or 0) - (a.get("score", 0) or 0)
            score_deltas.append(delta)

            if a_passed and not b_passed:
                new_failures.append({
                    "test_id": test_id,
                    "prompt": b.get("prompt"),
                    "score_before": a.get("score"),
                    "score_after": b.get("score"),
                    "failure_type": b.get("failure_type"),
                })
            elif not a_passed and b_passed:
                new_passes.append({
                    "test_id": test_id,
                    "prompt": b.get("prompt"),
                    "score_before": a.get("score"),
                    "score_after": b.get("score"),
                })

        elif b and not a:
            # new test only in run_b
            if not b.get("passed"):
                new_failures.append({
                    "test_id": test_id,
                    "prompt": b.get("prompt"),
                    "score_before": None,
                    "score_after": b.get("score"),
                    "failure_type": b.get("failure_type"),
                    "note": "new test"
                })

    pass_rate_delta = (run_b.get("pass_rate", 0) or 0) - (run_a.get("pass_rate", 0) or 0)
    latency_delta = (run_b.get("p99_latency_ms", 0) or 0) - (run_a.get("p99_latency_ms", 0) or 0)
    avg_score_delta = sum(score_deltas) / len(score_deltas) if score_deltas else 0

    verdict = "regression" if (pass_rate_delta < -0.05 or len(new_failures) > 2) else \
              "improvement" if pass_rate_delta > 0.05 else "neutral"

    return {
        "verdict": verdict,
        "pass_rate_delta": round(pass_rate_delta, 4),
        "p99_latency_delta_ms": latency_delta,
        "avg_score_delta": round(avg_score_delta, 4),
        "new_failures": new_failures,
        "new_passes": new_passes,
        "run_a": {"id": run_a.get("id"), "pass_rate": run_a.get("pass_rate")},
        "run_b": {"id": run_b.get("id"), "pass_rate": run_b.get("pass_rate")},
    }