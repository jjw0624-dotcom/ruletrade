from __future__ import annotations

import argparse
import json
import tempfile
from contextlib import ExitStack
from datetime import date
from pathlib import Path

from ruletrade.backtest_runs.models import BacktestRunStatus
from ruletrade.backtest_runs.service import BacktestRunService
from ruletrade.backtests.lean_runner import DockerLeanRunner
from ruletrade.backtests.models import BacktestConfig
from ruletrade.backtests.service import BacktestService
from ruletrade.market_data.service import MarketDataService
from ruletrade.persistence import SQLiteBacktestRunRepository, SQLiteStrategyRepository
from ruletrade.strategies.service import StrategyService
from ruletrade.strategy.v1.fixtures import momentum_top_n_strategy
from ruletrade.strategy.v1.models import CanonicalStrategyV1

WARMUP_OBSERVATIONS = 21
DEFAULT_VISIBLE_OBSERVATIONS = 63


def _one_symbol_strategy(symbol: str) -> CanonicalStrategyV1:
    payload = momentum_top_n_strategy().model_dump(mode="json")
    payload["metadata"]["name"] = f"{symbol} real-data smoke"
    payload["definitions"]["asset_sets"][0]["assets"] = [symbol]
    components = {
        component["id"]: component for component in payload["graph"]["components"]
    }
    components["momentum"]["config"]["lookback_bars"] = WARMUP_OBSERVATIONS
    components["top_n"]["config"]["count"] = 1
    return CanonicalStrategyV1.model_validate(payload)


def _covered_period(
    service: MarketDataService,
    symbol: str,
    start_date: date | None,
    end_date: date | None,
) -> tuple[date, date]:
    if (start_date is None) != (end_date is None):
        raise ValueError("start-date and end-date must be supplied together")
    if start_date is not None and end_date is not None:
        return start_date, end_date
    dates = service.available_daily_dates(symbol)
    required = WARMUP_OBSERVATIONS + DEFAULT_VISIBLE_OBSERVATIONS
    if len(dates) < required:
        raise ValueError(
            f"{symbol} needs at least {required} cached daily observations for the "
            "default 21-observation warm-up smoke period"
        )
    return dates[-DEFAULT_VISIBLE_OBSERVATIONS], dates[-1]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run one persisted real-data Backtest through Docker LEAN."
    )
    parser.add_argument("--symbol", default="QQQ")
    parser.add_argument("--start-date", type=date.fromisoformat)
    parser.add_argument("--end-date", type=date.fromisoformat)
    parser.add_argument("--database", type=Path)
    args = parser.parse_args()
    symbol = args.symbol.upper()
    market_data = MarketDataService()
    try:
        start_date, end_date = _covered_period(
            market_data, symbol, args.start_date, args.end_date
        )
    except ValueError as exc:
        parser.error(str(exc))

    strategy = _one_symbol_strategy(symbol)
    config = BacktestConfig(
        dataset_id="us-equity-daily-local",
        start_date=start_date,
        end_date=end_date,
    )
    preflight = market_data.preflight(strategy, config)
    availability = preflight.symbols[0]
    if preflight.overall != "available":
        parser.error(f"{symbol}: {availability.reason}")

    with ExitStack() as stack:
        if args.database is None:
            root = Path("build/lean/real-market-data-smoke")
            root.mkdir(parents=True, exist_ok=True)
            temporary = stack.enter_context(
                tempfile.TemporaryDirectory(prefix="run-", dir=root)
            )
            database = Path(temporary) / "ruletrade.sqlite3"
        else:
            database = args.database
            if database.exists():
                parser.error(f"acceptance database already exists: {database}")
            database.parent.mkdir(parents=True, exist_ok=True)

        strategies = StrategyService(SQLiteStrategyRepository(database))
        runs = BacktestRunService(
            SQLiteBacktestRunRepository(database),
            strategies,
            BacktestService(DockerLeanRunner(), market_data),
        )
        revision = strategies.create_strategy(
            f"{symbol} real-data smoke", strategy
        ).current_revision
        run = runs.create_and_execute(revision.id, config)
        if run.status != BacktestRunStatus.SUCCEEDED:
            error = None if run.error is None else run.error.model_dump(mode="json")
            raise RuntimeError(f"real-data smoke failed: {error}")
        evidence = runs.list_decision_events(run.id)
        if not evidence:
            raise RuntimeError("real-data smoke persisted no Decision Evidence")

        reopened = BacktestRunService(
            SQLiteBacktestRunRepository(database),
            StrategyService(SQLiteStrategyRepository(database)),
            BacktestService(DockerLeanRunner(), market_data),
        ).get_run(run.id)
        if reopened != run:
            raise RuntimeError("persisted Run did not reopen identically")

        print(
            json.dumps(
                {
                    "symbol": symbol,
                    "requested_period": f"{start_date}..{end_date}",
                    "preflight_status": preflight.overall,
                    "available_coverage": (
                        f"{availability.available_from}..{availability.available_to}"
                    ),
                    "required_warmup_observations": WARMUP_OBSERVATIONS,
                    "run_id": run.id,
                    "run_status": run.status.value,
                    "equity_points": run.diagnostics.equity_points,
                    "decision_evidence_events": len(evidence),
                    "market_data_cache_hit": run.diagnostics.market_data_cache_hit,
                    "data_preflight_ms": run.timings.data_preflight_ms,
                    "lean_execution_ms": run.timings.lean_execution_ms,
                    "total_ms": run.timings.total_ms,
                },
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
