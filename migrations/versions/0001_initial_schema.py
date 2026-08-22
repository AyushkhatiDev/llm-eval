"""Initial schema: eval_runs and eval_results.

This mirrors the tables that already existed in the deployed database before
migrations were introduced. Existing deployments are stamped at this revision
rather than running it.

Revision ID: 0001_initial
Revises:
Create Date: 2026-08-22
"""
import sqlalchemy as sa
from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "eval_runs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("model_endpoint", sa.String(length=500), nullable=False),
        sa.Column("suite_version", sa.String(length=100), server_default="v1"),
        sa.Column("total_tests", sa.Integer(), server_default="0"),
        sa.Column("passed", sa.Integer(), server_default="0"),
        sa.Column("failed", sa.Integer(), server_default="0"),
        sa.Column("pass_rate", sa.Float(), server_default="0"),
        sa.Column("avg_latency_ms", sa.Integer(), server_default="0"),
        sa.Column("p99_latency_ms", sa.Integer(), server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_table(
        "eval_results",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("run_id", sa.String(length=36), sa.ForeignKey("eval_runs.id"), nullable=False),
        sa.Column("test_id", sa.String(length=200), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("output", sa.Text()),
        sa.Column("score", sa.Float()),
        sa.Column("passed", sa.Boolean()),
        sa.Column("failure_type", sa.String(length=100)),
        sa.Column("latency_ms", sa.Integer()),
        sa.Column("judge_reason", sa.Text()),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )


def downgrade():
    op.drop_table("eval_results")
    op.drop_table("eval_runs")
