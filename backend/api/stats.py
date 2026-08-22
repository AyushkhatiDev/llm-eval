"""
Every number the dashboard renders is computed here, from persisted rows.

The rule this project is built on: if a metric cannot be traced to a query, it
does not get shown. Deltas in particular are computed by comparing a trailing
7-day window against the 7 days before it, and are returned as `None` when the
prior window has no data — the UI then renders no delta at all rather than an
invented one.
"""
from datetime import datetime, timedelta

from sqlalchemy import func

from backend.extensions import db
from backend.models.eval_result import EvalResult
from backend.models.eval_run import EvalRun

WINDOW_DAYS = 7
SAFETY_CATEGORIES = ("safety", "adversarial")


def _window_bounds(now: datetime | None = None):
    now = now or datetime.utcnow()
    current_start = now - timedelta(days=WINDOW_DAYS)
    prior_start = now - timedelta(days=WINDOW_DAYS * 2)
    return prior_start, current_start, now


def _delta(current, prior):
    """None when there is nothing to compare against — never a placeholder."""
    if current is None or prior is None:
        return None
    return round(current - prior, 4)


def _run_window_stats(start: datetime, end: datetime) -> dict:
    runs = (
        EvalRun.query
        .filter(EvalRun.created_at >= start, EvalRun.created_at < end, EvalRun.total_tests > 0)
        .all()
    )
    run_ids = [r.id for r in runs]

    avg_score = None
    escalation_rate = None
    safety_rate = None
    if run_ids:
        avg_score = db.session.query(func.avg(EvalResult.score)).filter(
            EvalResult.run_id.in_(run_ids)
        ).scalar()
        total_results = db.session.query(func.count(EvalResult.id)).filter(
            EvalResult.run_id.in_(run_ids)
        ).scalar() or 0
        escalated = db.session.query(func.count(EvalResult.id)).filter(
            EvalResult.run_id.in_(run_ids), EvalResult.escalated.is_(True)
        ).scalar() or 0
        escalation_rate = escalated / total_results if total_results else None

        safety_total = db.session.query(func.count(EvalResult.id)).filter(
            EvalResult.run_id.in_(run_ids), EvalResult.category.in_(SAFETY_CATEGORIES)
        ).scalar() or 0
        safety_passed = db.session.query(func.count(EvalResult.id)).filter(
            EvalResult.run_id.in_(run_ids),
            EvalResult.category.in_(SAFETY_CATEGORIES),
            EvalResult.passed.is_(True),
        ).scalar() or 0
        safety_rate = safety_passed / safety_total if safety_total else None

    pass_rates = [r.pass_rate for r in runs if r.pass_rate is not None]
    return {
        "runs": len(runs),
        "pass_rate": round(sum(pass_rates) / len(pass_rates), 4) if pass_rates else None,
        "avg_score": round(float(avg_score), 4) if avg_score is not None else None,
        "escalation_rate": round(escalation_rate, 4) if escalation_rate is not None else None,
        "safety_pass_rate": round(safety_rate, 4) if safety_rate is not None else None,
    }


def overview_stats() -> dict:
    """KPI cards: current value, the trailing-window comparison, and its basis."""
    prior_start, current_start, now = _window_bounds()
    current = _run_window_stats(current_start, now)
    prior = _run_window_stats(prior_start, current_start)

    total_runs = EvalRun.query.count()
    completed_runs = EvalRun.query.filter(EvalRun.total_tests > 0).count()
    total_results = db.session.query(func.count(EvalResult.id)).scalar() or 0

    all_time_avg = db.session.query(func.avg(EvalResult.score)).scalar()
    all_time_pass = db.session.query(func.avg(EvalRun.pass_rate)).filter(
        EvalRun.total_tests > 0
    ).scalar()
    escalated_total = db.session.query(func.count(EvalResult.id)).filter(
        EvalResult.escalated.is_(True)
    ).scalar() or 0
    safety_total = db.session.query(func.count(EvalResult.id)).filter(
        EvalResult.category.in_(SAFETY_CATEGORIES)
    ).scalar() or 0
    safety_passed = db.session.query(func.count(EvalResult.id)).filter(
        EvalResult.category.in_(SAFETY_CATEGORIES), EvalResult.passed.is_(True)
    ).scalar() or 0

    return {
        "window_days": WINDOW_DAYS,
        "computed_at": now.isoformat(),
        "totals": {
            "runs": total_runs,
            "completed_runs": completed_runs,
            "results": total_results,
            "escalated_results": escalated_total,
        },
        "metrics": {
            "total_runs": {
                "value": total_runs,
                "delta": _delta(current["runs"], prior["runs"]),
                "delta_label": f"vs prior {WINDOW_DAYS}d",
                "current_window": current["runs"],
                "prior_window": prior["runs"],
            },
            "pass_rate": {
                "value": round(float(all_time_pass), 4) if all_time_pass is not None else None,
                "delta": _delta(current["pass_rate"], prior["pass_rate"]),
                "delta_label": f"vs prior {WINDOW_DAYS}d",
                "current_window": current["pass_rate"],
                "prior_window": prior["pass_rate"],
            },
            "avg_score": {
                "value": round(float(all_time_avg), 4) if all_time_avg is not None else None,
                "delta": _delta(current["avg_score"], prior["avg_score"]),
                "delta_label": f"vs prior {WINDOW_DAYS}d",
                "current_window": current["avg_score"],
                "prior_window": prior["avg_score"],
            },
            "safety_pass_rate": {
                "value": round(safety_passed / safety_total, 4) if safety_total else None,
                "delta": _delta(current["safety_pass_rate"], prior["safety_pass_rate"]),
                "delta_label": f"vs prior {WINDOW_DAYS}d",
                "basis": f"{safety_passed}/{safety_total} safety + adversarial results",
                "current_window": current["safety_pass_rate"],
                "prior_window": prior["safety_pass_rate"],
            },
            "escalation_rate": {
                "value": round(escalated_total / total_results, 4) if total_results else None,
                "delta": _delta(current["escalation_rate"], prior["escalation_rate"]),
                "delta_label": f"vs prior {WINDOW_DAYS}d",
                "basis": f"{escalated_total}/{total_results} results needed the LLM judge",
                "current_window": current["escalation_rate"],
                "prior_window": prior["escalation_rate"],
            },
        },
    }


def score_trend(limit: int = 10) -> list[dict]:
    """Most recent completed runs, oldest first, for the trend chart."""
    runs = (
        EvalRun.query
        .filter(EvalRun.total_tests > 0)
        .order_by(EvalRun.created_at.desc())
        .limit(limit)
        .all()
    )
    trend = []
    for run in reversed(runs):
        safety_total = db.session.query(func.count(EvalResult.id)).filter(
            EvalResult.run_id == run.id, EvalResult.category.in_(SAFETY_CATEGORIES)
        ).scalar() or 0
        safety_passed = db.session.query(func.count(EvalResult.id)).filter(
            EvalResult.run_id == run.id,
            EvalResult.category.in_(SAFETY_CATEGORIES),
            EvalResult.passed.is_(True),
        ).scalar() or 0
        trend.append({
            "run_id": run.id,
            "name": run.id[:8],
            "suite_version": run.suite_version,
            "created_at": run.created_at.isoformat() if run.created_at else None,
            "pass_rate": round(run.pass_rate or 0.0, 4),
            "weighted_score": round(run.weighted_score or 0.0, 4),
            "escalation_rate": round(run.escalation_rate or 0.0, 4),
            "safety": round(safety_passed / safety_total, 4) if safety_total else None,
        })
    return trend


def category_performance(run_id: str | None = None) -> list[dict]:
    """
    Per-category pass rates from persisted results. Scoped to one run when
    `run_id` is given, otherwise across every result on record.
    """
    query = db.session.query(
        EvalResult.category,
        func.count(EvalResult.id).label("total"),
        func.sum(func.cast(EvalResult.passed, db.Integer)).label("passed"),
        func.avg(EvalResult.score).label("avg_score"),
    ).filter(EvalResult.category.isnot(None))

    if run_id:
        query = query.filter(EvalResult.run_id == run_id)

    rows = query.group_by(EvalResult.category).order_by(EvalResult.category).all()

    out = []
    for category, total, passed, avg_score in rows:
        passed = int(passed or 0)
        total = int(total or 0)
        out.append({
            "category": category,
            "total": total,
            "passed": passed,
            "failed": total - passed,
            "pass": round(passed / total, 4) if total else 0.0,
            "fail": round((total - passed) / total, 4) if total else 0.0,
            "avg_score": round(float(avg_score), 4) if avg_score is not None else None,
        })
    return out


def tier_distribution(run_id: str | None = None) -> list[dict]:
    """How often each tier of the staged scorer produced the final verdict."""
    query = db.session.query(
        EvalResult.judge_tier,
        func.count(EvalResult.id).label("total"),
    ).filter(EvalResult.judge_tier.isnot(None))
    if run_id:
        query = query.filter(EvalResult.run_id == run_id)

    rows = query.group_by(EvalResult.judge_tier).all()
    total = sum(int(r[1]) for r in rows) or 0
    return [
        {
            "tier": tier,
            "count": int(count),
            "share": round(int(count) / total, 4) if total else 0.0,
        }
        for tier, count in rows
    ]
