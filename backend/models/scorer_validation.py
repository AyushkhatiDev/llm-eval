import uuid
from datetime import datetime

from backend.extensions import db


class ScorerValidation(db.Model):
    """
    One measurement of the scorer against a hand-labelled fixture.

    Rows accumulate over time so that a change to the rules is itself a
    regression-tracked event: if accuracy drops after a rule edit, the history
    chart shows it.
    """

    __tablename__ = "scorer_validations"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    fixture_version = db.Column(db.String(100), nullable=False)
    fixture_name = db.Column(db.String(200))
    fixture_case_count = db.Column(db.Integer, default=0)
    scorer_config = db.Column(db.JSON)
    scorer_config_hash = db.Column(db.String(64))

    accuracy = db.Column(db.Float)
    precision = db.Column(db.Float)
    recall = db.Column(db.Float)
    f1 = db.Column(db.Float)
    pass_recall = db.Column(db.Float)
    confusion_matrix = db.Column(db.JSON)

    baseline_random = db.Column(db.Float)
    baseline_label_prior = db.Column(db.Float)
    baseline_seed = db.Column(db.Integer)
    baseline_trials = db.Column(db.Integer)
    baseline_detail = db.Column(db.JSON)

    per_category_breakdown = db.Column(db.JSON)
    case_results = db.Column(db.JSON)
    escalation_rate = db.Column(db.Float, default=0.0)
    tier_distribution = db.Column(db.JSON)
    judge_latency_ms = db.Column(db.Integer, default=0)
    judge_tokens_used = db.Column(db.Integer, default=0)
    notes = db.Column(db.Text)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self, include_cases: bool = False) -> dict:
        payload = {
            "id": self.id,
            "fixture_version": self.fixture_version,
            "fixture_name": self.fixture_name,
            "fixture_case_count": self.fixture_case_count,
            "scorer_config": self.scorer_config,
            "scorer_config_hash": self.scorer_config_hash,
            "accuracy": self.accuracy,
            "precision": self.precision,
            "recall": self.recall,
            "f1": self.f1,
            "pass_recall": self.pass_recall,
            "confusion_matrix": self.confusion_matrix,
            "baseline_random": self.baseline_random,
            "baseline_label_prior": self.baseline_label_prior,
            "baseline_seed": self.baseline_seed,
            "baseline_trials": self.baseline_trials,
            "per_category_breakdown": self.per_category_breakdown,
            "escalation_rate": self.escalation_rate,
            "tier_distribution": self.tier_distribution,
            "judge_latency_ms": self.judge_latency_ms,
            "judge_tokens_used": self.judge_tokens_used,
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
        if include_cases:
            payload["case_results"] = self.case_results
            payload["baseline_detail"] = self.baseline_detail
        return payload
