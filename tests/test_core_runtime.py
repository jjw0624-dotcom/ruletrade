from datetime import datetime, timezone
from decimal import Decimal

from ruletrade.core.events import RebalanceEvent
from ruletrade.core.runtime import (
    EmptyContext,
    StrategyState,
    evaluate_strategy,
)
from ruletrade.strategy.models import StrategyDocument


def strategy() -> StrategyDocument:
    return StrategyDocument.model_validate(
        {
            "name": "runtime-demo",
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


def test_runtime_emits_rebalance_intent_and_trace() -> None:
    original_state = StrategyState(
        values={"example": 1}
    )

    result = evaluate_strategy(
        strategy(),
        event=RebalanceEvent(
            occurred_at=datetime(
                2026,
                9,
                1,
                tzinfo=timezone.utc,
            ),
            event_id="2026-09",
        ),
        context=EmptyContext(),
        state=original_state,
    )

    assert len(result.intents) == 1

    intent = result.intents[0]

    assert sum(
        intent.target_weights.values(),
        Decimal("0"),
    ) == Decimal("1")

    assert len(result.trace) == 2

    growth_trace = next(
        item
        for item in result.trace
        if item.group_id == "growth"
    )

    assert len(growth_trace.selected_symbols) == 2

    for symbol in growth_trace.selected_symbols:
        assert (
            growth_trace.portfolio_weights[symbol]
            == Decimal("0.35")
        )

    safe_trace = next(
        item
        for item in result.trace
        if item.group_id == "safe"
    )

    assert safe_trace.portfolio_weights == {
        "TLT": Decimal("0.15"),
        "IEF": Decimal("0.15"),
    }

    assert result.state is original_state


def test_runtime_is_deterministic_for_same_inputs() -> None:
    event = RebalanceEvent(
        occurred_at=datetime(
            2026,
            9,
            1,
            tzinfo=timezone.utc,
        ),
        event_id="2026-09",
    )

    state = StrategyState(values={})

    first = evaluate_strategy(
        strategy(),
        event=event,
        context=EmptyContext(),
        state=state,
    )

    second = evaluate_strategy(
        strategy(),
        event=event,
        context=EmptyContext(),
        state=state,
    )

    assert first == second
