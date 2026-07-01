"""Open Collective -> FinLedger connector.

Open Collective (https://opencollective.com) runs a **transparent, public
ledger** for thousands of open-source collectives and exposes it through a
GraphQL API. This connector mirrors one collective's money movements into a
FinLedger tenant so an agent can query them over MCP/REST.

Pipeline (the shape every connector shares):

    fetch (OC GraphQL) -> map (single-entry -> balanced double-entry) -> load (/v1)

The mapping is the crux. Open Collective reports each movement from the
*collective's* perspective as a single signed row (``type`` CREDIT = money in,
DEBIT = money out). FinLedger is strict double-entry, so every row becomes a
two-leg transaction against a per-currency **Cash** account:

    * CREDIT (contribution)  -> debit  Cash,             credit Income:<kind>
    * DEBIT  (expense / fee) -> debit  Expenses:<kind>,  credit Cash

Both legs carry the same currency and the same absolute amount, so the entry
balances by construction. Open Collective already lists payment-processor and
host fees as their *own* DEBIT rows, so posting each row on its own captures the
gross contribution and the fees as separate, correct entries (net cash = gross
- fees).

Idempotency: each Open Collective transaction has a stable integer ``legacyId``.
We use ``oc:<legacyId>`` as both the FinLedger ``idempotency_key`` and
``external_id``, so re-running the import (or an overlapping incremental run)
posts nothing new. Accounts are idempotent on their ``external_id`` too.

Usage::

    python -m app.integrations.opencollective \\
        --collective webpack \\
        --base-url https://finledger-api-rw1f.onrender.com \\
        --api-key sk_live_... \\
        --max 500

    # preview the mapping without writing anything:
    python -m app.integrations.opencollective --collective babel --dry-run --max 20

Requires ``httpx`` (``pip install -e ".[integrations]"``).
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Iterator
from dataclasses import dataclass, field
from decimal import Decimal

try:
    import httpx
except ModuleNotFoundError:  # pragma: no cover - guidance when the extra is absent
    print(
        "This connector needs httpx. Install it with:\n"
        '    pip install -e ".[integrations]"',
        file=sys.stderr,
    )
    raise

OC_GRAPHQL_URL = "https://api.opencollective.com/graphql/v2"

# Standard ISO minor-unit exponents, restricted to the fiat currencies FinLedger
# seeds by default (see app/ledger_ddl.py). Open Collective returns amounts as an
# integer ``valueInCents`` in these same minor units, so the conversion to a
# major-unit decimal is exact (no floats). A transaction in any other currency is
# skipped rather than posted with a guessed scale.
CURRENCY_EXPONENTS: dict[str, int] = {
    "USD": 2,
    "EUR": 2,
    "GBP": 2,
    "JPY": 0,
    "INR": 2,
    "CHF": 2,
    "CAD": 2,
    "AUD": 2,
    "SGD": 2,
}

# The GraphQL query: one collective, one page of its transactions, oldest first
# so running balances read naturally in FinLedger.
_TRANSACTIONS_QUERY = """
query ($slug: String!, $limit: Int!, $offset: Int!) {
  account(slug: $slug) {
    slug
    name
    currency
    transactions(limit: $limit, offset: $offset,
                 orderBy: { field: CREATED_AT, direction: ASC }) {
      totalCount
      nodes {
        legacyId
        kind
        type
        createdAt
        description
        amount { valueInCents currency }
        oppositeAccount { slug name }
      }
    }
  }
}
"""


# --------------------------------------------------------------------------- #
# Mapping (pure functions — no network, unit-tested)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True, slots=True)
class AccountSpec:
    """A chart-of-accounts entry the loader must ensure exists."""

    external_id: str
    name: str
    type: str  # asset | liability | equity | revenue | expense
    currency: str


@dataclass(frozen=True, slots=True)
class MappedTxn:
    """One Open Collective row mapped to a balanced FinLedger transaction."""

    idempotency_key: str
    external_id: str
    description: str
    currency: str
    amount: str  # major-unit decimal string, e.g. "150.00"
    debit: AccountSpec
    credit: AccountSpec
    metadata: dict = field(default_factory=dict)


# How each Open Collective ``kind`` names its non-cash leg. The cash side is
# always the per-currency Cash account; this table picks the counterparty.
_INCOME_KINDS = {
    "CONTRIBUTION": ("income-contributions", "Contributions", "revenue"),
    "ADDED_FUNDS": ("income-added-funds", "Added Funds", "revenue"),
    "PLATFORM_TIP": ("income-platform-tips", "Platform Tips", "revenue"),
}
_EXPENSE_KINDS = {
    "EXPENSE": ("expense-payouts", "Grants & Payouts", "expense"),
    "PAYMENT_PROCESSOR_FEE": (
        "expense-payment-processor-fees",
        "Payment Processor Fees",
        "expense",
    ),
    "HOST_FEE": ("expense-host-fees", "Host Fees", "expense"),
    "HOST_FEE_SHARE": ("expense-host-fees", "Host Fees", "expense"),
    "PLATFORM_FEE": ("expense-platform-fees", "Platform Fees", "expense"),
}
_FALLBACK_INCOME = ("income-other", "Other Income", "revenue")
_FALLBACK_EXPENSE = ("expense-other", "Other Expenses", "expense")


def amount_to_decimal_str(value_in_cents: int, currency: str) -> str:
    """Convert an Open Collective ``valueInCents`` to a major-unit decimal string.

    Exact integer math via the ISO exponent — never a float. The sign is dropped
    (postings are always positive; direction carries the sign).
    """
    exponent = CURRENCY_EXPONENTS[currency]
    magnitude = Decimal(abs(int(value_in_cents))).scaleb(-exponent)
    return format(magnitude, "f")


def _account(slug: str, currency: str, role: str, name: str, type_: str) -> AccountSpec:
    return AccountSpec(
        external_id=f"oc:{slug}:{role}:{currency}",
        name=f"{name} ({currency})",
        type=type_,
        currency=currency,
    )


def map_transaction(node: dict, collective_slug: str) -> MappedTxn | None:
    """Map one Open Collective transaction node to a :class:`MappedTxn`.

    Returns ``None`` (skipped) when the currency is unsupported or the amount is
    zero — a zero posting would be rejected by the ledger.
    """
    amount = node.get("amount") or {}
    currency = amount.get("currency")
    cents = amount.get("valueInCents")
    if currency not in CURRENCY_EXPONENTS or not cents:
        return None

    kind = node.get("kind") or "UNKNOWN"
    txn_type = node.get("type")  # CREDIT (money in) | DEBIT (money out)
    cash = _account(collective_slug, currency, "cash", "Cash", "asset")

    if txn_type == "CREDIT":
        role, name, type_ = _INCOME_KINDS.get(kind, _FALLBACK_INCOME)
        counterparty = _account(collective_slug, currency, role, name, type_)
        debit, credit = cash, counterparty
    else:  # DEBIT (or anything unexpected): treat as money leaving cash
        role, name, type_ = _EXPENSE_KINDS.get(kind, _FALLBACK_EXPENSE)
        counterparty = _account(collective_slug, currency, role, name, type_)
        debit, credit = counterparty, cash

    legacy_id = node["legacyId"]
    opposite = (node.get("oppositeAccount") or {}).get("slug")
    description = node.get("description") or f"{kind} ({txn_type})"

    return MappedTxn(
        idempotency_key=f"oc:{legacy_id}",
        external_id=f"oc:{legacy_id}",
        description=description,
        currency=currency,
        amount=amount_to_decimal_str(cents, currency),
        debit=debit,
        credit=credit,
        metadata={
            "source": "opencollective",
            "collective": collective_slug,
            "legacy_id": legacy_id,
            "kind": kind,
            "type": txn_type,
            "opposite_account": opposite,
            "created_at": node.get("createdAt"),
        },
    )


# --------------------------------------------------------------------------- #
# Fetch (Open Collective GraphQL)
# --------------------------------------------------------------------------- #
def fetch_transactions(
    client: httpx.Client,
    slug: str,
    *,
    token: str | None = None,
    page_size: int = 100,
    max_count: int | None = None,
) -> Iterator[dict]:
    """Yield an Open Collective collective's transaction nodes, oldest first.

    Pages through the GraphQL ``transactions`` connection until the collective is
    exhausted or ``max_count`` nodes have been yielded.
    """
    headers = {"Personal-Token": token} if token else {}
    offset = 0
    yielded = 0
    while True:
        variables = {"slug": slug, "limit": page_size, "offset": offset}
        resp = client.post(
            OC_GRAPHQL_URL,
            json={"query": _TRANSACTIONS_QUERY, "variables": variables},
            headers=headers,
        )
        resp.raise_for_status()
        payload = resp.json()
        if payload.get("errors"):
            raise RuntimeError(f"Open Collective API error: {payload['errors']}")

        account = (payload.get("data") or {}).get("account")
        if account is None:
            raise RuntimeError(f"no such collective: {slug!r}")

        collection = account["transactions"]
        nodes = collection["nodes"]
        if not nodes:
            return

        for node in nodes:
            yield node
            yielded += 1
            if max_count is not None and yielded >= max_count:
                return

        offset += page_size
        if offset >= collection["totalCount"]:
            return


# --------------------------------------------------------------------------- #
# Load (FinLedger REST API)
# --------------------------------------------------------------------------- #
class FinLedgerClient:
    """Thin REST client for a FinLedger tenant that posts what the mapper emits.

    Accounts are resolved lazily and cached by ``external_id``; the warmed cache
    plus the ledger's own idempotency make re-runs cheap and safe.
    """

    def __init__(self, base_url: str, api_key: str, *, timeout: float = 30.0):
        self._client = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers={"X-API-Key": api_key},
            timeout=timeout,
        )
        self._account_ids: dict[str, str] = {}

    def __enter__(self) -> FinLedgerClient:
        self._warm_account_cache()
        return self

    def __exit__(self, *exc: object) -> None:
        self._client.close()

    def _warm_account_cache(self) -> None:
        """Pre-load existing accounts so a re-run skips redundant create calls."""
        offset = 0
        while True:
            resp = self._client.get(
                "/v1/accounts", params={"limit": 500, "offset": offset}
            )
            resp.raise_for_status()
            rows = resp.json()
            for row in rows:
                if row.get("external_id"):
                    self._account_ids[row["external_id"]] = row["id"]
            if len(rows) < 500:
                return
            offset += 500

    def ensure_account(self, spec: AccountSpec) -> str:
        """Return the FinLedger account id for ``spec``, creating it if needed.

        ``POST /v1/accounts`` is idempotent on ``external_id`` (it returns the
        existing account), so this is safe to call for every leg of every row.
        """
        cached = self._account_ids.get(spec.external_id)
        if cached is not None:
            return cached
        resp = self._client.post(
            "/v1/accounts",
            json={
                "name": spec.name,
                "type": spec.type,
                "currency": spec.currency,
                "external_id": spec.external_id,
            },
        )
        resp.raise_for_status()
        account_id = resp.json()["id"]
        self._account_ids[spec.external_id] = account_id
        return account_id

    def post_transaction(self, txn: MappedTxn) -> tuple[str, dict]:
        """Post one mapped transaction. Returns ``(status, body)``.

        ``status`` is ``"posted"`` on 2xx (a replayed idempotent call also lands
        here — the ledger returns the original) or ``"error"`` with the ledger's
        stable error code on a 4xx.
        """
        debit_id = self.ensure_account(txn.debit)
        credit_id = self.ensure_account(txn.credit)
        resp = self._client.post(
            "/v1/transactions",
            json={
                "description": txn.description,
                "idempotency_key": txn.idempotency_key,
                "external_id": txn.external_id,
                "metadata": txn.metadata,
                "actor": "opencollective-import",
                "postings": [
                    {"account_id": debit_id, "direction": "debit", "amount": txn.amount},
                    {"account_id": credit_id, "direction": "credit", "amount": txn.amount},
                ],
            },
        )
        if resp.is_success:
            return "posted", resp.json()
        try:
            body = resp.json()
        except ValueError:
            body = {"error": {"code": "http_error", "message": resp.text}}
        return "error", body


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #
@dataclass(slots=True)
class ImportSummary:
    fetched: int = 0
    posted: int = 0
    skipped: int = 0
    errors: int = 0


def run_import(
    *,
    collective: str,
    base_url: str,
    api_key: str,
    token: str | None = None,
    max_count: int | None = None,
    dry_run: bool = False,
) -> ImportSummary:
    """Fetch, map and (unless ``dry_run``) load one collective's ledger."""
    summary = ImportSummary()

    with httpx.Client(timeout=30.0) as oc_client:
        nodes = fetch_transactions(
            oc_client, collective, token=token, max_count=max_count
        )

        if dry_run:
            for node in nodes:
                summary.fetched += 1
                mapped = map_transaction(node, collective)
                if mapped is None:
                    summary.skipped += 1
                    continue
                summary.posted += 1  # "would post"
                print(
                    f"  {mapped.amount:>14} {mapped.currency}  "
                    f"{mapped.debit.name} <- {mapped.credit.name}   "
                    f"[{mapped.idempotency_key}] {mapped.description[:50]}"
                )
            return summary

        with FinLedgerClient(base_url, api_key) as ledger:
            for node in nodes:
                summary.fetched += 1
                mapped = map_transaction(node, collective)
                if mapped is None:
                    summary.skipped += 1
                    continue
                status, body = ledger.post_transaction(mapped)
                if status == "posted":
                    summary.posted += 1
                else:
                    summary.errors += 1
                    err = body.get("error", body)
                    print(
                        f"  ERROR {mapped.idempotency_key}: "
                        f"{err.get('code')} — {err.get('message')}",
                        file=sys.stderr,
                    )

    return summary


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="finledger-import-opencollective",
        description="Mirror an Open Collective collective's ledger into FinLedger.",
    )
    parser.add_argument(
        "--collective",
        required=True,
        help="Open Collective slug, e.g. 'webpack' or 'babel'",
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("FINLEDGER_BASE_URL", "http://localhost:8000"),
        help="FinLedger API base URL (default: $FINLEDGER_BASE_URL or localhost)",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("FINLEDGER_API_KEY"),
        help="FinLedger tenant API key (default: $FINLEDGER_API_KEY)",
    )
    parser.add_argument(
        "--oc-token",
        default=os.environ.get("OPENCOLLECTIVE_TOKEN"),
        help="Optional Open Collective personal token to raise rate limits",
    )
    parser.add_argument(
        "--max", type=int, default=None, help="Cap the number of transactions imported"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and map, printing what would post — write nothing",
    )
    args = parser.parse_args()

    if not args.dry_run and not args.api_key:
        parser.error("--api-key (or $FINLEDGER_API_KEY) is required unless --dry-run")

    print(
        f"Importing Open Collective '{args.collective}' "
        f"{'(dry run) ' if args.dry_run else f'-> {args.base_url} '}..."
    )
    summary = run_import(
        collective=args.collective,
        base_url=args.base_url,
        api_key=args.api_key or "",
        token=args.oc_token,
        max_count=args.max,
        dry_run=args.dry_run,
    )
    print(
        f"\nDone. fetched={summary.fetched} "
        f"{'would_post' if args.dry_run else 'posted'}={summary.posted} "
        f"skipped={summary.skipped} errors={summary.errors}"
    )


if __name__ == "__main__":
    main()
