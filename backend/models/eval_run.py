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
            "created_at": self.created_at.isoformat(),
        }