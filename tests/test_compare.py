"""Run-to-run diff: regressions first, severity weighting, mismatch guards."""
from backend.eval.regression import compute_comparison


def result(test_id, score, passed, category="factual", severity=1.0, latency=100,
           tier="rules", escalated=False):
    return {
        "test_id": test_id, "score": score, "passed": passed, "category": category,
        "severity": severity, "latency_ms": latency, "judge_tier": tier,
        "escalated": escalated, "prompt": f"prompt for {test_id}",
        "judge_reason": "reason", "failure_type": None if passed else "hallucination",
    }


def runs(version_a="v2", version_b="v2", pass_a=1.0, pass_b=0.5):
    return (
        {"id": "a", "suite_version": version_a, "pass_rate": pass_a, "p99_latency_ms": 100},
        {"id": "b", "suite_version": version_b, "pass_rate": pass_b, "p99_latency_ms": 150},
    )


def test_a_pass_becoming_a_fail_is_a_regression():
    run_a, run_b = runs()
    diff = compute_comparison(
        run_a, {"t1": result("t1", 1.0, True)},
        run_b, {"t1": result("t1", 0.0, False)},
    )
    assert diff["verdict"] == "regression"
    assert [e["test_id"] for e in diff["regressions"]] == ["t1"]
    assert diff["regressions"][0]["score_delta"] == -1.0
    assert diff["summary"]["regressions"] == 1


def test_a_fail_becoming_a_pass_is_a_fix():
    run_a, run_b = runs()
    diff = compute_comparison(
        run_a, {"t1": result("t1", 0.0, False)},
        run_b, {"t1": result("t1", 1.0, True)},
    )
    assert diff["verdict"] == "improvement"
    assert [e["test_id"] for e in diff["fixes"]] == ["t1"]


def test_score_movement_without_a_verdict_change_is_tracked_separately():
    run_a, run_b = runs()
    diff = compute_comparison(
        run_a, {"t1": result("t1", 0.9, True)},
        run_b, {"t1": result("t1", 0.8, True)},
    )
    assert diff["verdict"] == "neutral"
    assert [e["test_id"] for e in diff["score_changed"]] == ["t1"]
    assert diff["unchanged"] == []


def test_identical_results_are_unchanged():
    run_a, run_b = runs()
    diff = compute_comparison(
        run_a, {"t1": result("t1", 1.0, True)},
        run_b, {"t1": result("t1", 1.0, True)},
    )
    assert len(diff["unchanged"]) == 1
    assert diff["summary"]["avg_score_delta"] == 0.0


def test_regressions_are_ordered_by_severity_first():
    run_a, run_b = runs()
    before = {
        "cheap": result("cheap", 1.0, True, severity=1.0),
        "costly": result("costly", 1.0, True, category="risk", severity=3.0),
    }
    after = {
        "cheap": result("cheap", 0.0, False, severity=1.0),
        "costly": result("costly", 0.0, False, category="risk", severity=3.0),
    }
    diff = compute_comparison(run_a, before, run_b, after)
    assert [e["test_id"] for e in diff["regressions"]] == ["costly", "cheap"]
    assert diff["by_severity"]["highest_severity_regression"] == 3.0


def test_severity_weighting_reflects_where_the_damage_is():
    run_a, run_b = runs()
    before = {
        "policy": result("policy", 1.0, True, category="risk", severity=3.0),
        "math": result("math", 1.0, True, severity=1.0),
    }
    after = {
        "policy": result("policy", 0.0, False, category="risk", severity=3.0),
        "math": result("math", 1.0, True, severity=1.0),
    }
    diff = compute_comparison(run_a, before, run_b, after)
    # Unweighted mean delta is -0.5; weighting by severity makes it worse.
    assert diff["summary"]["avg_score_delta"] == -0.5
    assert diff["summary"]["weighted_score_delta"] == -0.75
    assert diff["by_severity"]["regression_weight"] == 3.0
    assert diff["by_severity"]["regression_weight_share"] == 0.75


def test_tier_changes_are_surfaced():
    run_a, run_b = runs()
    diff = compute_comparison(
        run_a, {"t1": result("t1", 1.0, True, tier="rules")},
        run_b, {"t1": result("t1", 1.0, True, tier="llm_judge", escalated=True)},
    )
    entry = diff["unchanged"][0]
    assert entry["tier_change"] == {
        "from": "rules", "to": "llm_judge",
        "escalated_before": False, "escalated_after": True,
    }
    assert diff["summary"]["tier_changes"] == 1


def test_different_suite_versions_produce_a_loud_warning():
    run_a, run_b = runs(version_a="v1-fast", version_b="v2-fast")
    diff = compute_comparison(
        run_a, {"t1": result("t1", 1.0, True)},
        run_b, {"t1": result("t1", 1.0, True)},
    )
    codes = [w["code"] for w in diff["warnings"]]
    assert "suite_version_mismatch" in codes


def test_non_overlapping_tests_are_reported_not_silently_diffed():
    run_a, run_b = runs()
    diff = compute_comparison(
        run_a, {"only_a": result("only_a", 1.0, True)},
        run_b, {"only_b": result("only_b", 0.0, False)},
    )
    assert diff["only_in_a"] == ["only_a"]
    assert diff["only_in_b"] == ["only_b"]
    assert diff["summary"]["shared_tests"] == 0
    assert "test_set_mismatch" in [w["code"] for w in diff["warnings"]]


def test_category_rollup_groups_by_category():
    run_a, run_b = runs()
    before = {
        "r1": result("r1", 1.0, True, category="risk", severity=2.5),
        "f1": result("f1", 1.0, True, category="factual"),
    }
    after = {
        "r1": result("r1", 0.0, False, category="risk", severity=2.5),
        "f1": result("f1", 1.0, True, category="factual"),
    }
    diff = compute_comparison(run_a, before, run_b, after)
    rollup = {row["category"]: row for row in diff["by_category"]}
    assert rollup["risk"]["regressions"] == 1
    assert rollup["factual"]["regressions"] == 0
