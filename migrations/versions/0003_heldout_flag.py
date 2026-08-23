"""Mark which scorer validations ran against a held-out fixture.

A validation against the development set reports an upper bound; one against a
set authored after the rules were frozen reports a generalisation estimate. The
UI shows them side by side, so the distinction has to survive persistence.

Revision ID: 0003_heldout_flag
Revises: 0002_scorer_validation
Create Date: 2026-08-23
"""
import sqlalchemy as sa
from alembic import op

revision = "0003_heldout_flag"
down_revision = "0002_scorer_validation"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("scorer_validations", sa.Column("held_out", sa.Boolean(), nullable=True))
    op.get_bind().execute(sa.text(
        "UPDATE scorer_validations SET held_out = false WHERE held_out IS NULL"
    ))


def downgrade():
    op.drop_column("scorer_validations", "held_out")
