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

def test_same_event_resolves_random_selection_identically() -> None:
    spec = strategy()

    first = resolve_portfolio(
        spec,
        event_id="2026-01",
    )

    second = resolve_portfolio(
        spec,
        event_id="2026-01",
    )

    assert first == second

def test_per_event_random_selection_varies_across_events() -> None:
    spec = strategy()

    selections = set()

    for month in range(1, 7):
        result = resolve_portfolio(
            spec,
            event_id=f"2026-{month:02d}",
        )

        growth = next(
            group
            for group in result.groups
            if group.group_id == "growth"
        )

        selections.add(
            growth.selected_symbols
        )

    assert len(selections) > 1

def test_once_random_selection_ignores_event_id() -> None:
    spec = strategy()

    payload = spec.model_dump(mode="json")
    payload["groups"][0]["selection"]["resample"] = "once"

    once_strategy = StrategyDocument.model_validate(payload)

    january = resolve_portfolio(
        once_strategy,
        event_id="2026-01",
    )

    february = resolve_portfolio(
        once_strategy,
        event_id="2026-02",
    )

    january_growth = next(
        group
        for group in january.groups
        if group.group_id == "growth"
    )

    february_growth = next(
        group
        for group in february.groups
        if group.group_id == "growth"
    )

    assert (
        january_growth.selected_symbols
        == february_growth.selected_symbols
    )