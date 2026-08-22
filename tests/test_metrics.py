"""
Confusion-matrix arithmetic, asserted against hand-computed values.

If these are wrong, every headline number on the scorer-validation page is
wrong, so they are checked against inputs whose answers can be verified by hand.
"""
import pytest

from backend.eval.scorer_validation import (
    _baseline_accuracy,
    confusion_counts,
    metrics_from_confusion,
)

# 26 actual pass / 24 actual fail, 5 errors — the shape of the committed fixture.
KNOWN = {
    "true_positive": 20,
    "false_negative": 4,
    "false_positive": 3,
    "true_negative": 23,
}


def test_confusion_counts_bucket_every_pair():
    pairs = [("pass", "pass")] * 23 + [("pass", "fail")] * 3 + \
            [("fail", "fail")] * 20 + [("fail", "pass")] * 4
    matrix = confusion_counts(pairs)
    assert matrix["actual_pass"] == {"predicted_pass": 23, "predicted_fail": 3}
    assert matrix["actual_fail"] == {"predicted_pass": 4, "predicted_fail": 20}
    assert matrix["total"] == 50
    for key, value in KNOWN.items():
        assert matrix[key] == value


def test_metrics_match_hand_computed_values():
    metrics = metrics_from_confusion(KNOWN)
    # accuracy = (20 + 23) / 50
    assert metrics["accuracy"] == 0.86
    # precision = 20 / (20 + 3)
    assert metrics["precision"] == pytest.approx(0.8696, abs=1e-4)
    # recall = 20 / (20 + 4)
    assert metrics["recall"] == pytest.approx(0.8333, abs=1e-4)
    # f1 = 2pr / (p + r)
    assert metrics["f1"] == pytest.approx(0.8511, abs=1e-4)
    # pass recall (specificity) = 23 / (23 + 3)
    assert metrics["pass_recall"] == pytest.approx(0.8846, abs=1e-4)


def test_perfect_and_useless_classifiers_bound_the_scale():
    perfect = metrics_from_confusion(
        {"true_positive": 24, "false_negative": 0, "false_positive": 0, "true_negative": 26}
    )
    assert perfect == {"accuracy": 1.0, "precision": 1.0, "recall": 1.0, "f1": 1.0, "pass_recall": 1.0}

    inverted = metrics_from_confusion(
        {"true_positive": 0, "false_negative": 24, "false_positive": 26, "true_negative": 0}
    )
    assert inverted["accuracy"] == 0.0
    assert inverted["f1"] == 0.0


def test_metrics_do_not_divide_by_zero_on_an_empty_matrix():
    empty = metrics_from_confusion(
        {"true_positive": 0, "false_negative": 0, "false_positive": 0, "true_negative": 0}
    )
    assert all(value == 0.0 for value in empty.values())


def test_a_classifier_that_never_predicts_fail_has_zero_recall():
    metrics = metrics_from_confusion(
        {"true_positive": 0, "false_negative": 24, "false_positive": 0, "true_negative": 26}
    )
    assert metrics["recall"] == 0.0
    assert metrics["precision"] == 0.0
    assert metrics["accuracy"] == 0.52  # it still gets every pass case right


def test_random_baseline_lands_near_one_half():
    labels = ["pass"] * 26 + ["fail"] * 24
    baseline = _baseline_accuracy(labels, seed=1337, prior=None, trials=400)
    assert 0.45 < baseline["accuracy"] < 0.55
    assert baseline["trials"] == 400


def test_label_prior_baseline_matches_its_closed_form():
    """For a prior-matched coin, expected accuracy is p^2 + (1-p)^2."""
    labels = ["pass"] * 26 + ["fail"] * 24
    p_fail = 24 / 50
    expected = p_fail ** 2 + (1 - p_fail) ** 2
    baseline = _baseline_accuracy(labels, seed=99, prior=p_fail, trials=800)
    assert baseline["accuracy"] == pytest.approx(expected, abs=0.02)


def test_baselines_are_reproducible_from_their_seed():
    labels = ["pass"] * 26 + ["fail"] * 24
    first = _baseline_accuracy(labels, seed=7, prior=None, trials=200)
    second = _baseline_accuracy(labels, seed=7, prior=None, trials=200)
    assert first == second
    assert _baseline_accuracy(labels, seed=8, prior=None, trials=200) != first
