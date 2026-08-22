#!/usr/bin/env python
"""
Run the scorer against the committed fixture and gate on the result.

This is the eval tool's own regression test. CI runs it on every push: if a
change to the rules drops accuracy on the hand-labelled fixture by more than
`--tolerance`, the build fails. Nothing here touches the network or the
database, so it is safe to run anywhere.

    python scripts/validate_scorer.py                 # check against the baseline
    python scripts/validate_scorer.py --update-baseline
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.eval.scorer_validation import DEFAULT_FIXTURE, run_validation  # noqa: E402
from backend.judge.chain import ScorerConfig  # noqa: E402

BASELINE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "backend", "eval", "fixtures", "scorer_baseline.json",
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", default=DEFAULT_FIXTURE)
    parser.add_argument("--tolerance", type=float, default=0.02,
                        help="allowed accuracy drop before the build fails (default: 2 points)")
    parser.add_argument("--update-baseline", action="store_true")
    parser.add_argument("--json", action="store_true", help="print the full report as JSON")
    args = parser.parse_args()

    # Offline config: rules only. The gate must not depend on an API key.
    config = ScorerConfig(semantic_enabled=False, llm_judge_enabled=False)
    report = run_validation(config=config, fixture_version=args.fixture)

    if args.json:
        print(json.dumps(report, indent=2))

    matrix = report["confusion_matrix"]
    print(f"\nFixture           {report['fixture_name']} ({report['fixture_case_count']} cases)")
    print(f"Scorer config     {report['scorer_config_hash']}")
    print(f"\n  accuracy        {report['accuracy']:.4f}")
    print(f"  precision       {report['precision']:.4f}   (positive class: fail)")
    print(f"  recall          {report['recall']:.4f}")
    print(f"  f1              {report['f1']:.4f}")
    print(f"  pass recall     {report['pass_recall']:.4f}")
    print(f"\n  baseline random        {report['baseline_random']:.4f}")
    print(f"  baseline label prior   {report['baseline_label_prior']:.4f}")
    print(f"  (seed {report['baseline_seed']}, {report['baseline_trials']} trials)")
    print("\n  confusion matrix (actual \\ predicted)")
    print(f"    pass  ->  pass {matrix['true_negative']:>3}   fail {matrix['false_positive']:>3}")
    print(f"    fail  ->  pass {matrix['false_negative']:>3}   fail {matrix['true_positive']:>3}")
    print("\n  per category")
    for category, row in report["per_category_breakdown"].items():
        print(f"    {category:<32} {row['correct']}/{row['cases']}  acc {row['accuracy']:.2f}")

    errors = [c for c in report["case_results"] if not c["correct"]]
    if errors:
        print(f"\n  {len(errors)} disagreement(s) with the human labels:")
        for case in errors:
            print(f"    {case['id']:<20} human={case['human_label']:<4} "
                  f"scorer={case['predicted_label']:<4} score={case['score']:.2f}  {case['judge_reason'][:60]}")

    if report["accuracy"] <= max(report["baseline_random"], report["baseline_label_prior"]):
        print("\nFAIL: the scorer does not beat a random baseline.")
        return 1

    if args.update_baseline:
        baseline = {
            "fixture": report["fixture_name"],
            "fixture_version": report["fixture_version"],
            "scorer_config_hash": report["scorer_config_hash"],
            "accuracy": report["accuracy"],
            "precision": report["precision"],
            "recall": report["recall"],
            "f1": report["f1"],
            "baseline_random": report["baseline_random"],
            "baseline_label_prior": report["baseline_label_prior"],
            "recorded_at": report["created_at"],
        }
        with open(BASELINE_PATH, "w") as f:
            json.dump(baseline, f, indent=2)
            f.write("\n")
        print(f"\nBaseline updated: accuracy {report['accuracy']:.4f} -> {BASELINE_PATH}")
        return 0

    if not os.path.exists(BASELINE_PATH):
        print(f"\nNo baseline recorded. Run with --update-baseline to create {BASELINE_PATH}.")
        return 1

    with open(BASELINE_PATH) as f:
        baseline = json.load(f)

    drop = baseline["accuracy"] - report["accuracy"]
    print(f"\nBaseline accuracy {baseline['accuracy']:.4f}  ->  current {report['accuracy']:.4f} "
          f"({-drop:+.4f})")
    if drop > args.tolerance:
        print(f"FAIL: accuracy dropped {drop * 100:.2f} points, tolerance is "
              f"{args.tolerance * 100:.2f}.")
        return 1

    print("OK: scorer accuracy is within tolerance of the recorded baseline.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
