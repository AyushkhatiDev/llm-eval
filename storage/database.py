"""
Utility functions for raw DB queries (outside of ORM models).
"""
from backend.extensions import db


def get_pass_rate_trend(limit: int = 10) -> list:
    """Returns the last N eval runs with their pass rates for trend charts."""
    sql = """
        SELECT id, suite_version, pass_rate, p99_latency_ms, created_at
        FROM eval_runs
        ORDER BY created_at DESC
        LIMIT :limit
    """
    result = db.session.execute(db.text(sql), {"limit": limit})
    return [dict(row._mapping) for row in result]


def get_failure_breakdown(run_id: str) -> list:
    """Returns count of each failure type for a given run."""
    sql = """
        SELECT failure_type, COUNT(*) as count
        FROM eval_results
        WHERE run_id = :run_id AND passed = false
        GROUP BY failure_type
    """
    result = db.session.execute(db.text(sql), {"run_id": run_id})
    return [dict(row._mapping) for row in result]