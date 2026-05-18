import json
import os
from flask import Blueprint, request, jsonify
from backend.eval.regression import compute_regression
from backend.models.eval_run import EvalRun
from backend.models.eval_result import EvalResult
from backend.extensions import db

api_bp = Blueprint("api", __name__)


def _load_suite_tests():
    suite_path = os.path.join(os.path.dirname(__file__), "../eval/test_suite.json")
    with open(suite_path) as f:
        return json.load(f)


def _classify_failure(output: str, expected: dict, error: str | None = None) -> str:
    if error:
        return "timeout" if "timeout" in error.lower() else "error"
    if expected.get("type") == "safety":
        return "jailbreak"
    if not output or len(output.strip()) < 10:
        return "refusal"
    return "hallucination"


def _update_run_summary(run_id: str):
    run = EvalRun.query.get(run_id)
    if not run:
        return None

    results = EvalResult.query.filter_by(run_id=run_id).all()
    latencies = sorted([r.latency_ms or 0 for r in results])
    passed = sum(1 for r in results if r.passed)
    total = len(results)

    run.total_tests = total
    run.passed = passed
    run.failed = total - passed
    run.pass_rate = passed / total if total else 0.0
    run.avg_latency_ms = int(sum(latencies) / total) if total else 0
    run.p99_latency_ms = latencies[min(total - 1, int(total * 0.99))] if total else 0
    return run


@api_bp.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "version": "groq-target-v2"})


@api_bp.route("/ping", methods=["GET"])
def ping():
    return "pong", 200


@api_bp.route("/eval/run", methods=["POST"])
def trigger_eval():
    """
    Run a single eval synchronously.
    Body: { prompt, model_endpoint, expected_behavior, suite_version }
    """
    data = request.get_json() or {}

    required = ["prompt", "expected_behavior"]
    if not all(k in data for k in required):
        return jsonify({"error": f"Missing fields: {required}"}), 400

    from backend.eval.runner import run_single_eval

    result = run_single_eval(
        prompt=data["prompt"],
        model_endpoint=data.get("model_endpoint", "groq"),
        expected=data["expected_behavior"],
        model=data.get("model"),
        test_id=data.get("test_id"),
    )

    run_id = data.get("run_id")
    if run_id:
        run = EvalRun.query.get(run_id)
        if run:
            eval_result = EvalResult(
                run_id=run.id,
                test_id=result.get("test_id") or data.get("test_id") or "single-eval",
                prompt=data["prompt"],
                output=result.get("output", ""),
                score=result.get("score", 0.0),
                passed=result.get("passed", False),
                failure_type=None if result.get("passed") else _classify_failure(
                    result.get("output", ""),
                    data["expected_behavior"],
                    result.get("error"),
                ),
                latency_ms=result.get("latency_ms", 0),
                judge_reason=result.get("reason", ""),
            )
            db.session.add(eval_result)
            _update_run_summary(run.id)
            db.session.commit()
            result["run_id"] = run.id

    return jsonify(result), 200


@api_bp.route("/eval/adversarial", methods=["POST"])
def trigger_adversarial():
    """
    Auto-generate adversarial variants of a prompt and eval all of them.
    Body: { base_prompt, model_endpoint, n_attacks }
    """
    data = request.get_json() or {}
    required = ["base_prompt"]
    if not all(k in data for k in required):
        return jsonify({"error": f"Missing fields: {required}"}), 400

    from backend.eval.adversarial import generate_attacks
    from backend.eval.runner import run_single_eval

    attacks = generate_attacks(data["base_prompt"], n=data.get("n_attacks", 10))
    expected = {"description": "refuse harmful request or respond safely", "type": "safety"}
    results = []
    passed_count = 0

    for attack_prompt in attacks:
        result = run_single_eval(
            prompt=attack_prompt,
            model_endpoint=data.get("model_endpoint", "groq"),
            expected=expected,
            model=data.get("model"),
        )
        results.append(result)
        if result["passed"]:
            passed_count += 1

    total = len(results)
    return jsonify({
        "total": total,
        "passed": passed_count,
        "failed": total - passed_count,
        "pass_rate": passed_count / total if total else 0,
        "results": results,
    }), 200


@api_bp.route("/eval/suite/tests", methods=["GET"])
def get_suite_tests():
    """Return suite tests for client-side sequential execution."""
    tests = _load_suite_tests()
    return jsonify({
        "total": len(tests),
        "tests": tests,
    }), 200


@api_bp.route("/eval/suite", methods=["POST"])
def run_suite():
    """Run all tests in the suite against a model endpoint."""
    from concurrent.futures import ThreadPoolExecutor

    data = request.get_json() or {}

    tests = _load_suite_tests()

    from backend.eval.runner import run_single_eval

    model_endpoint = data.get("model_endpoint", "groq")
    model = data.get("model")
    suite_version = data.get("suite_version", "v1")

    def run_test(test):
        expected = dict(test["expected_behavior"])
        expected["skip_llm_judge"] = True
        result = run_single_eval(
            prompt=test["prompt"],
            model_endpoint=model_endpoint,
            expected=expected,
            model=model,
            test_id=test["test_id"],
        )
        result["suite_version"] = suite_version
        return result

    max_workers = int(os.getenv("SUITE_CONCURRENCY", "1"))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        results = list(executor.map(run_test, tests))

    passed_count = sum(1 for result in results if result["passed"])

    total = len(results)
    return jsonify({
        "total": total,
        "passed": passed_count,
        "failed": total - passed_count,
        "pass_rate": passed_count / total if total else 0,
        "results": results,
    }), 200


@api_bp.route("/runs", methods=["GET"])
def list_runs():
    """List all eval runs with summary stats."""
    runs = EvalRun.query.order_by(EvalRun.created_at.desc()).limit(50).all()
    return jsonify([r.to_dict() for r in runs])


@api_bp.route("/runs", methods=["POST"])
def create_run():
    """Create an eval run that can receive incremental results."""
    data = request.get_json() or {}
    run = EvalRun(
        model_endpoint=data.get("model_endpoint", "groq"),
        suite_version=data.get("suite_version", "v1"),
    )
    db.session.add(run)
    db.session.commit()
    return jsonify(run.to_dict()), 201


@api_bp.route("/runs/<run_id>", methods=["GET"])
def get_run(run_id):
    """Get a single run with all its individual results."""
    run = EvalRun.query.get_or_404(run_id)
    results = EvalResult.query.filter_by(run_id=run_id).all()
    return jsonify({
        "run": run.to_dict(),
        "results": [r.to_dict() for r in results]
    })


@api_bp.route("/regression/<run_a_id>/<run_b_id>", methods=["GET"])
def regression(run_a_id, run_b_id):
    """Diff two eval runs and show what regressed."""
    run_a = EvalRun.query.get_or_404(run_a_id)
    run_b = EvalRun.query.get_or_404(run_b_id)

    results_a = {r.test_id: r.to_dict() for r in EvalResult.query.filter_by(run_id=run_a_id).all()}
    results_b = {r.test_id: r.to_dict() for r in EvalResult.query.filter_by(run_id=run_b_id).all()}

    diff = compute_regression(run_a.to_dict(), results_a, run_b.to_dict(), results_b)
    return jsonify(diff)
