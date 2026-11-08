"""Exercise saved V2 Revision -> Docker LEAN -> persisted API artifacts."""

from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

from ruletrade.api import app, get_lean_backtest_service
from ruletrade.backtest_runs.service import BacktestRunService
from ruletrade.backtests.lean_runner import DockerLeanRunner
from ruletrade.backtests.service import BacktestService
from ruletrade.hashing import strategy_hash
from ruletrade.market_data.service import MarketDataService
from ruletrade.persistence import SQLiteBacktestRunRepository, SQLiteStrategyRepository
from ruletrade.strategies.service import StrategyService
from ruletrade.strategy.v2.execution_profiles import (
    blocky_group_execution_profile,
    production_execution_profile,
)


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="ruletrade-v2-api-") as temporary:
        database = Path(temporary) / "ruletrade.sqlite3"
        strategies = StrategyService(SQLiteStrategyRepository(database))
        runs = BacktestRunService(
            SQLiteBacktestRunRepository(database),
            strategies,
            BacktestService(DockerLeanRunner(), MarketDataService()),
        )
        strategy = production_execution_profile("direct")
        revision = strategies.create_strategy("Persisted V2 Docker proof", strategy).current_revision
        app.dependency_overrides[get_lean_backtest_service] = lambda: runs
        try:
            with TestClient(app) as client:
                created_response = client.post(
                    f"/v2/revisions/{revision.id}/backtest-runs",
                    json={"config": {"dataset_id": "golden-synthetic"}},
                )
                created_response.raise_for_status()
                created = created_response.json()
                if created["status"] != "succeeded":
                    raise RuntimeError(f"saved V2 Run failed: {created.get('error')}")
                if created["provenance"]["source_hash"] != strategy_hash(strategy):
                    raise RuntimeError("persisted Run did not retain the V2 semantic hash")
                if created["provenance"]["strategy_schema_version"] != strategy.api_version:
                    raise RuntimeError("persisted Run did not retain the V2 schema version")
                if created["provenance"]["market_data_provider_id"] != "ruletrade-fixture":
                    raise RuntimeError("persisted Run did not retain fixture data provenance")

                run_id = created["id"]
                reopened = client.get(f"/v2/backtest-runs/{run_id}")
                reopened.raise_for_status()
                if reopened.json() != created:
                    raise RuntimeError("reopened V2 Run differs from the created artifact")

                evidence_response = client.get(
                    f"/v2/backtest-runs/{run_id}/decision-events"
                )
                evidence_response.raise_for_status()
                evidence = evidence_response.json()["items"]
                if not evidence:
                    raise RuntimeError("saved V2 Run has no Decision Evidence")
                detail_response = client.get(
                    f"/v2/backtest-runs/{run_id}/decision-events/{evidence[0]['id']}"
                )
                detail_response.raise_for_status()
                source_ids = {
                    item["component_id"]
                    for item in detail_response.json()["source_components"]
                }
                if "single-asset-allocation" not in source_ids:
                    raise RuntimeError("Decision Evidence lost V2 plan provenance")

                blocky_strategy = blocky_group_execution_profile()
                blocky_revision = strategies.create_strategy(
                    "Blocky Group persisted proof", blocky_strategy
                ).current_revision
                blocky_response = client.post(
                    f"/v2/revisions/{blocky_revision.id}/backtest-runs",
                    json={"config": {
                        "dataset_id": "golden-synthetic",
                        "start_date": "2024-01-01",
                        "end_date": "2024-02-29",
                        "initial_cash": "100000",
                    }},
                )
                blocky_response.raise_for_status()
                blocky_run = blocky_response.json()
                if blocky_run["status"] != "succeeded":
                    raise RuntimeError(
                        f"native Blocky Group Run failed: {blocky_run.get('error')}"
                    )
                blocky_evidence_response = client.get(
                    f"/v2/backtest-runs/{blocky_run['id']}/decision-events"
                )
                blocky_evidence_response.raise_for_status()
                blocky_evidence = blocky_evidence_response.json()["items"]
                if not blocky_evidence:
                    raise RuntimeError("native Blocky Group Run has no Decision Evidence")
                blocky_detail = client.get(
                    f"/v2/backtest-runs/{blocky_run['id']}/decision-events/{blocky_evidence[0]['id']}"
                )
                blocky_detail.raise_for_status()
                blocky_source_ids = {
                    item["component_id"]
                    for item in blocky_detail.json()["source_components"]
                }
                if "blocky-investment-draft-start" not in blocky_source_ids:
                    raise RuntimeError(
                        "native Blocky Group Run lost allocation provenance"
                    )
        finally:
            app.dependency_overrides.clear()

    print("persisted V2 API Docker journey passed")


if __name__ == "__main__":
    main()
