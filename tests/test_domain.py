from decimal import Decimal

import pytest
from pydantic import ValidationError

from ruletrade.domain import AssetAllocation, RecurringContribution, SimpleStrategySpec


def valid_spec() -> SimpleStrategySpec:
    return SimpleStrategySpec(
        name="demo",
        initial_capital=Decimal("10000"),
        recurring_contribution=RecurringContribution(amount=Decimal("500")),
        assets=[
            AssetAllocation(symbol="qqq", weight=Decimal("0.4")),
            AssetAllocation(symbol="voo", weight=Decimal("0.6")),
        ],
    )


def test_normalizes_symbols() -> None:
    assert valid_spec().assets[0].symbol == "QQQ"


def test_rejects_bad_weight_sum() -> None:
    with pytest.raises(ValidationError, match="sum to 1"):
        SimpleStrategySpec(
            name="bad",
            initial_capital="10000",
            assets=[
                {"symbol": "QQQ", "weight": "0.4"},
                {"symbol": "VOO", "weight": "0.5"},
            ],
        )


def test_rejects_duplicate_symbols() -> None:
    with pytest.raises(ValidationError, match="unique"):
        SimpleStrategySpec(
            name="bad",
            initial_capital="10000",
            assets=[
                {"symbol": "QQQ", "weight": "0.5"},
                {"symbol": "qqq", "weight": "0.5"},
            ],
        )
