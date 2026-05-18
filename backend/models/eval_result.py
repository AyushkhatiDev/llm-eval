import uuid
from datetime import datetime
from backend.extensions import db


class EvalResult(db.Model):
    __tablename__ = "eval_results"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id = db.Column(db.String(36), db.ForeignKey("eval_runs.id"), nullable=False)
    test_id = db.Column(db.String(200), nullable=False)
    prompt = db.Column(db.Text, nullable=False)
    output = db.Column(db.Text)
    score = db.Column(db.Float)
    passed = db.Column(db.Boolean)
    failure_type = db.Column(db.String(100))   # hallucination | refusal | jailbreak | timeout
    latency_ms = db.Column(db.Integer)
    judge_reason = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "run_id": self.run_id,
            "test_id": self.test_id,
            "prompt": self.prompt,
            "output": self.output,
            "score": self.score,
            "passed": self.passed,
            "failure_type": self.failure_type,
            "latency_ms": self.latency_ms,
            "judge_reason": self.judge_reason,
            "created_at": self.created_at.isoformat(),
        }