import json
from decimal import Decimal

import pytest

from ruletrade.compiler.lean import lower_to_lean_plan
from ruletrade.core.selection import select_symbols
from ruletrade.strategy.models import RandomNSelection
from ruletrade.strategy.v1.fixtures import golden_portfolio_strategy
from ruletrade.strategy.v1.randomness import deterministic_random_seed
from ruletrade.compiler.lean.e2e import INTEREST_RATE_WARNING, validate_golden_e2e


EVENTS = (
    "2024-01-02",
    "2024-02-01",
    "2024-03-01",
    "2024-04-01",
    "2024-05-01",
    "2024-06-03",
    "2024-07-01",
    "2024-08-01",
    "2024-09-03",
    "2024-10-01",
    "2024-11-01",
    "2024-12-02",
)


def _target_line(event_identity: str) -> str:
    strategy = golden_portfolio_strategy()
    selection = lower_to_lean_plan(strategy).random_selections[0]
    seed = deterministic_random_seed(
        strategy,
        selection.component_id,
        event_identity=event_identity,
    )
    selected = select_symbols(
        list(selection.symbols),
        RandomNSelection(count=selection.count, resample=selection.resample),
        seed=seed,
    )
    weights = {
        **{symbol: Decimal("0.35") for symbol in selected},
        "IEF": Decimal("0.15"),
        "TLT": Decimal("0.15"),
    }
    weight_text = ",".join(f"{symbol}={weights[symbol]}" for symbol in sorted(weights))
    return (
        f"DEBUG:: RULETRADE_TARGETS|{event_identity}"
        f"|selected={','.join(selected)}|weights={weight_text}"
    )


def test_strict_e2e_validation_includes_v0_monthly_differential() -> None:
    log = "\n".join(
        [
            *(_target_line(event) for event in EVENTS),
            INTEREST_RATE_WARNING,
            "Algorithm Id:(RuleTradeGeneratedAlgorithm) completed in 1.0 seconds",
        ]
    )
    result = {"statistics": {"Total Orders": "46", "Net Profit": "36.652%"}}

    validation = validate_golden_e2e(log, result)

    assert validation.monthly_events == 12
    assert validation.total_orders == 46
    assert validation.interest_rate_fixture_warning is True


def test_e2e_validation_rejects_price_readiness_error() -> None:
    log = "\n".join(_target_line(event) for event in EVENTS)
    log += "\nThe security does not have an accurate price as it has not yet received a bar of data."
    log += "\nAlgorithm Id:(RuleTradeGeneratedAlgorithm) completed in 1.0 seconds"

    with pytest.raises(ValueError, match="fatal LEAN execution error"):
        validate_golden_e2e(log, {"statistics": {"Total Orders": "46"}})


def test_e2e_validation_rejects_zero_orders(tmp_path) -> None:
    log = "\n".join(_target_line(event) for event in EVENTS)
    log += "\nAlgorithm Id:(RuleTradeGeneratedAlgorithm) completed in 1.0 seconds"
    result_file = tmp_path / "result.json"
    result_file.write_text(json.dumps({"statistics": {"Total Orders": "0"}}))

    with pytest.raises(ValueError, match="submitted no orders"):
        validate_golden_e2e(log, json.loads(result_file.read_text()))
