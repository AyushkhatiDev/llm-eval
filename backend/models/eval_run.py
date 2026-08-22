import uuid
from datetime import datetime

from backend.extensions import db


class EvalRun(db.Model):
    __tablename__ = "eval_runs"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    model_endpoint = db.Column(db.String(500), nullable=False)
    suite_version = db.Column(db.String(100), default="v1")
    total_tests = db.Column(db.Integer, default=0)
    passed = db.Column(db.Integer, default=0)
    failed = db.Column(db.Integer, default=0)
    pass_rate = db.Column(db.Float, default=0.0)
    avg_latency_ms = db.Column(db.Integer, default=0)
    p99_latency_ms = db.Column(db.Integer, default=0)

    # ── Reproducibility record ────────────────────────────────────────────
    # Everything needed to re-execute this run and expect the same numbers.
    target_model = db.Column(db.String(200))
    temperature = db.Column(db.Float)
    seed = db.Column(db.Integer)
    judge_model = db.Column(db.String(200))
    judge_mode = db.Column(db.String(20))              # fast | smart
    scorer_config = db.Column(db.JSON)
    scorer_config_hash = db.Column(db.String(64))
    suite_fixture_version = db.Column(db.String(100))
    prompt_template_version = db.Column(db.String(50))
    reproduced_from = db.Column(db.String(36))

    # ── Derived aggregates (recomputed from persisted results) ────────────
    weighted_score = db.Column(db.Float, default=0.0)
    escalated_count = db.Column(db.Integer, default=0)
    escalation_rate = db.Column(db.Float, default=0.0)
    judge_tokens_used = db.Column(db.Integer, default=0)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "model_endpoint": self.model_endpoint,
            "suite_version": self.suite_version,
            "total_tests": self.total_tests,
            "passed": self.passed,
            "failed": self.failed,
            "pass_rate": self.pass_rate,
            "avg_latency_ms": self.avg_latency_ms,
            "p99_latency_ms": self.p99_latency_ms,
            "weighted_score": self.weighted_score,
            "escalated_count": self.escalated_count,
            "escalation_rate": self.escalation_rate,
            "judge_tokens_used": self.judge_tokens_used,
            "config": {
                "target_model": self.target_model,
                "temperature": self.temperature,
                "seed": self.seed,
                "judge_model": self.judge_model,
                "judge_mode": self.judge_mode,
                "scorer_config": self.scorer_config,
                "scorer_config_hash": self.scorer_config_hash,
                "suite_fixture_version": self.suite_fixture_version,
                "prompt_template_version": self.prompt_template_version,
            },
            "reproduced_from": self.reproduced_from,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
