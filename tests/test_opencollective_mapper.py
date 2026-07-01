"""Unit tests for the Open Collective mapper (pure functions, no DB/network)."""

from __future__ import annotations

from app.integrations.opencollective import (
    amount_to_decimal_str,
    map_transaction,
)


def _node(**over) -> dict:
    node = {
        "legacyId": 123,
        "kind": "CONTRIBUTION",
        "type": "CREDIT",
        "createdAt": "2024-01-01T00:00:00Z",
        "description": "Monthly donation",
        "amount": {"valueInCents": 15000, "currency": "USD"},
        "oppositeAccount": {"slug": "acme", "name": "Acme Inc"},
    }
    node.update(over)
    return node


def test_amount_conversion_is_exact_per_currency():
    assert amount_to_decimal_str(15000, "USD") == "150.00"
    assert amount_to_decimal_str(-15000, "USD") == "150.00"  # sign dropped
    assert amount_to_decimal_str(1050, "JPY") == "1050"  # exponent 0


def test_credit_contribution_debits_cash_credits_income():
    mapped = map_transaction(_node(), "webpack")
    assert mapped is not None
    assert mapped.amount == "150.00"
    assert mapped.currency == "USD"
    # Money in: Cash (asset) is debited, income is credited.
    assert mapped.debit.type == "asset"
    assert mapped.debit.external_id == "oc:webpack:cash:USD"
    assert mapped.credit.type == "revenue"
    assert mapped.credit.external_id == "oc:webpack:income-contributions:USD"
    # Stable, idempotent identifiers derived from the OC legacy id.
    assert mapped.idempotency_key == "oc:123"
    assert mapped.external_id == "oc:123"
    assert mapped.metadata["source"] == "opencollective"
    assert mapped.metadata["legacy_id"] == 123


def test_debit_expense_debits_expense_credits_cash():
    mapped = map_transaction(
        _node(legacyId=9, kind="EXPENSE", type="DEBIT", description="Payout"), "webpack"
    )
    assert mapped is not None
    assert mapped.debit.type == "expense"
    assert mapped.debit.external_id == "oc:webpack:expense-payouts:USD"
    assert mapped.credit.external_id == "oc:webpack:cash:USD"


def test_payment_processor_fee_maps_to_its_own_expense_account():
    mapped = map_transaction(
        _node(kind="PAYMENT_PROCESSOR_FEE", type="DEBIT"), "webpack"
    )
    assert mapped is not None
    assert mapped.debit.external_id == "oc:webpack:expense-payment-processor-fees:USD"


def test_unknown_kind_falls_back_to_other_buckets():
    credit = map_transaction(_node(kind="MYSTERY", type="CREDIT"), "webpack")
    debit = map_transaction(_node(kind="MYSTERY", type="DEBIT"), "webpack")
    assert credit is not None and credit.credit.external_id.endswith("income-other:USD")
    assert debit is not None and debit.debit.external_id.endswith("expense-other:USD")


def test_unsupported_currency_is_skipped():
    assert map_transaction(
        _node(amount={"valueInCents": 100, "currency": "NZD"}), "webpack"
    ) is None


def test_zero_amount_is_skipped():
    assert map_transaction(
        _node(amount={"valueInCents": 0, "currency": "USD"}), "webpack"
    ) is None
