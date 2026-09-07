from datetime import datetime, timezone

from ruletrade.adapters.lean.runtime import LeanRuntimeBridge
from ruletrade.strategy.models import StrategyDocument


class FakeLeanAlgorithm:
    def __init__(self) -> None:
        self.calls: list[tuple[str, object, float | None]] = []

    def set_holdings(
        self,
        symbol: object,
        percentage: float,
    ) -> None:
        self.calls.append(
            ("set_holdings", symbol, percentage)
        )

    def liquidate(
        self,
        symbol: object,
    ) -> None:
        self.calls.append(
            ("liquidate", symbol, None)
        )


def strategy() -> StrategyDocument:
    return StrategyDocument.model_validate(
        {
            "name": "bridge-demo",
            "random_seed": 123,
            "groups": [
                {
                    "id": "us",
                    "weight": "1",
                    "universe": ["QQQ", "VOO"],
                    "selection": {
                        "type": "all"
                    },
                    "allocation": {
                        "type": "equal_weight"
                    },
                }
            ],
            "rebalance": {
                "type": "monthly"
            },
        }
    )


def test_bridge_runs_core_and_executes_intent() -> None:
    algorithm = FakeLeanAlgorithm()

    qqq = object()
    voo = object()

    bridge = LeanRuntimeBridge(
        strategy(),
        symbols={
            "QQQ": qqq,
            "VOO": voo,
        },
    )

    result, reports = bridge.evaluate(
        algorithm=algorithm,
        occurred_at=datetime(
            2026,
            9,
            1,
            tzinfo=timezone.utc,
        ),
        event_id="2026-09",
        currently_invested=set(),
    )

    assert result.intents[0].target_weights == {
        "QQQ": result.trace[0].portfolio_weights["QQQ"],
        "VOO": result.trace[0].portfolio_weights["VOO"],
    }

    assert algorithm.calls == [
        ("set_holdings", qqq, 0.5),
        ("set_holdings", voo, 0.5),
    ]

    assert len(reports) == 1


def test_bridge_liquidates_removed_selection() -> None:
    spec = StrategyDocument.model_validate(
        {
            "name": "random-demo",
            "random_seed": 123,
            "groups": [
                {
                    "id": "growth",
                    "weight": "1",
                    "universe": ["QQQ", "VOO"],
                    "selection": {
                        "type": "random_n",
                        "count": 1,
                        "resample": "per_event"
                    },
                    "allocation": {
                        "type": "equal_weight"
                    },
                }
            ],
            "rebalance": {
                "type": "monthly"
            },
        }
    )

    algorithm = FakeLeanAlgorithm()

    qqq = object()
    voo = object()

    bridge = LeanRuntimeBridge(
        spec,
        symbols={
            "QQQ": qqq,
            "VOO": voo,
        },
    )

    first, _ = bridge.evaluate(
        algorithm=algorithm,
        occurred_at=datetime(
            2026,
            1,
            1,
            tzinfo=timezone.utc,
        ),
        event_id="2026-01",
        currently_invested=set(),
    )

    first_symbol = next(
        iter(first.intents[0].target_weights)
    )

    second_event = None
    second_result = None

    for month in range(2, 13):
        candidate, _ = bridge.evaluate(
            algorithm=FakeLeanAlgorithm(),
            occurred_at=datetime(
                2026,
                month,
                1,
                tzinfo=timezone.utc,
            ),
            event_id=f"2026-{month:02d}",
            currently_invested={first_symbol},
        )

        if (
            set(candidate.intents[0].target_weights)
            != {first_symbol}
        ):
            second_event = month
            second_result = candidate
            break

    assert second_event is not None
    assert second_result is not None

    replacement = next(
        iter(second_result.intents[0].target_weights)
    )

    execution_algorithm = FakeLeanAlgorithm()

    bridge.evaluate(
        algorithm=execution_algorithm,
        occurred_at=datetime(
            2027,
            second_event,
            1,
            tzinfo=timezone.utc,
        ),
        event_id=f"2026-{second_event:02d}",
        currently_invested={first_symbol},
    )

    expected_old = {
        "QQQ": qqq,
        "VOO": voo,
    }[first_symbol]

    expected_new = {
        "QQQ": qqq,
        "VOO": voo,
    }[replacement]

    assert execution_algorithm.calls == [
        ("liquidate", expected_old, None),
        ("set_holdings", expected_new, 1.0),
    ]
