from flask import Blueprint, request, jsonify
from backend.eval.regression import compute_regression
from backend.models.eval_run import EvalRun
from backend.models.eval_result import EvalResult
from backend.extensions import db

api_bp = Blueprint("api", __name__)


@api_bp.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


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

    required = ["prompt", "model_endpoint", "expected_behavior"]
    if not all(k in data for k in required):
        return jsonify({"error": f"Missing fields: {required}"}), 400

    from backend.eval.runner import run_single_eval

    result = run_single_eval(
        prompt=data["prompt"],
        model_endpoint=data["model_endpoint"],
        expected=data["expected_behavior"],
        model=data.get("model"),
    )
    return jsonify(result), 200


@api_bp.route("/eval/adversarial", methods=["POST"])
def trigger_adversarial():
    """
    Auto-generate adversarial variants of a prompt and eval all of them.
    Body: { base_prompt, model_endpoint, n_attacks }
    """
    data = request.get_json() or {}
    required = ["base_prompt", "model_endpoint"]
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
            model_endpoint=data["model_endpoint"],
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


@api_bp.route("/eval/suite", methods=["POST"])
def run_suite():
    """Run all tests in the suite against a model endpoint."""
    import json, os
    data = request.get_json() or {}

    if not data or "model_endpoint" not in data:
        return jsonify({"error": "Missing required field: model_endpoint"}), 400

    suite_path = os.path.join(os.path.dirname(__file__), "../eval/test_suite.json")

    with open(suite_path) as f:
        tests = json.load(f)

    from backend.eval.runner import run_single_eval

    results = []
    passed_count = 0

    for test in tests:
        result = run_single_eval(
            prompt=test["prompt"],
            model_endpoint=data["model_endpoint"],
            expected=test["expected_behavior"],
            model=data.get("model"),
        )
        result.update({
            "test_id": test["test_id"],
            "suite_version": data.get("suite_version", "v1")
        })
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


@api_bp.route("/runs", methods=["GET"])
def list_runs():
    """List all eval runs with summary stats."""
    runs = EvalRun.query.order_by(EvalRun.created_at.desc()).limit(50).all()
    return jsonify([r.to_dict() for r in runs])


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
