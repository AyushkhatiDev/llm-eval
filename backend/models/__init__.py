"""Model imports live here so Flask-Migrate can see every table."""
from backend.models.eval_result import EvalResult
from backend.models.eval_run import EvalRun
from backend.models.scorer_validation import ScorerValidation

__all__ = ["EvalRun", "EvalResult", "ScorerValidation"]
