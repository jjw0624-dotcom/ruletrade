from decimal import Decimal

from ruletrade.core.portfolio import resolve_portfolio
from ruletrade.strategy.models import StrategyDocument


def strategy() -> StrategyDocument:
    return StrategyDocument.model_validate(
        {
            "name": "random-groups",
            "random_seed": 123,
            "groups": [
                {
                    "id": "growth",
                    "weight": "0.7",
                    "universe": [
                        "QQQ",
                        "VGT",
                        "SOXX",
                        "SCHG",
                    ],
                    "selection": {
                        "type": "random_n",
                        "count": 2,
                    },
                    "allocation": {
                        "type": "equal_weight",
                    },
                },
                {
                    "id": "safe",
                    "weight": "0.3",
                    "universe": [
                        "TLT",
                        "IEF",
                    ],
                    "selection": {
                        "type": "all",
                    },
                    "allocation": {
                        "type": "equal_weight",
                    },
                },
            ],
            "rebalance": {
                "type": "monthly",
            },
        }
    )


def test_resolves_group_weights_to_leaf_assets() -> None:
    result = resolve_portfolio(strategy())

    growth = next(
        group
        for group in result.groups
        if group.group_id == "growth"
    )

    safe = next(
        group
        for group in result.groups
        if group.group_id == "safe"
    )

    assert len(growth.selected_symbols) == 2

    assert set(safe.selected_symbols) == {
        "TLT",
        "IEF",
    }

    for symbol in growth.selected_symbols:
        assert result.target_weights[symbol] == Decimal("0.35")

    assert result.target_weights["TLT"] == Decimal("0.15")
    assert result.target_weights["IEF"] == Decimal("0.15")

    assert sum(
        result.target_weights.values(),
        Decimal("0"),
    ) == Decimal("1")


def test_same_strategy_resolves_identically() -> None:
    first = resolve_portfolio(strategy())
    second = resolve_portfolio(strategy())

    assert first == second
