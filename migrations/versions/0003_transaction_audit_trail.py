"""transaction audit trail (actor, api_key_id, source_ip)

Records who/what created each transaction:
  * ``api_key_id`` — which credential was used (FK to api_keys).
  * ``actor``      — caller-supplied principal within the tenant.
  * ``source_ip``  — server-derived request origin.

All nullable: historical rows and service-internal writes have no actor context.
Adding columns is DDL, so the append-only row triggers on ``transactions`` are
not involved and no backfill is required.

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-06
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "transactions",
        sa.Column(
            "api_key_id",
            sa.Uuid(),
            sa.ForeignKey("api_keys.id"),
            nullable=True,
        ),
    )
    op.add_column("transactions", sa.Column("actor", sa.String(255), nullable=True))
    op.add_column("transactions", sa.Column("source_ip", sa.String(45), nullable=True))


def downgrade() -> None:
    op.drop_column("transactions", "source_ip")
    op.drop_column("transactions", "actor")
    op.drop_column("transactions", "api_key_id")
