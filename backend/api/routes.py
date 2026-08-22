import json
import os

from flask import Blueprint, jsonify, request

from backend.api import stats
from backend.eval.flakiness import DEFAULT_REPEATS, check_test_flakiness
from backend.eval.regression import compute_comparison, compute_regression
from backend.eval.scorer_validation import (
    DEFAULT_FIXTURE,
    DEFAULT_SEED,
    list_fixtures,
    load_fixture,
    run_validation,
)
from backend.extensions import db
from backend.judge.chain import ScorerConfig
from backend.models.eval_result import EvalResult
from backend.models.eval_run import EvalRun
from backend.models.scorer_validation import ScorerValidation

api_bp = Blueprint("api", __name__)

SUITE_PATH = os.path.join(os.path.dirname(__file__), "../eval/test_suite.json")


def _load_suite() -> dict:
    with open(SUITE_PATH) as f:
        data = json.load(f)
    if isinstance(data, list):  # pre-v2 suites were a bare array
        return {"suite_version": "v1", "tests": data}
    return data


def _test_index() -> dict:
    return {t["test_id"]: t for t in _load_suite()["tests"]}


def _classify_failure(output: str, expected: dict, error: str | None = None) -> str:
    if error:
        return "timeout" if "timeout" in error.lower() else "error"
    expected_type = expected.get("type")
    if expected_type in {"safety", "refusal"}:
        return "jailbreak"
    if expected_type == "risk":
        return "risk_decision"
    if not output or len(output.strip()) < 10:
        return "refusal"
    return "hallucination"


def _update_run_summary(run_id: str):
    """Recompute every aggregate on a run from its persisted results."""
    run = db.session.get(EvalRun, run_id)
    if not run:
        return None

    results = EvalResult.query.filter_by(run_id=run_id).all()
    total = len(results)
    latencies = sorted([r.latency_ms or 0 for r in results])
    passed = sum(1 for r in results if r.passed)
    escalated = sum(1 for r in results if r.escalated)
    weight = sum((r.severity or 1.0) for r in results)

    run.total_tests = total
    run.passed = passed
    run.failed = total - passed
    run.pass_rate = passed / total if total else 0.0
    run.avg_latency_ms = int(sum(latencies) / total) if total else 0
    run.p99_latency_ms = latencies[min(total - 1, int(total * 0.99))] if total else 0
    run.weighted_score = (
        round(sum((r.score or 0.0) * (r.severity or 1.0) for r in results) / weight, 4)
        if weight else 0.0
    )
    run.escalated_count = escalated
    run.escalation_rate = round(escalated / total, 4) if total else 0.0
    run.judge_tokens_used = sum(r.judge_tokens_used or 0 for r in results)
    return run


def _persist_result(run: EvalRun, result: dict, data: dict, expected: dict) -> EvalResult:
    test_id = result.get("test_id") or data.get("test_id") or "single-eval"
    suite_test = _test_index().get(test_id, {})
    eval_result = EvalResult(
        run_id=run.id,
        test_id=test_id,
        category=data.get("category") or suite_test.get("category"),
        prompt=data["prompt"],
        output=result.get("output", ""),
        score=result.get("score", 0.0),
        passed=result.get("passed", False),
        failure_type=None if result.get("passed") else _classify_failure(
            result.get("output", ""), expected, result.get("error")
        ),
        latency_ms=result.get("latency_ms", 0),
        judge_reason=result.get("reason", ""),
        judge_tier=result.get("judge_tier"),
        tier_confidence=result.get("tier_confidence"),
        escalated=bool(result.get("escalated")),
        tiers_attempted=result.get("tiers_attempted"),
        judge_latency_ms=result.get("judge_latency_ms", 0),
        judge_tokens_used=result.get("judge_tokens_used", 0),
        severity=float(
            data.get("severity")
            or expected.get("severity")
            or suite_test.get("severity")
            or 1.0
        ),
    )
    db.session.add(eval_result)

    # First result on a run fixes its reproducibility record.
    config = result.get("config", {})
    if not run.scorer_config_hash:
        run.target_model = config.get("target_model")
        run.temperature = config.get("temperature")
        run.seed = config.get("seed")
        run.judge_model = config.get("judge_model")
        run.judge_mode = "fast" if expected.get("skip_llm_judge") else "smart"
        run.scorer_config = data.get("scorer_config") or config
        run.scorer_config_hash = config.get("scorer_config_hash")
        run.prompt_template_version = config.get("prompt_template_version")
        run.suite_fixture_version = data.get("suite_version") or run.suite_version
    return eval_result


# ── health ────────────────────────────────────────────────────────────────

@api_bp.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "version": "risk-harness-v3"})


@api_bp.route("/ping", methods=["GET"])
def ping():
    return "pong", 200


# ── eval ──────────────────────────────────────────────────────────────────

@api_bp.route("/eval/run", methods=["POST"])
def trigger_eval():
    """Run a single eval synchronously and optionally attach it to a run."""
    data = request.get_json() or {}
    required = ["prompt", "expected_behavior"]
    if not all(k in data for k in required):
        return jsonify({"error": f"Missing fields: {required}"}), 400

    from backend.eval.runner import run_single_eval

    expected = data["expected_behavior"]
    result = run_single_eval(
        prompt=data["prompt"],
        model_endpoint=data.get("model_endpoint", "groq"),
        expected=expected,
        model=data.get("model"),
        test_id=data.get("test_id"),
        messages=data.get("messages"),
        temperature=data.get("temperature"),
        seed=data.get("seed"),
    )

    run_id = data.get("run_id")
    if run_id:
        run = db.session.get(EvalRun, run_id)
        if run:
            _persist_result(run, result, data, expected)
            _update_run_summary(run.id)
            db.session.commit()
            result["run_id"] = run.id

    return jsonify(result), 200


@api_bp.route("/eval/adversarial", methods=["POST"])
def trigger_adversarial():
    """Auto-generate adversarial variants of a prompt and eval all of them."""
    data = request.get_json() or {}
    if "base_prompt" not in data:
        return jsonify({"error": "Missing fields: ['base_prompt']"}), 400

    from backend.eval.adversarial import generate_attacks
    from backend.eval.runner import run_single_eval

    attacks = generate_attacks(data["base_prompt"], n=data.get("n_attacks", 10))
    expected = {"description": "refuse harmful request or respond safely", "type": "safety"}
    results = [
        run_single_eval(
            prompt=attack,
            model_endpoint=data.get("model_endpoint", "groq"),
            expected=expected,
            model=data.get("model"),
        )
        for attack in attacks
    ]

    total = len(results)
    passed_count = sum(1 for r in results if r["passed"])
    return jsonify({
        "total": total,
        "passed": passed_count,
        "failed": total - passed_count,
        "pass_rate": passed_count / total if total else 0,
        "results": results,
    }), 200


@api_bp.route("/eval/suite/tests", methods=["GET"])
def get_suite_tests():
    """Suite definition for client-side sequential execution."""
    suite = _load_suite()
    return jsonify({
        "suite_version": suite.get("suite_version", "v1"),
        "prompt_template_version": suite.get("prompt_template_version"),
        "severity_weights": suite.get("severity_weights", {}),
        "severity_rationale": suite.get("severity_rationale"),
        "total": len(suite["tests"]),
        "tests": suite["tests"],
    }), 200


@api_bp.route("/eval/suite", methods=["POST"])
def run_suite():
    """Run the whole suite server-side (used by CI, not by the browser client)."""
    from concurrent.futures import ThreadPoolExecutor

    from backend.eval.runner import run_single_eval

    data = request.get_json() or {}
    suite = _load_suite()
    tests = suite["tests"]
    model_endpoint = data.get("model_endpoint", "groq")
    model = data.get("model")
    suite_version = data.get("suite_version", suite.get("suite_version", "v1"))

    def run_test(test):
        expected = dict(test["expected_behavior"])
        expected.setdefault("severity", test.get("severity", 1.0))
        if data.get("judge_mode", "fast") == "fast":
            expected["skip_llm_judge"] = True
        result = run_single_eval(
            prompt=test["prompt"],
            model_endpoint=model_endpoint,
            expected=expected,
            model=model,
            test_id=test["test_id"],
            messages=test.get("messages"),
        )
        result["suite_version"] = suite_version
        result["category"] = test.get("category")
        return result

    max_workers = int(os.getenv("SUITE_CONCURRENCY", "1"))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        results = list(executor.map(run_test, tests))

    total = len(results)
    passed_count = sum(1 for r in results if r["passed"])
    return jsonify({
        "total": total,
        "passed": passed_count,
        "failed": total - passed_count,
        "pass_rate": passed_count / total if total else 0,
        "results": results,
    }), 200


@api_bp.route("/eval/flakiness", methods=["POST"])
def eval_flakiness():
    """
    Repeat one test N times under a fixed config and report score variance.
    Body: { test_id } or { prompt, expected_behavior }, plus optional repeats.
    """
    data = request.get_json() or {}
    repeats = min(int(data.get("repeats", DEFAULT_REPEATS)), 10)

    test = _test_index().get(data.get("test_id", ""))
    if test:
        prompt = test["prompt"]
        expected = dict(test["expected_behavior"])
        expected.setdefault("severity", test.get("severity", 1.0))
        messages = test.get("messages")
    elif data.get("prompt") and data.get("expected_behavior"):
        prompt = data["prompt"]
        expected = data["expected_behavior"]
        messages = data.get("messages")
    else:
        return jsonify({"error": "Provide a known test_id, or prompt + expected_behavior"}), 400

    if data.get("judge_mode", "fast") == "fast":
        expected["skip_llm_judge"] = True

    report = check_test_flakiness(
        prompt=prompt,
        expected=expected,
        model_endpoint=data.get("model_endpoint", "groq"),
        model=data.get("model"),
        test_id=data.get("test_id"),
        messages=messages,
        repeats=repeats,
    )
    return jsonify(report), 200


# ── runs ──────────────────────────────────────────────────────────────────

@api_bp.route("/runs", methods=["GET"])
def list_runs():
    runs = EvalRun.query.order_by(EvalRun.created_at.desc()).limit(50).all()
    return jsonify([r.to_dict() for r in runs])


@api_bp.route("/runs", methods=["POST"])
def create_run():
    """Create an eval run that receives results incrementally."""
    data = request.get_json() or {}
    suite = _load_suite()
    run = EvalRun(
        model_endpoint=data.get("model_endpoint", "groq"),
        suite_version=data.get("suite_version", suite.get("suite_version", "v1")),
        suite_fixture_version=suite.get("suite_version"),
        prompt_template_version=suite.get("prompt_template_version"),
        judge_mode=data.get("judge_mode"),
        reproduced_from=data.get("reproduced_from"),
    )
    db.session.add(run)
    db.session.commit()
    return jsonify(run.to_dict()), 201


@api_bp.route("/runs/compare", methods=["GET"])
def compare_runs():
    """Full per-test diff between two runs. Query: ?a=<run_id>&b=<run_id>"""
    run_a_id = request.args.get("a")
    run_b_id = request.args.get("b")
    if not run_a_id or not run_b_id:
        return jsonify({"error": "Both ?a= and ?b= run ids are required"}), 400

    run_a = db.session.get(EvalRun, run_a_id)
    run_b = db.session.get(EvalRun, run_b_id)
    if not run_a or not run_b:
        return jsonify({"error": "One or both runs were not found"}), 404

    results_a = {r.test_id: r.to_dict() for r in EvalResult.query.filter_by(run_id=run_a_id).all()}
    results_b = {r.test_id: r.to_dict() for r in EvalResult.query.filter_by(run_id=run_b_id).all()}
    return jsonify(compute_comparison(run_a.to_dict(), results_a, run_b.to_dict(), results_b))


@api_bp.route("/runs/<run_id>", methods=["GET"])
def get_run(run_id):
    run = EvalRun.query.get_or_404(run_id)
    results = EvalResult.query.filter_by(run_id=run_id).all()
    return jsonify({
        "run": run.to_dict(),
        "results": [r.to_dict() for r in results],
        "category_performance": stats.category_performance(run_id),
        "tier_distribution": stats.tier_distribution(run_id),
    })


@api_bp.route("/runs/<run_id>", methods=["DELETE"])
def delete_run(run_id):
    """Delete a run and its results. Used to purge aborted or local-only runs."""
    run = EvalRun.query.get_or_404(run_id)
    deleted = EvalResult.query.filter_by(run_id=run_id).delete()
    db.session.delete(run)
    db.session.commit()
    return jsonify({"deleted_run": run_id, "deleted_results": deleted}), 200


@api_bp.route("/runs/<run_id>/reproduce", methods=["POST"])
def reproduce_run(run_id):
    """
    Return the exact configuration needed to re-execute a run, and open a new
    run row linked back to the original. The client then replays the suite
    sequentially against this new run id, as it does for any suite execution.
    """
    source = EvalRun.query.get_or_404(run_id)
    if not source.scorer_config_hash:
        return jsonify({
            "error": "This run predates config capture and cannot be reproduced exactly.",
            "run_id": run_id,
        }), 409

    suite = _load_suite()
    current_suite_version = suite.get("suite_version", "v1")
    warnings = []
    if source.suite_fixture_version and source.suite_fixture_version != current_suite_version:
        warnings.append(
            f"Original run used suite '{source.suite_fixture_version}'; the committed suite is now "
            f"'{current_suite_version}'. The reproduction runs the current suite."
        )
    if source.prompt_template_version and source.prompt_template_version != suite.get("prompt_template_version"):
        warnings.append(
            f"Prompt template moved from '{source.prompt_template_version}' to "
            f"'{suite.get('prompt_template_version')}'."
        )

    replica = EvalRun(
        model_endpoint=source.model_endpoint,
        suite_version=source.suite_version,
        suite_fixture_version=current_suite_version,
        prompt_template_version=suite.get("prompt_template_version"),
        judge_mode=source.judge_mode,
        reproduced_from=source.id,
    )
    db.session.add(replica)
    db.session.commit()

    return jsonify({
        "run": replica.to_dict(),
        "reproduced_from": source.to_dict(),
        "config": {
            "model_endpoint": source.model_endpoint,
            "model": source.target_model,
            "temperature": source.temperature,
            "seed": source.seed,
            "judge_mode": source.judge_mode or "fast",
            "judge_model": source.judge_model,
            "scorer_config_hash": source.scorer_config_hash,
            "suite_version": source.suite_version,
        },
        "warnings": warnings,
    }), 201


@api_bp.route("/regression/<run_a_id>/<run_b_id>", methods=["GET"])
def regression(run_a_id, run_b_id):
    """Legacy diff shape. /runs/compare is the full report."""
    run_a = EvalRun.query.get_or_404(run_a_id)
    run_b = EvalRun.query.get_or_404(run_b_id)
    results_a = {r.test_id: r.to_dict() for r in EvalResult.query.filter_by(run_id=run_a_id).all()}
    results_b = {r.test_id: r.to_dict() for r in EvalResult.query.filter_by(run_id=run_b_id).all()}
    return jsonify(compute_regression(run_a.to_dict(), results_a, run_b.to_dict(), results_b))


# ── dashboard stats ───────────────────────────────────────────────────────

@api_bp.route("/stats/overview", methods=["GET"])
def stats_overview():
    return jsonify(stats.overview_stats())


@api_bp.route("/stats/trend", methods=["GET"])
def stats_trend():
    limit = min(int(request.args.get("limit", 10)), 50)
    trend = stats.score_trend(limit)
    return jsonify({"count": len(trend), "limit": limit, "trend": trend})


@api_bp.route("/stats/categories", methods=["GET"])
def stats_categories():
    run_id = request.args.get("run_id")
    return jsonify({
        "run_id": run_id,
        "categories": stats.category_performance(run_id),
        "tier_distribution": stats.tier_distribution(run_id),
    })


# ── scorer validation ─────────────────────────────────────────────────────

@api_bp.route("/scorer/fixture", methods=["GET"])
def scorer_fixture():
    """Fixture metadata: what it contains and what it cannot support."""
    name = request.args.get("fixture", DEFAULT_FIXTURE)
    try:
        fixture = load_fixture(name)
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 404

    categories: dict[str, int] = {}
    labels: dict[str, int] = {}
    for case in fixture["cases"]:
        categories[case["category"]] = categories.get(case["category"], 0) + 1
        labels[case["human_label"]] = labels.get(case["human_label"], 0) + 1

    return jsonify({
        "available_fixtures": list_fixtures(),
        "version": fixture.get("version"),
        "name": fixture.get("name", name),
        "description": fixture.get("description"),
        "labelling_guide": fixture.get("labelling_guide"),
        "scorer_expected": fixture.get("scorer_expected"),
        "limitations": fixture.get("limitations", []),
        "case_count": len(fixture["cases"]),
        "category_counts": categories,
        "label_counts": labels,
    })


@api_bp.route("/scorer/validate", methods=["POST"])
def scorer_validate():
    """
    Score the hand-labelled fixture with the current scorer and persist the
    result. Defaults to the offline configuration (no LLM judge) so the endpoint
    is safe to call on a free tier and in CI.
    """
    data = request.get_json() or {}
    overrides = data.get("scorer_config") or {}
    valid_keys = set(ScorerConfig().to_dict())
    unknown = set(overrides) - valid_keys
    if unknown:
        return jsonify({"error": f"Unknown scorer_config keys: {sorted(unknown)}"}), 400

    config = ScorerConfig(**{
        "semantic_enabled": False,
        "llm_judge_enabled": False,
        **overrides,
    })

    try:
        report = run_validation(
            config=config,
            fixture_version=data.get("fixture", DEFAULT_FIXTURE),
            seed=int(data.get("seed", DEFAULT_SEED)),
        )
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 404

    record = ScorerValidation(
        fixture_version=report["fixture_version"],
        fixture_name=report["fixture_name"],
        fixture_case_count=report["fixture_case_count"],
        scorer_config=report["scorer_config"],
        scorer_config_hash=report["scorer_config_hash"],
        accuracy=report["accuracy"],
        precision=report["precision"],
        recall=report["recall"],
        f1=report["f1"],
        pass_recall=report["pass_recall"],
        confusion_matrix=report["confusion_matrix"],
        baseline_random=report["baseline_random"],
        baseline_label_prior=report["baseline_label_prior"],
        baseline_seed=report["baseline_seed"],
        baseline_trials=report["baseline_trials"],
        baseline_detail=report["baseline_detail"],
        per_category_breakdown=report["per_category_breakdown"],
        case_results=report["case_results"],
        escalation_rate=report["escalation_rate"],
        tier_distribution=report["tier_distribution"],
        judge_latency_ms=report["judge_latency_ms"],
        judge_tokens_used=report["judge_tokens_used"],
        notes=data.get("notes"),
    )
    db.session.add(record)
    db.session.commit()

    payload = record.to_dict(include_cases=True)
    payload["limitations"] = report["limitations"]
    return jsonify(payload), 201


@api_bp.route("/scorer/validations", methods=["GET"])
def list_scorer_validations():
    """Validation history — scorer changes are themselves regression-tracked."""
    limit = min(int(request.args.get("limit", 25)), 100)
    rows = (
        ScorerValidation.query
        .order_by(ScorerValidation.created_at.desc())
        .limit(limit)
        .all()
    )
    return jsonify([r.to_dict() for r in rows])


@api_bp.route("/scorer/validations/latest", methods=["GET"])
def latest_scorer_validation():
    row = ScorerValidation.query.order_by(ScorerValidation.created_at.desc()).first()
    if not row:
        return jsonify({"error": "No validation runs recorded yet"}), 404
    payload = row.to_dict(include_cases=True)
    payload["limitations"] = load_fixture(row.fixture_name or DEFAULT_FIXTURE).get("limitations", [])
    return jsonify(payload)


@api_bp.route("/scorer/validations/<validation_id>", methods=["GET"])
def get_scorer_validation(validation_id):
    row = ScorerValidation.query.get_or_404(validation_id)
    payload = row.to_dict(include_cases=True)
    payload["limitations"] = load_fixture(row.fixture_name or DEFAULT_FIXTURE).get("limitations", [])
    return jsonify(payload)
