from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from ruletrade.api import app, get_research_experiment_service
from ruletrade.backtest_runs.service import BacktestRunService
from ruletrade.backtests.lean_runner import LeanRunArtifact, LeanRunnerTimings
from ruletrade.backtests.service import BacktestService
from ruletrade.experiments.errors import InvalidExperimentSpecError
from ruletrade.experiments.models import CreateDetailExperimentRequest, CreateHiddenExperimentRequest
from ruletrade.experiments.service import ResearchExperimentService
from ruletrade.persistence.sqlite_backtest_runs import SQLiteBacktestRunRepository
from ruletrade.persistence.sqlite_experiments import SQLiteResearchExperimentRepository
from ruletrade.persistence.sqlite_strategies import SQLiteStrategyRepository
from ruletrade.strategies.service import StrategyService
from ruletrade.strategy.v2.catalog import SingleAssetCatalogRequest, create_catalog_strategy


def _lean_payload() -> dict[str, Any]:
    return {
        "statistics": {
            "Start Equity": "100000", "End Equity": "110000", "Net Profit": "10%",
            "Total Orders": "1", "Total Fees": "$1",
        },
        "charts": {"Strategy Equity": {"series": {"Equity": {"values": [
            [1704153600, 100000, 100000, 100000, 100000],
            [1706745600, 110000, 110000, 110000, 110000],
        ]}}}},
    }


@dataclass
class FakeRunner:
    evidence_component: str
    image: str = "quantconnect/lean:test"
    calls: int = 0

    def run(self, generated_csharp: str, *, dataset_id: str) -> LeanRunArtifact:
        self.calls += 1
        return LeanRunArtifact(
            log_text=(
                "RULETRADE_EVIDENCE_V1|sequence=1|session=2024-01-02|"
                "phase=portfolio_execution|kind=final_targets|"
                f"rebalance_component={self.evidence_component}|selected=QQQ|targets=QQQ%3D1"
            ),
            result_payload=_lean_payload(),
            timings=LeanRunnerTimings(csharp_compile_ms=1, lean_execution_ms=1, result_load_ms=1),
        )


def _setup(database: Path):
    strategies = StrategyService(SQLiteStrategyRepository(database))
    base_request = SingleAssetCatalogRequest(
        catalog_id="single_asset_periodic", name="QQQ monthly", asset="QQQ", timeframe="monthly"
    )
    created = create_catalog_strategy(base_request)
    revision = strategies.create_strategy("QQQ monthly", created.strategy).current_revision
    assert created.strategy.program is not None
    runner = FakeRunner(created.strategy.program.statements[0].semantic_id)
    runs = BacktestRunService(
        SQLiteBacktestRunRepository(database), strategies, BacktestService(runner), build_commit="test"
    )
    experiments = ResearchExperimentService(
        SQLiteResearchExperimentRepository(database), strategies, runs,
        id_factory=iter(["experiment-1", "candidate-1", "candidate-2"]).__next__,
    )
    return base_request, revision, runner, experiments


def _request(base: SingleAssetCatalogRequest) -> CreateDetailExperimentRequest:
    return CreateDetailExperimentRequest.model_validate({
        "name": "Asset sweep",
        "base": base.model_dump(mode="json"),
        "dimensions": [{"parameter_id": "asset", "values": ["QQQ", "SPY"]}],
        "config": {
            "start_date": "2024-01-02", "end_date": "2024-02-01",
            "initial_cash": "100000", "dataset_id": "filter-synthetic",
        },
    })


def test_detail_experiment_plans_variants_and_reuses_official_runs(tmp_path: Path) -> None:
    base, revision, runner, service = _setup(tmp_path / "ruletrade.sqlite3")

    execution = service.create_detail(revision.id, _request(base))

    assert execution.experiment.kind.value == "detail"
    assert [item.parameters for item in execution.experiment.candidates] == [
        {"asset": "QQQ"}, {"asset": "SPY"}
    ]
    assert len(execution.runs) == 2
    assert runner.calls == 2
    assert all(run.revision_id == revision.id and run.status.value == "succeeded" for run in execution.runs)
    assert [item.run_id for item in execution.experiment.candidates] == [run.id for run in execution.runs]
    assert service.get(execution.experiment.id) == execution.experiment
    assert service.list_for_revision(revision.id) == (execution.experiment,)


def test_detail_experiment_rejects_base_that_is_not_selected_revision(tmp_path: Path) -> None:
    base, revision, _runner, service = _setup(tmp_path / "ruletrade.sqlite3")
    mismatched = _request(base).model_copy(update={
        "base": base.model_copy(update={"asset": "SPY"})
    })

    with pytest.raises(InvalidExperimentSpecError, match="do not reproduce"):
        service.create_detail(revision.id, mismatched)

    assert service.list_for_revision(revision.id) == ()


def test_detail_experiment_api_create_list_and_read(tmp_path: Path) -> None:
    base, revision, _runner, service = _setup(tmp_path / "ruletrade.sqlite3")
    app.dependency_overrides[get_research_experiment_service] = lambda: service
    try:
        with TestClient(app) as client:
            created = client.post(
                f"/v2/revisions/{revision.id}/research-experiments/detail",
                json=_request(base).model_dump(mode="json"),
            )
            listed = client.get(f"/v2/revisions/{revision.id}/research-experiments")
            read = client.get("/v2/research-experiments/experiment-1")
    finally:
        app.dependency_overrides.clear()

    assert created.status_code == 201
    assert len(created.json()["runs"]) == 2
    assert [item["parameters"] for item in created.json()["experiment"]["candidates"]] == [
        {"asset": "QQQ"}, {"asset": "SPY"}
    ]
    assert listed.status_code == 200 and len(listed.json()["items"]) == 1
    assert read.status_code == 200 and read.json()["id"] == "experiment-1"


def test_hidden_experiment_uses_server_policy_and_unchanged_revision(tmp_path: Path) -> None:
    _base, revision, runner, service = _setup(tmp_path / "ruletrade.sqlite3")

    execution = service.create_hidden(
        revision.id,
        CreateHiddenExperimentRequest(name="Chronological holdout", policy_id="synthetic-holdout-v1"),
    )

    assert execution.experiment.kind.value == "hidden"
    assert execution.experiment.spec == {"policy_id": "synthetic-holdout-v1"}
    assert [item.parameters for item in execution.experiment.candidates] == [
        {"partition": "calibration"}, {"partition": "hidden"}
    ]
    assert all(
        item.source_hash == revision.source_hash
        and item.canonical_strategy == revision.canonical_strategy
        for item in execution.experiment.candidates
    )
    assert execution.calibration_run.run_config.start_date.isoformat() == "2024-01-02"
    assert execution.calibration_run.run_config.end_date.isoformat() == "2024-06-28"
    assert execution.hidden_run.run_config.start_date.isoformat() == "2024-07-01"
    assert execution.hidden_run.run_config.end_date.isoformat() == "2024-12-31"
    assert execution.calibration_run.run_config.dataset_id == "filter-synthetic"
    assert execution.hidden_run.run_config.dataset_id == "filter-synthetic"
    assert execution.generalization_gap == 0
    assert runner.calls == 2
    assert [item.run_id for item in execution.experiment.candidates] == [
        execution.calibration_run.id, execution.hidden_run.id
    ]


def test_hidden_experiment_api_lists_policy_and_rejects_client_overrides(tmp_path: Path) -> None:
    _base, revision, _runner, service = _setup(tmp_path / "ruletrade.sqlite3")
    app.dependency_overrides[get_research_experiment_service] = lambda: service
    try:
        with TestClient(app) as client:
            policies = client.get("/v2/research-experiments/hidden-policies")
            rejected = client.post(
                f"/v2/revisions/{revision.id}/research-experiments/hidden",
                json={
                    "name": "Tampered holdout",
                    "policy_id": "synthetic-holdout-v1",
                    "start_date": "2020-01-01",
                },
            )
            created = client.post(
                f"/v2/revisions/{revision.id}/research-experiments/hidden",
                json={"name": "Chronological holdout", "policy_id": "synthetic-holdout-v1"},
            )
    finally:
        app.dependency_overrides.clear()

    assert policies.status_code == 200
    assert policies.json()["items"][0]["id"] == "synthetic-holdout-v1"
    assert rejected.status_code == 422
    assert created.status_code == 201
    assert created.json()["experiment"]["kind"] == "hidden"
    assert created.json()["calibration_run"]["revision_id"] == revision.id
    assert created.json()["hidden_run"]["revision_id"] == revision.id


def test_hidden_experiment_rejects_unknown_server_policy(tmp_path: Path) -> None:
    _base, revision, _runner, service = _setup(tmp_path / "ruletrade.sqlite3")

    with pytest.raises(InvalidExperimentSpecError, match="Unknown Hidden BT policy"):
        service.create_hidden(
            revision.id,
            CreateHiddenExperimentRequest(name="Unknown", policy_id="client-defined"),
        )

    assert service.list_for_revision(revision.id) == ()
