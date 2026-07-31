"""add task progress percentage

Revision ID: 9ca07a709545
Revises: bc91734bf956
Create Date: 2026-07-30 17:37:34.957487

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9ca07a709545'
down_revision: Union[str, Sequence[str], None] = 'bc91734bf956'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'tasks',
        sa.Column('progress', sa.Integer(), nullable=False, server_default='0'),
    )
    op.alter_column('tasks', 'progress', server_default=None)
    # Backfill: tasks already marked completed should read as 100% done.
    op.execute("UPDATE tasks SET progress = 100 WHERE status = 'completed'")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('tasks', 'progress')
