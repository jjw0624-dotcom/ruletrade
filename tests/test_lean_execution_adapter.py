from decimal import Decimal

from ruletrade.adapters.lean.execution import execute_rebalance
from ruletrade.core.intents import RebalanceIntent


class FakeLeanAlgorithm:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, float | None]] = []

    def set_holdings(
        self,
        symbol: str,
        percentage: float,
    ) -> None:
        self.calls.append(
            ("set_holdings", symbol, percentage)
        )

    def liquidate(
        self,
        symbol: str,
    ) -> None:
        self.calls.append(
            ("liquidate", symbol, None)
        )


def test_executes_rebalance_intent() -> None:
    algorithm = FakeLeanAlgorithm()

    intent = RebalanceIntent(
        target_weights={
            "QQQ": Decimal("0.35"),
            "SOXX": Decimal("0.35"),
            "TLT": Decimal("0.15"),
            "IEF": Decimal("0.15"),
        }
    )

    report = execute_rebalance(
        algorithm,
        intent,
    )

    assert algorithm.calls == [
        ("set_holdings", "IEF", 0.15),
        ("set_holdings", "QQQ", 0.35),
        ("set_holdings", "SOXX", 0.35),
        ("set_holdings", "TLT", 0.15),
    ]

    assert report.executed_targets == {
        "IEF": Decimal("0.15"),
        "QQQ": Decimal("0.35"),
        "SOXX": Decimal("0.35"),
        "TLT": Decimal("0.15"),
    }

    assert report.liquidated_symbols == ()


def test_liquidates_assets_removed_from_targets() -> None:
    algorithm = FakeLeanAlgorithm()

    intent = RebalanceIntent(
        target_weights={
            "QQQ": Decimal("0.50"),
            "TLT": Decimal("0.50"),
        }
    )

    report = execute_rebalance(
        algorithm,
        intent,
        currently_invested={
            "QQQ",
            "TLT",
            "SOXX",
        },
    )

    assert algorithm.calls == [
        ("liquidate", "SOXX", None),
        ("set_holdings", "QQQ", 0.50),
        ("set_holdings", "TLT", 0.50),
    ]

    assert report.liquidated_symbols == ("SOXX",)


def test_zero_weight_is_not_executed_as_target() -> None:
    algorithm = FakeLeanAlgorithm()

    intent = RebalanceIntent(
        target_weights={
            "QQQ": Decimal("1"),
            "SOXX": Decimal("0"),
        }
    )

    report = execute_rebalance(
        algorithm,
        intent,
        currently_invested={
            "QQQ",
            "SOXX",
        },
    )

    assert algorithm.calls == [
        ("liquidate", "SOXX", None),
        ("set_holdings", "QQQ", 1.0),
    ]

    assert report.executed_targets == {
        "QQQ": Decimal("1"),
    }
