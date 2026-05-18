from flask import Blueprint, request, jsonify
from backend.eval.regression import compute_regression
from backend.models.eval_run import EvalRun
from backend.models.eval_result import EvalResult
from backend.extensions import db
from workers.celery_app import celery as celery_app

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
    Trigger a new eval run.
    Body: { prompt, model_endpoint, expected_behavior, suite_version }
    """
    data = request.get_json()

    required = ["prompt", "model_endpoint", "expected_behavior"]
    if not all(k in data for k in required):
        return jsonify({"error": f"Missing fields: {required}"}), 400

    from workers.tasks import run_eval_task

    task = run_eval_task.delay(data)
    return jsonify({"task_id": task.id, "status": "queued"}), 202


@api_bp.route("/eval/adversarial", methods=["POST"])
def trigger_adversarial():
    """
    Auto-generate adversarial variants of a prompt and eval all of them.
    Body: { base_prompt, model_endpoint, n_attacks }
    """
    data = request.get_json()
    from workers.tasks import run_adversarial_task

    task = run_adversarial_task.delay(data)
    return jsonify({"task_id": task.id, "status": "queued"}), 202


@api_bp.route("/eval/status/<task_id>", methods=["GET"])
def get_status(task_id):
    result = celery_app.AsyncResult(task_id)
    response = {
        "task_id": task_id,
        "status": result.status,
        "result": None
    }
    if result.ready():
        if result.successful():
            response["result"] = result.result
        else:
            response["result"] = {"error": str(result.result)}
    return jsonify(response)


@api_bp.route("/eval/suite", methods=["POST"])
def run_suite():
    """Run all tests in the suite against a model endpoint."""
    import json, os
    data = request.get_json()

    if not data or "model_endpoint" not in data:
        return jsonify({"error": "Missing required field: model_endpoint"}), 400

    suite_path = os.path.join(os.path.dirname(__file__), "../eval/test_suite.json")

    with open(suite_path) as f:
        tests = json.load(f)

    task_ids = []
    from workers.tasks import run_eval_task

    for test in tests:
        task_data = {
            "test_id": test["test_id"],
            "prompt": test["prompt"],
            "model_endpoint": data["model_endpoint"],
            "expected_behavior": test["expected_behavior"],
            "suite_version": data.get("suite_version", "v1")
        }
        task = run_eval_task.delay(task_data)
        task_ids.append({"test_id": test["test_id"], "task_id": task.id})

    return jsonify({"task_ids": task_ids, "total": len(tests)}), 202


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
