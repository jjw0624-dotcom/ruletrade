from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from ruletrade.api import app, get_lean_backtest_service
from ruletrade.backtest_runs.errors import InvalidRunConfigError
from ruletrade.backtest_runs.service import BacktestRunService
from ruletrade.backtests.errors import LeanExecutionError
from ruletrade.backtests.lean_runner import LeanRunArtifact, LeanRunnerTimings
from ruletrade.backtests.models import BacktestConfig
from ruletrade.backtests.service import BacktestService
from ruletrade.persistence import SQLiteBacktestRunRepository, SQLiteStrategyRepository
from ruletrade.strategies.errors import RevisionNotFoundError
from ruletrade.strategies.service import StrategyService
from ruletrade.strategy.v1.fixtures import golden_portfolio_strategy


def _lean_payload() -> dict[str, Any]:
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
                "series": {
                    "Equity": {
                        "values": [
                            [1704153600, 100000, 100000, 100000, 100000],
                            [1735603200, 133448.49, 133448.49, 133448.49, 133448.49],
                        ]
                    }
                }
            }
        },
    }


@dataclass
class FakeRunner:
    image: str = "quantconnect/lean:test"
    error: Exception | None = None
    calls: list[tuple[str, str]] = field(default_factory=list)

    def run(self, generated_csharp: str, *, dataset_id: str) -> LeanRunArtifact:
        self.calls.append((generated_csharp, dataset_id))
        if self.error is not None:
            raise self.error
        return LeanRunArtifact(
            log_text="Backtest completed",
            result_payload=_lean_payload(),
            timings=LeanRunnerTimings(
                csharp_compile_ms=11,
                lean_execution_ms=22,
                result_load_ms=3,
            ),
        )


def _services(
    database: Path,
    runner: FakeRunner | None = None,
) -> tuple[StrategyService, BacktestRunService]:
    strategies = StrategyService(SQLiteStrategyRepository(database))
    runs = BacktestRunService(
        SQLiteBacktestRunRepository(database),
        strategies,
        BacktestService(runner or FakeRunner()),
        build_commit="0123456789abcdef",
    )
    return strategies, runs


def test_successful_run_persists_config_result_provenance_timings_and_reopens(
    tmp_path: Path,
) -> None:
    database = tmp_path / "ruletrade.sqlite3"
    strategies, service = _services(database)
    revision = strategies.create_strategy(
        "Golden", golden_portfolio_strategy()
    ).current_revision
    config = BacktestConfig(
        start_date="2024-01-02",
        end_date="2024-02-29",
        initial_cash="250000",
        dataset_id="golden-synthetic",
    )

    run = service.create_and_execute(revision.id, config)

    assert run.status.value == "succeeded"
    assert run.revision_id == revision.id
    assert run.run_config == config
    assert run.result is not None
    assert run.result.final_value == 133448.49
    assert run.error is None
    assert run.started_at is not None and run.completed_at is not None
    assert run.provenance.source_hash == revision.source_hash
    assert run.provenance.strategy_schema_version == revision.schema_version
    assert run.provenance.application_version == "0.1.0"
    assert run.provenance.build_commit == "0123456789abcdef"
    assert run.provenance.backend_id == "lean"
    assert run.provenance.engine_image == "quantconnect/lean:test"
    assert run.provenance.dataset_id == "golden-synthetic"
    assert run.provenance.dataset_version is None
    assert run.timings.csharp_compile_ms == 11
    assert run.timings.lean_execution_ms == 22
    assert run.timings.result_load_ms == 3
    assert all(value >= 0 for value in run.timings.model_dump().values())

    reopened_runner = FakeRunner()
    _strategies, reopened = _services(database, reopened_runner)
    assert reopened.get_run(run.id) == run
    assert reopened.list_runs(revision.id) == (run,)
    assert reopened_runner.calls == []


def test_same_revision_and_config_create_distinct_runs(tmp_path: Path) -> None:
    strategies, service = _services(tmp_path / "ruletrade.sqlite3")
    revision = strategies.create_strategy(
        "Golden", golden_portfolio_strategy()
    ).current_revision

    first = service.create_and_execute(revision.id, BacktestConfig())
    second = service.create_and_execute(revision.id, BacktestConfig())

    assert first.id != second.id
    assert len(service.list_runs(revision.id)) == 2


def test_invalid_revision_and_config_create_no_run(tmp_path: Path) -> None:
    _strategies, service = _services(tmp_path / "ruletrade.sqlite3")

    with pytest.raises(RevisionNotFoundError):
        service.create_and_execute("missing", BacktestConfig())
    with pytest.raises(InvalidRunConfigError):
        service.create_and_execute(
            "missing",
            {"start_date": "2024-03-01", "end_date": "2024-02-01"},
        )

    with sqlite3.connect(service.repository.path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM backtest_runs").fetchone()[0] == 0


def test_execution_failure_is_persisted_without_result_or_diagnostics(tmp_path: Path) -> None:
    runner = FakeRunner(
        error=LeanExecutionError(
            "LEAN process failed (build).",
            diagnostic_output="Main.cs: secret internal path",
        )
    )
    strategies, service = _services(tmp_path / "ruletrade.sqlite3", runner)
    revision = strategies.create_strategy(
        "Golden", golden_portfolio_strategy()
    ).current_revision

    run = service.create_and_execute(revision.id, BacktestConfig())

    assert run.status.value == "failed"
    assert run.result is None
    assert run.error is not None
    assert run.error.model_dump() == {
        "code": "execution_failure",
        "message": "Backtest execution failed.",
    }
    assert "secret" not in run.model_dump_json()
    assert service.get_run(run.id) == run


def test_archived_strategy_preserves_historical_run(tmp_path: Path) -> None:
    strategies, service = _services(tmp_path / "ruletrade.sqlite3")
    detail = strategies.create_strategy("Golden", golden_portfolio_strategy())
    run = service.create_and_execute(detail.current_revision.id, BacktestConfig())

    strategies.archive_strategy(detail.strategy.id)

    assert service.get_run(run.id) == run
    assert service.list_runs(detail.current_revision.id) == (run,)


def test_database_enforces_run_input_immutability_and_lifecycle(tmp_path: Path) -> None:
    database = tmp_path / "ruletrade.sqlite3"
    strategies, service = _services(database)
    revision = strategies.create_strategy(
        "Golden", golden_portfolio_strategy()
    ).current_revision
    run = service.create_and_execute(revision.id, BacktestConfig())

    with sqlite3.connect(database) as connection:
        with pytest.raises(sqlite3.IntegrityError, match="inputs are immutable"):
            connection.execute(
                "UPDATE backtest_runs SET config_json = '{}' WHERE id = ?", (run.id,)
            )
        with pytest.raises(sqlite3.IntegrityError, match="lifecycle"):
            connection.execute(
                "UPDATE backtest_runs SET status = 'running' WHERE id = ?", (run.id,)
            )
        with pytest.raises(sqlite3.IntegrityError, match="historical artifacts"):
            connection.execute("DELETE FROM backtest_runs WHERE id = ?", (run.id,))


def test_schema_v1_database_migrates_to_v2(tmp_path: Path) -> None:
    database = tmp_path / "ruletrade.sqlite3"
    strategies = StrategyService(SQLiteStrategyRepository(database))
    revision = strategies.create_strategy(
        "Before migration", golden_portfolio_strategy()
    ).current_revision
    with sqlite3.connect(database) as connection:
        connection.execute("DROP TRIGGER backtest_runs_no_delete")
        connection.execute("DROP TRIGGER backtest_runs_lifecycle")
        connection.execute("DROP TRIGGER backtest_runs_immutable_identity")
        connection.execute("DROP TABLE backtest_runs")
        connection.execute("PRAGMA user_version = 1")
    reopened = StrategyService(SQLiteStrategyRepository(database))
    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 2
        assert connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'backtest_runs'"
        ).fetchone() == ("backtest_runs",)
    assert reopened.get_revision_by_id(revision.id) == revision


def test_persisted_run_api_create_list_read_and_invalid_contracts(tmp_path: Path) -> None:
    strategies, service = _services(tmp_path / "ruletrade.sqlite3")
    revision = strategies.create_strategy(
        "Golden", golden_portfolio_strategy()
    ).current_revision
    app.dependency_overrides[get_lean_backtest_service] = lambda: service
    try:
        with TestClient(app) as client:
            created = client.post(
                f"/v1/revisions/{revision.id}/backtest-runs",
                json={"config": {"dataset_id": "golden-synthetic"}},
            )
            assert created.status_code == 201
            run = created.json()
            assert run["revision_id"] == revision.id
            assert run["status"] == "succeeded"
            assert client.get(f"/v1/backtest-runs/{run['id']}").json() == run
            listed = client.get(f"/v1/revisions/{revision.id}/backtest-runs")
            assert listed.json() == {"items": [run]}

            invalid = client.post(
                f"/v1/revisions/{revision.id}/backtest-runs",
                json={"config": {"initial_cash": "0"}},
            )
            assert invalid.status_code == 422
            assert invalid.json()["detail"]["code"] == "invalid_run_config"
            missing_revision = client.post(
                "/v1/revisions/missing/backtest-runs", json={"config": {}}
            )
            assert missing_revision.status_code == 404
            assert missing_revision.json()["detail"]["code"] == "revision_not_found"
            missing_run = client.get("/v1/backtest-runs/missing")
            assert missing_run.status_code == 404
            assert missing_run.json()["detail"]["code"] == "run_not_found"
    finally:
        app.dependency_overrides.clear()


def test_compatibility_endpoint_delegates_to_run_service(tmp_path: Path) -> None:
    _strategies, service = _services(tmp_path / "ruletrade.sqlite3")
    app.dependency_overrides[get_lean_backtest_service] = lambda: service
    try:
        with TestClient(app) as client:
            response = client.post(
                "/v1/backtests/lean",
                json={
                    "strategy": golden_portfolio_strategy().model_dump(mode="json"),
                    "config": {"dataset_id": "golden-synthetic"},
                },
            )
        assert response.status_code == 200
        assert response.json()["result"]["total_orders"] == 51
        with sqlite3.connect(service.repository.path) as connection:
            assert connection.execute("SELECT COUNT(*) FROM backtest_runs").fetchone()[0] == 0
    finally:
        app.dependency_overrides.clear()
