"""add offer letter overrides

Revision ID: bc91734bf956
Revises: 170cc1b01146
Create Date: 2026-07-30 16:55:43.010610

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'bc91734bf956'
down_revision: Union[str, Sequence[str], None] = '170cc1b01146'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('generated_letters', sa.Column('annual_ctc_override', sa.Numeric(precision=12, scale=2), nullable=True))
    op.add_column('generated_letters', sa.Column('probation_text', sa.String(length=200), nullable=True))
    op.add_column('generated_letters', sa.Column('notice_period_text', sa.String(length=200), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('generated_letters', 'notice_period_text')
    op.drop_column('generated_letters', 'probation_text')
    op.drop_column('generated_letters', 'annual_ctc_override')
