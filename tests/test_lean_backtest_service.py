from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

import pytest

from ruletrade.backtests.errors import (
    InvalidStrategyError,
    LeanExecutionError,
    LeanRuntimeUnavailableError,
    MalformedLeanResultError,
    UnsupportedStrategyError,
)
from ruletrade.backtests.lean_runner import LeanRunArtifact
from ruletrade.backtests.models import BacktestConfig, LeanBacktestRequest
from ruletrade.backtests.service import BacktestService
from ruletrade.strategy.v1.fixtures import (
    GOLDEN_PORTFOLIO_PAYLOAD,
    filter_screening_strategy,
    golden_portfolio_strategy,
    golden_stateful_rule_strategy,
)
from ruletrade.strategy.v1.models import CanonicalStrategyV1


def lean_payload() -> dict[str, Any]:
    return {
        "statistics": {
            "Start Equity": "100000",
            "End Equity": "133448.49",
            "Net Profit": "33.448%",
            "Total Orders": "51",
            "Total Fees": "$73.86",
        },
        "charts": {
            "Strategy Equity": {
                "name": "Strategy Equity",
                "chartType": 0,
                "series": {
                    "Equity": {
                        "name": "Equity",
                        "unit": "$",
                        "index": 0,
                        "seriesType": 4,
                        "values": [
                            [1704153600, 100000, 100000, 100000, 100000],
                            [
                                1735603200,
                                133448.49,
                                133448.49,
                                133448.49,
                                133448.49,
                            ],
                        ],
                    }
                },
            }
        },
    }


@dataclass
class FakeRunner:
    payload: dict[str, Any] = field(default_factory=lean_payload)
    calls: list[tuple[str, str]] = field(default_factory=list)
    error: Exception | None = None

    def run(self, generated_csharp: str, *, dataset_id: str) -> LeanRunArtifact:
        self.calls.append((generated_csharp, dataset_id))
        if self.error is not None:
            raise self.error
        return LeanRunArtifact(log_text="Backtest completed", result_payload=self.payload)


def request(*, count: int = 2, config: BacktestConfig | None = None) -> LeanBacktestRequest:
    strategy = golden_portfolio_strategy()
    components = list(strategy.graph.components)
    random_index = next(index for index, item in enumerate(components) if item.id == "growth_random")
    components[random_index] = components[random_index].model_copy(
        update={"config": {"count": count, "resample": "per_event"}}
    )
    strategy = strategy.model_copy(
        update={"graph": strategy.graph.model_copy(update={"components": tuple(components)})}
    )
    return LeanBacktestRequest(strategy=strategy, config=config or BacktestConfig())


def test_service_runs_existing_compiler_path_and_normalizes_result() -> None:
    runner = FakeRunner()
    response = BacktestService(runner).execute(request(count=3))

    assert len(runner.calls) == 1
    source, dataset_id = runner.calls[0]
    assert dataset_id == "golden-synthetic"
    assert "new[] { \"QQQ\", \"VGT\", \"SOXX\", \"SCHG\" }, 3," in source
    assert "SetStartDate(2024, 1, 1);" in source
    assert response.result.initial_value == 100000
    assert response.result.final_value == Decimal("133448.49")
    assert response.result.total_return == Decimal("0.33448")
    assert response.result.total_orders == 51
    assert response.result.total_fees == Decimal("73.86")
    assert len(response.result.equity_curve) == 2


def test_service_compiles_filter_strategy_and_selects_filter_fixture() -> None:
    runner = FakeRunner()
    submitted = LeanBacktestRequest(
        strategy=filter_screening_strategy(),
        config=BacktestConfig(dataset_id="filter-synthetic"),
    )

    response = BacktestService(runner).execute(submitted)

    source, dataset_id = runner.calls[0]
    assert dataset_id == "filter-synthetic"
    assert ".Where(item => item.Value > 0m)" in source
    assert "RULETRADE_FILTER|" in source
    assert response.result.total_orders == 51


def test_backtest_config_changes_codegen_without_mutating_canonical() -> None:
    runner = FakeRunner()
    submitted = request(
        config=BacktestConfig(
            start_date="2024-02-01",
            end_date="2024-11-30",
            initial_cash="250000",
        )
    )
    before = submitted.strategy.model_dump(mode="json")

    response = BacktestService(runner).execute(submitted)

    assert submitted.strategy.model_dump(mode="json") == before
    assert response.config.initial_cash == 250000
    assert "SetStartDate(2024, 2, 1);" in runner.calls[0][0]
    assert "SetCash(250000m);" in runner.calls[0][0]


def test_invalid_strategy_is_rejected_before_runner_invocation() -> None:
    runner = FakeRunner()
    payload = deepcopy(GOLDEN_PORTFOLIO_PAYLOAD)
    payload["entrypoints"] = [
        {"event_component_id": "rebalance", "target_component_id": "monthly"}
    ]
    submitted = LeanBacktestRequest(strategy=CanonicalStrategyV1.model_validate(payload))

    with pytest.raises(InvalidStrategyError):
        BacktestService(runner).execute(submitted)
    assert runner.calls == []


def test_valid_but_unsupported_strategy_has_distinct_error() -> None:
    runner = FakeRunner()
    submitted = LeanBacktestRequest(strategy=golden_stateful_rule_strategy())

    with pytest.raises(UnsupportedStrategyError, match="unsupported LEAN v0"):
        BacktestService(runner).execute(submitted)
    assert runner.calls == []


@pytest.mark.parametrize(
    "error",
    [LeanRuntimeUnavailableError("Docker unavailable"), LeanExecutionError("LEAN failed")],
)
def test_runner_errors_are_preserved(error: Exception) -> None:
    runner = FakeRunner(error=error)
    with pytest.raises(type(error)):
        BacktestService(runner).execute(request())


def test_malformed_lean_result_fails_safely() -> None:
    runner = FakeRunner(payload={"statistics": {"Total Orders": "1"}})
    with pytest.raises(MalformedLeanResultError, match="charts"):
        BacktestService(runner).execute(request())
