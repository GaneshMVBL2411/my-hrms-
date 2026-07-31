"""add employee pan aadhaar bank details

Revision ID: ca59d3d2efea
Revises: 9ca07a709545
Create Date: 2026-07-31 11:47:00.606680

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ca59d3d2efea'
down_revision: Union[str, Sequence[str], None] = '9ca07a709545'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('employees', sa.Column('pan_number', sa.String(length=10), nullable=True))
    op.add_column('employees', sa.Column('aadhaar_number', sa.String(length=12), nullable=True))
    op.add_column('employees', sa.Column('bank_account_number', sa.String(length=30), nullable=True))
    op.add_column('employees', sa.Column('bank_ifsc', sa.String(length=11), nullable=True))
    op.add_column('employees', sa.Column('bank_name', sa.String(length=100), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('employees', 'bank_name')
    op.drop_column('employees', 'bank_ifsc')
    op.drop_column('employees', 'bank_account_number')
    op.drop_column('employees', 'aadhaar_number')
    op.drop_column('employees', 'pan_number')
