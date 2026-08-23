"""Fixture integrity and the end-to-end validation harness."""
import pytest

from backend.eval.scorer_validation import (
    DEFAULT_FIXTURE,
    load_fixture,
    run_validation,
)
from backend.judge.chain import ScorerConfig

OFFLINE = ScorerConfig(semantic_enabled=False, llm_judge_enabled=False)


@pytest.fixture(scope="module")
def fixture():
    return load_fixture(DEFAULT_FIXTURE)


@pytest.fixture(scope="module")
def report():
    return run_validation(config=OFFLINE, trials=200)


def test_fixture_has_the_documented_shape(fixture):
    assert fixture["version"] == "v1"
    assert len(fixture["cases"]) == 50
    assert fixture["limitations"], "a fixture without stated limitations should not ship"
    assert fixture["scorer_expected"]["type"] == "hallucination"


def test_every_case_carries_the_required_fields(fixture):
    required = {
        "id", "category", "prompt", "model_output",
        "human_label", "label_rationale", "labelled_by", "labelled_at",
    }
    for case in fixture["cases"]:
        assert required <= set(case), f"{case.get('id')} is missing fields"
        assert case["human_label"] in {"pass", "fail"}
        assert case["label_rationale"].strip(), f"{case['id']} has no rationale"


def test_case_ids_are_unique(fixture):
    ids = [c["id"] for c in fixture["cases"]]
    assert len(set(ids)) == len(ids)


def test_all_five_hallucination_patterns_are_covered_evenly(fixture):
    counts = {}
    for case in fixture["cases"]:
        counts[case["category"]] = counts.get(case["category"], 0) + 1
    assert len(counts) == 5
    assert set(counts.values()) == {10}


def test_labels_are_not_lopsided(fixture):
    fails = sum(1 for c in fixture["cases"] if c["human_label"] == "fail")
    assert 20 <= fails <= 30, "a badly skewed fixture makes accuracy uninformative"


def test_validation_reports_the_full_metric_set(report):
    for key in ("accuracy", "precision", "recall", "f1", "pass_recall"):
        assert 0.0 <= report[key] <= 1.0
    assert report["confusion_matrix"]["total"] == 50
    assert report["fixture_case_count"] == 50


def test_scorer_beats_both_random_baselines(report):
    assert report["accuracy"] > report["baseline_random"] + 0.15
    assert report["accuracy"] > report["baseline_label_prior"] + 0.15


def test_confusion_matrix_is_consistent_with_the_case_list(report):
    matrix = report["confusion_matrix"]
    counted = {}
    for case in report["case_results"]:
        counted[case["cell"]] = counted.get(case["cell"], 0) + 1
    assert matrix["actual_fail"]["predicted_fail"] == counted.get("actual_fail__predicted_fail", 0)
    assert matrix["actual_pass"]["predicted_pass"] == counted.get("actual_pass__predicted_pass", 0)
    assert matrix["actual_pass"]["predicted_fail"] == counted.get("actual_pass__predicted_fail", 0)
    assert matrix["actual_fail"]["predicted_pass"] == counted.get("actual_fail__predicted_pass", 0)


def test_every_case_result_names_the_tier_that_decided_it(report):
    for case in report["case_results"]:
        assert case["judge_tier"], f"{case['id']} has no tier recorded"
        assert case["tiers_attempted"], f"{case['id']} has no tier trace"
        assert case["correct"] == (case["predicted_label"] == case["human_label"])


def test_per_category_breakdown_covers_every_category(report):
    breakdown = report["per_category_breakdown"]
    assert len(breakdown) == 5
    assert sum(v["cases"] for v in breakdown.values()) == 50
    assert sum(v["correct"] for v in breakdown.values()) == sum(
        1 for c in report["case_results"] if c["correct"]
    )


def test_offline_validation_makes_no_api_calls(report):
    assert report["escalation_rate"] == 0.0
    assert report["judge_tokens_used"] == 0


def test_validation_is_deterministic():
    first = run_validation(config=OFFLINE, seed=5, trials=100)
    second = run_validation(config=OFFLINE, seed=5, trials=100)
    assert first["accuracy"] == second["accuracy"]
    assert first["baseline_random"] == second["baseline_random"]
    assert first["scorer_config_hash"] == second["scorer_config_hash"]


def test_unknown_fixture_raises():
    with pytest.raises(FileNotFoundError):
        run_validation(config=OFFLINE, fixture_version="does_not_exist")


def test_fixture_listing_excludes_the_ci_baseline_file():
    """`scorer_baseline.json` lives alongside the fixtures but is not one."""
    from backend.eval.scorer_validation import list_fixtures

    names = list_fixtures()
    assert DEFAULT_FIXTURE in names
    assert "scorer_baseline" not in names
