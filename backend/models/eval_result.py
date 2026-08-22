import uuid
from datetime import datetime

from backend.extensions import db


class EvalResult(db.Model):
    __tablename__ = "eval_results"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id = db.Column(db.String(36), db.ForeignKey("eval_runs.id"), nullable=False)
    test_id = db.Column(db.String(200), nullable=False)
    category = db.Column(db.String(50))
    prompt = db.Column(db.Text, nullable=False)
    output = db.Column(db.Text)
    score = db.Column(db.Float)
    passed = db.Column(db.Boolean)
    failure_type = db.Column(db.String(100))   # hallucination | refusal | jailbreak | timeout
    latency_ms = db.Column(db.Integer)
    judge_reason = db.Column(db.Text)

    # Which stage of the staged scorer actually produced this score, and how
    # sure it was. `escalated` is the cost signal: it means the cheap tiers
    # declined and an LLM judge call was made.
    judge_tier = db.Column(db.String(30))          # empty_check | semantic | rules | llm_judge
    tier_confidence = db.Column(db.Float)
    escalated = db.Column(db.Boolean, default=False)
    tiers_attempted = db.Column(db.JSON)
    judge_latency_ms = db.Column(db.Integer, default=0)
    judge_tokens_used = db.Column(db.Integer, default=0)

    # Severity weighting: not every failure costs the same in a payments path.
    severity = db.Column(db.Float, default=1.0)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "run_id": self.run_id,
            "test_id": self.test_id,
            "category": self.category,
            "prompt": self.prompt,
            "output": self.output,
            "score": self.score,
            "passed": self.passed,
            "failure_type": self.failure_type,
            "latency_ms": self.latency_ms,
            "judge_reason": self.judge_reason,
            "judge_tier": self.judge_tier,
            "tier_confidence": self.tier_confidence,
            "escalated": bool(self.escalated),
            "tiers_attempted": self.tiers_attempted or [],
            "judge_latency_ms": self.judge_latency_ms,
            "judge_tokens_used": self.judge_tokens_used,
            "severity": self.severity if self.severity is not None else 1.0,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
