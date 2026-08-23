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


# ── Held-out set ──────────────────────────────────────────────────────────
# The development fixture and the rules share an author, so its accuracy is an
# upper bound. These pin the properties that make the held-out set meaningful.

from backend.eval.scorer_validation import HELDOUT_FIXTURE  # noqa: E402


@pytest.fixture(scope="module")
def heldout():
    return load_fixture(HELDOUT_FIXTURE)


@pytest.fixture(scope="module")
def heldout_report():
    return run_validation(config=OFFLINE, fixture_version=HELDOUT_FIXTURE, trials=200)


def test_heldout_fixture_declares_itself_held_out(heldout):
    assert heldout["held_out"] is True
    assert heldout["rules_frozen_at"]["commit"], "must record when the rules were frozen"
    assert heldout["limitations"]


def test_heldout_cases_are_disjoint_from_the_development_set(heldout, fixture):
    dev_ids = {c["id"] for c in fixture["cases"]}
    held_ids = {c["id"] for c in heldout["cases"]}
    assert dev_ids.isdisjoint(held_ids)

    # Prompts must not be recycled either — a renamed duplicate is not held out.
    dev_prompts = {c["prompt"].strip().lower() for c in fixture["cases"]}
    held_prompts = {c["prompt"].strip().lower() for c in heldout["cases"]}
    assert dev_prompts.isdisjoint(held_prompts)


def test_heldout_uses_the_same_labelling_guide_and_patterns(heldout, fixture):
    assert heldout["labelling_guide"] == fixture["labelling_guide"]
    assert heldout["scorer_expected"] == fixture["scorer_expected"]
    dev_categories = {c["category"] for c in fixture["cases"]}
    held_categories = {c["category"] for c in heldout["cases"]}
    assert held_categories == dev_categories, "a different taxonomy would not be comparable"


def test_heldout_report_is_flagged_as_held_out(heldout_report):
    assert heldout_report["held_out"] is True
    assert heldout_report["rules_frozen_at"]["scorer_config_hash"]


def test_heldout_still_beats_both_random_baselines(heldout_report):
    assert heldout_report["accuracy"] > heldout_report["baseline_random"] + 0.15
    assert heldout_report["accuracy"] > heldout_report["baseline_label_prior"] + 0.15


def test_the_safety_property_survives_out_of_sample(heldout_report):
    """
    The finding worth protecting: accuracy drops out of sample, but recall does
    not. If a change ever makes the scorer miss a fabrication on unseen cases,
    that is a different and much worse tool, and this test should fail.
    """
    assert heldout_report["recall"] == 1.0
    assert heldout_report["confusion_matrix"]["false_negative"] == 0


def test_the_development_set_flatters_the_scorer(heldout_report, report):
    """The gap is the point. If it vanishes, suspect the held-out set was leaked."""
    assert report["accuracy"] > heldout_report["accuracy"], (
        "no generalisation gap at all is suspicious, not reassuring"
    )
