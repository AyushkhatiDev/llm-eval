"""
Run-to-run diff.

A compare view exists to answer one question first: what got worse? Regressions
are therefore computed and ordered before anything else, and rolled up by
category and by severity weight so that a single fabricated-policy regression is
not averaged away by twenty unchanged arithmetic tests.
"""


def _tier_change(a: dict, b: dict) -> dict | None:
    tier_a, tier_b = a.get("judge_tier"), b.get("judge_tier")
    if tier_a == tier_b and bool(a.get("escalated")) == bool(b.get("escalated")):
        return None
    return {
        "from": tier_a,
        "to": tier_b,
        "escalated_before": bool(a.get("escalated")),
        "escalated_after": bool(b.get("escalated")),
    }


def _pair(test_id: str, a: dict, b: dict) -> dict:
    score_a = a.get("score") or 0.0
    score_b = b.get("score") or 0.0
    return {
        "test_id": test_id,
        "category": b.get("category") or a.get("category"),
        "severity": b.get("severity") or a.get("severity") or 1.0,
        "prompt": b.get("prompt") or a.get("prompt"),
        "passed_before": bool(a.get("passed")),
        "passed_after": bool(b.get("passed")),
        "score_before": a.get("score"),
        "score_after": b.get("score"),
        "score_delta": round(score_b - score_a, 4),
        "latency_before_ms": a.get("latency_ms"),
        "latency_after_ms": b.get("latency_ms"),
        "latency_delta_ms": (b.get("latency_ms") or 0) - (a.get("latency_ms") or 0),
        "judge_reason_before": a.get("judge_reason"),
        "judge_reason_after": b.get("judge_reason"),
        "failure_type": b.get("failure_type"),
        "tier_change": _tier_change(a, b),
    }


def _weighted(entries: list[dict], key: str) -> float | None:
    total_weight = sum(e.get("severity") or 1.0 for e in entries)
    if not total_weight:
        return None
    return round(sum((e.get(key) or 0.0) * (e.get("severity") or 1.0) for e in entries) / total_weight, 4)


def compute_comparison(run_a: dict, results_a: dict, run_b: dict, results_b: dict) -> dict:
    """
    Diff run A (baseline) against run B (candidate).

    `results_a` / `results_b` are {test_id: result_dict}.
    """
    ids_a, ids_b = set(results_a), set(results_b)
    shared = sorted(ids_a & ids_b)

    regressions, fixes, unchanged, changed_score = [], [], [], []
    for test_id in shared:
        entry = _pair(test_id, results_a[test_id], results_b[test_id])
        if entry["passed_before"] and not entry["passed_after"]:
            regressions.append(entry)
        elif not entry["passed_before"] and entry["passed_after"]:
            fixes.append(entry)
        elif abs(entry["score_delta"]) > 1e-9:
            changed_score.append(entry)
        else:
            unchanged.append(entry)

    # Worst regressions first: severity, then how far the score fell.
    regressions.sort(key=lambda e: (-(e["severity"] or 1.0), e["score_delta"]))
    fixes.sort(key=lambda e: (-(e["severity"] or 1.0), -e["score_delta"]))

    only_in_a = sorted(ids_a - ids_b)
    only_in_b = sorted(ids_b - ids_a)

    warnings = []
    version_a = run_a.get("suite_version")
    version_b = run_b.get("suite_version")
    if version_a != version_b:
        warnings.append({
            "code": "suite_version_mismatch",
            "message": (
                f"Run A ran suite '{version_a}' and run B ran suite '{version_b}'. "
                "Differences below may reflect a change to the suite rather than to the model."
            ),
        })
    if only_in_a or only_in_b:
        warnings.append({
            "code": "test_set_mismatch",
            "message": (
                f"{len(only_in_a)} test(s) present only in run A and {len(only_in_b)} only in run B. "
                "Only the {shared} shared tests are diffed.".format(shared=len(shared))
            ),
            "only_in_a": only_in_a,
            "only_in_b": only_in_b,
        })

    all_pairs = regressions + fixes + changed_score + unchanged
    verdict = "regression" if regressions else ("improvement" if fixes else "neutral")

    return {
        "verdict": verdict,
        "warnings": warnings,
        "run_a": run_a,
        "run_b": run_b,
        "summary": {
            "shared_tests": len(shared),
            "regressions": len(regressions),
            "fixes": len(fixes),
            "score_changed": len(changed_score),
            "unchanged": len(unchanged),
            "pass_rate_delta": round((run_b.get("pass_rate") or 0) - (run_a.get("pass_rate") or 0), 4),
            "weighted_score_before": _weighted(all_pairs, "score_before"),
            "weighted_score_after": _weighted(all_pairs, "score_after"),
            "weighted_score_delta": _weighted(all_pairs, "score_delta"),
            "avg_score_delta": round(
                sum(e["score_delta"] for e in all_pairs) / len(all_pairs), 4
            ) if all_pairs else 0.0,
            "avg_latency_delta_ms": int(
                sum(e["latency_delta_ms"] for e in all_pairs) / len(all_pairs)
            ) if all_pairs else 0,
            "p99_latency_delta_ms": (run_b.get("p99_latency_ms") or 0) - (run_a.get("p99_latency_ms") or 0),
            "escalation_rate_before": run_a.get("escalation_rate"),
            "escalation_rate_after": run_b.get("escalation_rate"),
            "tier_changes": sum(1 for e in all_pairs if e["tier_change"]),
        },
        "regressions": regressions,
        "fixes": fixes,
        "score_changed": changed_score,
        "unchanged": unchanged,
        "by_category": _category_rollup(all_pairs),
        "by_severity": _severity_rollup(regressions, fixes, all_pairs),
        "only_in_a": only_in_a,
        "only_in_b": only_in_b,
    }


def _category_rollup(pairs: list[dict]) -> list[dict]:
    buckets: dict[str, list[dict]] = {}
    for entry in pairs:
        buckets.setdefault(entry["category"] or "uncategorized", []).append(entry)

    rollup = []
    for category, entries in sorted(buckets.items()):
        rollup.append({
            "category": category,
            "tests": len(entries),
            "regressions": sum(1 for e in entries if e["passed_before"] and not e["passed_after"]),
            "fixes": sum(1 for e in entries if not e["passed_before"] and e["passed_after"]),
            "avg_score_delta": round(sum(e["score_delta"] for e in entries) / len(entries), 4),
            "weighted_score_delta": _weighted(entries, "score_delta"),
        })
    return rollup


def _severity_rollup(regressions: list[dict], fixes: list[dict], pairs: list[dict]) -> dict:
    """
    Severity-weighted view: how much of the damage sits in the high-weight tests.
    """
    regression_weight = sum(e.get("severity") or 1.0 for e in regressions)
    fix_weight = sum(e.get("severity") or 1.0 for e in fixes)
    total_weight = sum(e.get("severity") or 1.0 for e in pairs)
    return {
        "regression_weight": round(regression_weight, 4),
        "fix_weight": round(fix_weight, 4),
        "total_weight": round(total_weight, 4),
        "net_weight": round(fix_weight - regression_weight, 4),
        "regression_weight_share": round(regression_weight / total_weight, 4) if total_weight else 0.0,
        "highest_severity_regression": max(
            (e.get("severity") or 1.0 for e in regressions), default=0.0
        ),
    }


def compute_regression(run_a: dict, results_a: dict, run_b: dict, results_b: dict) -> dict:
    """Legacy shape kept for the older /regression/<a>/<b> endpoint."""
    full = compute_comparison(run_a, results_a, run_b, results_b)
    return {
        "verdict": full["verdict"],
        "pass_rate_delta": full["summary"]["pass_rate_delta"],
        "p99_latency_delta_ms": full["summary"]["p99_latency_delta_ms"],
        "avg_score_delta": full["summary"]["avg_score_delta"],
        "new_failures": full["regressions"],
        "new_passes": full["fixes"],
        "run_a": {"id": run_a.get("id"), "pass_rate": run_a.get("pass_rate")},
        "run_b": {"id": run_b.get("id"), "pass_rate": run_b.get("pass_rate")},
    }
