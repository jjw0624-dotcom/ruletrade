from __future__ import annotations

import os
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

import pytest

from ruletrade.backtest_runs.service import BacktestRunService
from ruletrade.backtests.errors import MarketDataUnavailableError
from ruletrade.backtests.lean_runner import LeanRunArtifact
from ruletrade.backtests.models import BacktestConfig, LeanBacktestRequest
from ruletrade.backtests.service import BacktestService
from ruletrade.compiler import compile_strategy_to_lean_plan
from ruletrade.compiler.lean import CSharpGenerationSettings, generate_csharp
from ruletrade.market_data.service import MarketDataService
from ruletrade.persistence import SQLiteBacktestRunRepository, SQLiteStrategyRepository
from ruletrade.strategies.service import StrategyService
from ruletrade.strategy.v1.fixtures import filter_screening_strategy
from scripts.run_candidate_comparison_lean_e2e import acceptance_database
from scripts.run_real_market_data_smoke import (
    DEFAULT_VISIBLE_OBSERVATIONS,
    WARMUP_OBSERVATIONS,
    _covered_period,
    _one_symbol_strategy,
)


class RecordingRunner:
    def __init__(self) -> None:
        self.calls = 0

    def run(self, _source: str, *, dataset_id: str) -> LeanRunArtifact:
        self.calls += 1
        assert dataset_id == "us-equity-daily-local"
        return LeanRunArtifact(
            log_text=(
                "Backtest completed\n"
                "RULETRADE_EVIDENCE_V1|sequence=1|session=2024-01-02|"
                "phase=portfolio_execution|kind=final_targets|"
                "rebalance_component=rebalance|selected=QQQ|targets=QQQ%3D1"
            ),
            result_payload={
                "statistics": {
                    "Start Equity": "100000",
                    "End Equity": "100000",
                    "Net Profit": "0%",
                    "Total Orders": "0",
                    "Total Fees": "$0",
                },
                "charts": {
                    "Strategy Equity": {
                        "series": {
                            "Equity": {
                                "values": [[1704067200, 100000, 100000, 100000, 100000]]
                            }
                        }
                    }
                },
            },
        )


def _write_symbol(root: Path, symbol: str, dates: list[date], *, security_master=True) -> None:
    daily = root / "equity" / "usa" / "daily"
    maps = root / "equity" / "usa" / "map_files"
    factors = root / "equity" / "usa" / "factor_files"
    daily.mkdir(parents=True, exist_ok=True)
    maps.mkdir(parents=True, exist_ok=True)
    factors.mkdir(parents=True, exist_ok=True)
    name = symbol.lower()
    rows = "\n".join(f"{item:%Y%m%d} 00:00,10000,10000,10000,10000,1" for item in dates)
    with ZipFile(daily / f"{name}.zip", "w", ZIP_DEFLATED) as archive:
        archive.writestr(f"{name}.csv", rows + "\n")
    if security_master:
        (maps / f"{name}.csv").write_text(f"19980102,{name}\n20501231,{name}\n")
        (factors / f"{name}.csv").write_text("19980102,1,1,1\n20501231,1,1,0\n")


def _dates(start: date, end: date) -> list[date]:
    result = []
    cursor = start
    while cursor <= end:
        if cursor.weekday() < 5:
            result.append(cursor)
        cursor += timedelta(days=1)
    return result


def _config() -> BacktestConfig:
    return BacktestConfig(
        start_date="2024-01-02",
        end_date="2024-03-01",
        dataset_id="us-equity-daily-local",
    )


def _complete_cache(root: Path, *, start=date(2023, 1, 2)) -> None:
    all_dates = _dates(start, date(2024, 3, 1))
    for symbol in ("IEF", "QQQ", "SCHG", "SOXX", "TLT", "VGT"):
        _write_symbol(root, symbol, all_dates)


def test_diagnostic_runs_from_a_fresh_python_process(tmp_path: Path) -> None:
    dates = _dates(date(2023, 1, 2), date(2024, 3, 1))
    _write_symbol(tmp_path, "QQQ", dates)
    repository_root = Path(__file__).parents[1]
    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(repository_root / "src")
    environment["RULETRADE_LEAN_DATA_DIR"] = str(tmp_path)

    completed = subprocess.run(
        [
            sys.executable,
            str(repository_root / "scripts" / "inspect_market_data.py"),
            "QQQ",
        ],
        cwd=repository_root,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    assert "SYMBOL  DAILY  MAP  FACTOR  COVERAGE" in completed.stdout
    assert "QQQ     yes    yes  yes" in completed.stdout
    assert "2023-01-02..2024-03-01" in completed.stdout
    assert completed.stdout.rstrip().endswith("available")


def test_requirement_reuses_compiler_history_and_accounts_for_warmup() -> None:
    requirement = MarketDataService().derive_requirement(filter_screening_strategy(), _config())

    assert [item.symbol for item in requirement.symbols] == ["QQQ", "SCHG", "SOXX", "VGT"]
    warmups = {item.symbol: item.warmup_observations for item in requirement.symbols}
    assert warmups == {
        "QQQ": 126,
        "SCHG": 126,
        "SOXX": 126,
        "VGT": 126,
    }
    assert requirement.normalization_mode == "adjusted"


def test_local_preflight_reports_available_coverage_and_cache_hit(tmp_path: Path) -> None:
    _complete_cache(tmp_path)

    result = MarketDataService(tmp_path).preflight(filter_screening_strategy(), _config())

    assert result.overall == "available"
    assert result.cache_hit is True
    assert all(item.status == "available" for item in result.symbols)
    assert all(item.warmup_observations_available >= 126 for item in result.symbols)


def test_local_cache_inspection_reports_daily_and_security_master_independently(
    tmp_path: Path,
) -> None:
    dates = _dates(date(2023, 1, 2), date(2024, 3, 1))
    _write_symbol(tmp_path, "QQQ", dates)
    _write_symbol(tmp_path, "SCHG", dates, security_master=False)
    maps = tmp_path / "equity" / "usa" / "map_files"
    factors = tmp_path / "equity" / "usa" / "factor_files"
    maps.mkdir(parents=True, exist_ok=True)
    factors.mkdir(parents=True, exist_ok=True)
    (maps / "spy.csv").write_text("19980102,spy\n")
    (factors / "spy.csv").write_text("19980102,1,1,1\n")

    result = MarketDataService(tmp_path).inspect_local_cache(["QQQ", "SCHG", "SPY"])
    symbols = {item.symbol: item for item in result.symbols}

    assert result.provider_id == "lean-local-data"
    assert (
        symbols["QQQ"].daily_present,
        symbols["QQQ"].map_present,
        symbols["QQQ"].factor_present,
        symbols["QQQ"].reason,
    ) == (True, True, True, "available")
    assert symbols["SCHG"].reason == "security_master_missing"
    assert symbols["SCHG"].available_from == dates[0]
    assert (
        symbols["SPY"].daily_present,
        symbols["SPY"].map_present,
        symbols["SPY"].factor_present,
        symbols["SPY"].reason,
    ) == (False, True, True, "no_data")


def test_local_cache_inspection_reports_nonexistent_root_as_provider_unavailable() -> None:
    result = MarketDataService(Path("/does/not/exist")).inspect_local_cache(
        ["QQQ", "SCHG", "SOXX", "VGT"]
    )

    assert result.data_root_available is False
    assert {item.reason for item in result.symbols} == {"provider_unavailable"}


def test_preflight_distinguishes_missing_symbol_from_evaluated_data(tmp_path: Path) -> None:
    _complete_cache(tmp_path)
    (tmp_path / "equity" / "usa" / "daily" / "vgt.zip").unlink()

    result = MarketDataService(tmp_path).preflight(filter_screening_strategy(), _config())

    assert result.overall == "partial"
    vgt = next(item for item in result.symbols if item.symbol == "VGT")
    assert (vgt.status, vgt.reason) == ("unavailable", "no_data")
    assert result.cache_hit is False


def test_preflight_rejects_insufficient_warmup_and_missing_security_master(tmp_path: Path) -> None:
    _complete_cache(tmp_path)
    short_dates = _dates(date(2023, 12, 1), date(2024, 3, 1))
    _write_symbol(tmp_path, "QQQ", short_dates)
    (tmp_path / "equity" / "usa" / "factor_files" / "vgt.csv").unlink()

    result = MarketDataService(tmp_path).preflight(filter_screening_strategy(), _config())

    outcomes = {item.symbol: item.reason for item in result.symbols}
    assert outcomes["QQQ"] == "insufficient_history"
    assert outcomes["VGT"] == "security_master_missing"


def test_preflight_rejects_partial_requested_range_and_corrupt_cache(tmp_path: Path) -> None:
    _complete_cache(tmp_path)
    _write_symbol(tmp_path, "QQQ", _dates(date(2023, 1, 2), date(2024, 2, 1)))
    (tmp_path / "equity" / "usa" / "daily" / "vgt.zip").write_bytes(b"not-a-zip")

    result = MarketDataService(tmp_path).preflight(filter_screening_strategy(), _config())
    outcomes = {item.symbol: item.reason for item in result.symbols}

    assert outcomes["QQQ"] == "requested_period_unavailable"
    assert outcomes["VGT"] == "corrupt_cache"


def test_single_symbol_smoke_strategy_uses_real_warmup_and_covered_default_period(
    tmp_path: Path,
) -> None:
    dates = _dates(date(2023, 1, 2), date(2024, 3, 1))
    _write_symbol(tmp_path, "QQQ", dates)
    service = MarketDataService(tmp_path)
    start, end = _covered_period(service, "QQQ", None, None)
    strategy = _one_symbol_strategy("QQQ")
    config = BacktestConfig(
        dataset_id="us-equity-daily-local", start_date=start, end_date=end
    )

    assert start == dates[-DEFAULT_VISIBLE_OBSERVATIONS]
    assert end == dates[-1]
    requirement = service.derive_requirement(strategy, config)
    assert requirement.symbols[0].warmup_observations == WARMUP_OBSERVATIONS
    assert service.preflight(strategy, config).overall == "available"
    source = generate_csharp(
        compile_strategy_to_lean_plan(strategy),
        CSharpGenerationSettings(start_date=start, end_date=end),
    )
    assert (
        'AddEquity("QQQ", Resolution.Daily, '
        "dataNormalizationMode: DataNormalizationMode.Adjusted)"
    ) in source
    assert source.count("AddEquity(") == 1
    assert "SetWarmUp(21, Resolution.Daily)" in source
    assert "window[0] / window[21] - 1m" in source


def test_acceptance_owned_database_is_fresh_and_rerunnable(tmp_path: Path) -> None:
    workspace = tmp_path / "acceptance"
    observed: list[Path] = []
    for _ in range(2):
        with acceptance_database(None, workspace=workspace) as database:
            observed.append(database)
            database.touch()
            assert database.exists()
        assert not database.exists()

    assert observed[0] != observed[1]


def test_explicit_acceptance_database_is_never_removed(tmp_path: Path) -> None:
    database = tmp_path / "caller-owned" / "ruletrade.sqlite3"
    with acceptance_database(database) as selected:
        selected.touch()
    assert database.exists()
    with (
        pytest.raises(FileExistsError, match="already exists"),
        acceptance_database(database),
    ):
        pass


def test_real_data_execution_is_blocked_before_runner_when_cache_is_unavailable() -> None:
    runner = RecordingRunner()
    service = BacktestService(runner, MarketDataService(Path("/does/not/exist")))

    with pytest.raises(MarketDataUnavailableError, match="provider_unavailable"):
        service.execute(LeanBacktestRequest(strategy=filter_screening_strategy(), config=_config()))
    assert runner.calls == 0


def test_ready_data_runs_official_pipeline_and_records_diagnostics(tmp_path: Path) -> None:
    _complete_cache(tmp_path)
    runner = RecordingRunner()
    service = BacktestService(runner, MarketDataService(tmp_path))

    response = service.execute(
        LeanBacktestRequest(strategy=filter_screening_strategy(), config=_config())
    )

    assert runner.calls == 1
    assert response.timings.data_preflight_ms >= 0
    assert response.timings.data_acquisition_ms == 0
    assert response.diagnostics.market_data_cache_hit is True
    assert response.diagnostics.required_symbols == 4
    assert response.diagnostics.unavailable_symbols == 0


def test_repeated_preflight_is_idempotent_and_does_not_change_cache(tmp_path: Path) -> None:
    _complete_cache(tmp_path)
    service = MarketDataService(tmp_path)
    before = sorted(
        (path.relative_to(tmp_path), path.stat().st_mtime_ns)
        for path in tmp_path.rglob("*")
    )

    first = service.preflight(filter_screening_strategy(), _config())
    second = service.preflight(filter_screening_strategy(), _config())
    after = sorted(
        (path.relative_to(tmp_path), path.stat().st_mtime_ns)
        for path in tmp_path.rglob("*")
    )

    assert first.model_copy(update={"elapsed_ms": 0}) == second.model_copy(update={"elapsed_ms": 0})
    assert before == after


def test_real_data_run_persists_truthful_provenance_and_reopens(tmp_path: Path) -> None:
    cache = tmp_path / "lean-data"
    _complete_cache(cache)
    database = tmp_path / "ruletrade.sqlite3"
    strategies = StrategyService(SQLiteStrategyRepository(database))
    runner = RecordingRunner()
    runs = BacktestRunService(
        SQLiteBacktestRunRepository(database),
        strategies,
        BacktestService(runner, MarketDataService(cache)),
    )
    revision = strategies.create_strategy(
        "Real data", filter_screening_strategy()
    ).current_revision

    run = runs.create_and_execute(revision.id, _config())

    assert run.status.value == "succeeded"
    assert run.provenance.market_data_provider_id == "lean-local-data"
    assert run.provenance.market_data_source_kind == "local_lean_data"
    assert run.provenance.data_normalization_mode == "adjusted"
    assert run.provenance.requested_symbols == ("QQQ", "SCHG", "SOXX", "VGT")
    assert run.provenance.dataset_version is None
    assert run.diagnostics.market_data_cache_hit is True

    reopened = BacktestRunService(
        SQLiteBacktestRunRepository(database),
        StrategyService(SQLiteStrategyRepository(database)),
        BacktestService(RecordingRunner(), MarketDataService(cache)),
    )
    assert reopened.get_run(run.id) == run


def test_fixture_preflight_remains_available_without_real_data_configuration() -> None:
    config = BacktestConfig(dataset_id="filter-synthetic")
    result = MarketDataService(Path("/does/not/exist")).preflight(
        filter_screening_strategy(), config
    )

    assert result.source_kind == "synthetic_fixture"
    assert result.overall == "available"
