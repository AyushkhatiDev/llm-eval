"""Staged-scorer trace columns, reproducibility record, and scorer_validations.

Adds:
  * eval_results — which tier scored the row, how confident it was, whether it
    escalated to the LLM judge, and the severity weight of the test.
  * eval_runs — the full configuration needed to reproduce the run, plus
    aggregates that were previously computed in the browser.
  * scorer_validations — measurements of the scorer against a labelled fixture.

Existing eval_results rows have their category backfilled from the test_id
prefix so the category chart is populated by real data rather than placeholders.

Revision ID: 0002_scorer_validation
Revises: 0001_initial
Create Date: 2026-08-22
"""
import sqlalchemy as sa
from alembic import op

revision = "0002_scorer_validation"
down_revision = "0001_initial"
branch_labels = None
depends_on = None

RESULT_COLUMNS = [
    ("category", sa.String(length=50)),
    ("judge_tier", sa.String(length=30)),
    ("tier_confidence", sa.Float()),
    ("escalated", sa.Boolean()),
    ("tiers_attempted", sa.JSON()),
    ("judge_latency_ms", sa.Integer()),
    ("judge_tokens_used", sa.Integer()),
    ("severity", sa.Float()),
]

RUN_COLUMNS = [
    ("target_model", sa.String(length=200)),
    ("temperature", sa.Float()),
    ("seed", sa.Integer()),
    ("judge_model", sa.String(length=200)),
    ("judge_mode", sa.String(length=20)),
    ("scorer_config", sa.JSON()),
    ("scorer_config_hash", sa.String(length=64)),
    ("suite_fixture_version", sa.String(length=100)),
    ("prompt_template_version", sa.String(length=50)),
    ("reproduced_from", sa.String(length=36)),
    ("weighted_score", sa.Float()),
    ("escalated_count", sa.Integer()),
    ("escalation_rate", sa.Float()),
    ("judge_tokens_used", sa.Integer()),
]

KNOWN_CATEGORIES = ("factual", "safety", "hallucination", "adversarial", "reasoning", "risk")


def upgrade():
    for name, type_ in RESULT_COLUMNS:
        op.add_column("eval_results", sa.Column(name, type_, nullable=True))
    for name, type_ in RUN_COLUMNS:
        op.add_column("eval_runs", sa.Column(name, type_, nullable=True))

    op.create_table(
        "scorer_validations",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("fixture_version", sa.String(length=100), nullable=False),
        sa.Column("fixture_name", sa.String(length=200)),
        sa.Column("fixture_case_count", sa.Integer()),
        sa.Column("scorer_config", sa.JSON()),
        sa.Column("scorer_config_hash", sa.String(length=64)),
        sa.Column("accuracy", sa.Float()),
        sa.Column("precision", sa.Float()),
        sa.Column("recall", sa.Float()),
        sa.Column("f1", sa.Float()),
        sa.Column("pass_recall", sa.Float()),
        sa.Column("confusion_matrix", sa.JSON()),
        sa.Column("baseline_random", sa.Float()),
        sa.Column("baseline_label_prior", sa.Float()),
        sa.Column("baseline_seed", sa.Integer()),
        sa.Column("baseline_trials", sa.Integer()),
        sa.Column("baseline_detail", sa.JSON()),
        sa.Column("per_category_breakdown", sa.JSON()),
        sa.Column("case_results", sa.JSON()),
        sa.Column("escalation_rate", sa.Float()),
        sa.Column("tier_distribution", sa.JSON()),
        sa.Column("judge_latency_ms", sa.Integer()),
        sa.Column("judge_tokens_used", sa.Integer()),
        sa.Column("notes", sa.Text()),
        sa.Column("created_at", sa.DateTime()),
    )
    op.create_index("ix_scorer_validations_created_at", "scorer_validations", ["created_at"])

    connection = op.get_bind()
    connection.execute(sa.text(
        "UPDATE eval_results SET severity = 1.0 WHERE severity IS NULL"
    ))
    connection.execute(sa.text(
        "UPDATE eval_results SET escalated = false WHERE escalated IS NULL"
    ))
    # Historical rows have no category column; the suite encodes it in test_id.
    for category in KNOWN_CATEGORIES:
        connection.execute(
            sa.text(
                "UPDATE eval_results SET category = :category "
                "WHERE category IS NULL AND test_id LIKE :prefix"
            ),
            {"category": category, "prefix": f"{category}-%"},
        )


def downgrade():
    op.drop_index("ix_scorer_validations_created_at", table_name="scorer_validations")
    op.drop_table("scorer_validations")
    for name, _ in RUN_COLUMNS:
        op.drop_column("eval_runs", name)
    for name, _ in RESULT_COLUMNS:
        op.drop_column("eval_results", name)
