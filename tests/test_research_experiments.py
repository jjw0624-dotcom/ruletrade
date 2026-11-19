from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from ruletrade.api import app, get_research_experiment_service
from ruletrade.backtest_runs.service import BacktestRunService
from ruletrade.backtests.lean_runner import LeanRunArtifact, LeanRunnerTimings
from ruletrade.backtests.service import BacktestService
from ruletrade.experiments.errors import InvalidExperimentSpecError
from ruletrade.experiments.models import (
    CreateDetailExperimentRequest,
    CreateHiddenExperimentRequest,
    CreateForwardExperimentRequest,
    CreateRandomBaselineExperimentRequest,
    CreateRobustnessExperimentRequest,
)
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


def _detail_request() -> CreateDetailExperimentRequest:
    return CreateDetailExperimentRequest.model_validate({
        "name": "Detailed run",
        "config": {
            "start_date": "2024-01-02", "end_date": "2024-02-01",
            "initial_cash": "100000", "dataset_id": "filter-synthetic",
        },
    })


def _hidden_request(base: SingleAssetCatalogRequest) -> CreateHiddenExperimentRequest:
    return CreateHiddenExperimentRequest.model_validate({
        "name": "Hidden asset selection",
        "policy_id": "synthetic-holdout-v1",
        "base": base.model_dump(mode="json"),
        "dimensions": [{"parameter_id": "asset", "values": ["QQQ", "SPY"]}],
    })


def test_detail_experiment_runs_unchanged_revision_once(tmp_path: Path) -> None:
    _base, revision, runner, service = _setup(tmp_path / "ruletrade.sqlite3")

    execution = service.create_detail(revision.id, _detail_request())

    assert execution.experiment.kind.value == "detail"
    assert execution.experiment.spec["mode"] == "single_revision"
    assert [item.parameters for item in execution.experiment.candidates] == [{"role": "detailed"}]
    assert len(execution.runs) == 1
    assert runner.calls == 1
    assert execution.runs[0].revision_id == revision.id
    assert execution.experiment.candidates[0].source_hash == revision.source_hash
    assert execution.experiment.candidates[0].canonical_strategy == revision.canonical_strategy


def test_detail_experiment_api_create_list_and_read(tmp_path: Path) -> None:
    _base, revision, _runner, service = _setup(tmp_path / "ruletrade.sqlite3")
    app.dependency_overrides[get_research_experiment_service] = lambda: service
    try:
        with TestClient(app) as client:
            created = client.post(
                f"/v2/revisions/{revision.id}/research-experiments/detail",
                json=_detail_request().model_dump(mode="json"),
            )
            listed = client.get(f"/v2/revisions/{revision.id}/research-experiments")
            read = client.get("/v2/research-experiments/experiment-1")
    finally:
        app.dependency_overrides.clear()

    assert created.status_code == 201
    assert len(created.json()["runs"]) == 1
    assert created.json()["experiment"]["candidates"][0]["parameters"] == {"role": "detailed"}
    assert listed.status_code == 200 and len(listed.json()["items"]) == 1
    assert read.status_code == 200 and read.json()["id"] == "experiment-1"


def test_hidden_experiment_selects_on_calibration_then_runs_winner_once(tmp_path: Path) -> None:
    base, revision, runner, service = _setup(tmp_path / "ruletrade.sqlite3")

    execution = service.create_hidden(revision.id, _hidden_request(base))

    assert execution.experiment.kind.value == "hidden"
    assert [item.parameters for item in execution.experiment.candidates] == [
        {"asset": "QQQ"}, {"asset": "SPY"},
    ]
    assert len(execution.calibration_runs) == 2
    assert execution.selected_candidate_ordinal == 1
    assert execution.hidden_run.revision_id == revision.id
    assert execution.hidden_run.run_config.start_date.isoformat() == "2024-07-01"
    assert runner.calls == 3
    assert execution.generalization_gap == 0


def test_hidden_experiment_api_rejects_client_holdout_and_returns_selection(tmp_path: Path) -> None:
    base, revision, _runner, service = _setup(tmp_path / "ruletrade.sqlite3")
    app.dependency_overrides[get_research_experiment_service] = lambda: service
    try:
        with TestClient(app) as client:
            policies = client.get("/v2/research-experiments/hidden-policies")
            payload = _hidden_request(base).model_dump(mode="json")
            rejected = client.post(
                f"/v2/revisions/{revision.id}/research-experiments/hidden",
                json={**payload, "start_date": "2020-01-01"},
            )
            created = client.post(
                f"/v2/revisions/{revision.id}/research-experiments/hidden",
                json=payload,
            )
    finally:
        app.dependency_overrides.clear()

    assert policies.status_code == 200
    assert policies.json()["items"][0]["id"] == "synthetic-holdout-v1"
    assert rejected.status_code == 422
    assert created.status_code == 201
    assert len(created.json()["calibration_runs"]) == 2
    assert created.json()["selected_candidate_ordinal"] == 1
    assert created.json()["hidden_run"]["revision_id"] == revision.id


def test_hidden_experiment_rejects_unknown_server_policy(tmp_path: Path) -> None:
    base, revision, _runner, service = _setup(tmp_path / "ruletrade.sqlite3")

    with pytest.raises(InvalidExperimentSpecError, match="Unknown Hidden BT policy"):
        service.create_hidden(
            revision.id,
            _hidden_request(base).model_copy(update={"policy_id": "client-defined"}),
        )

    assert service.list_for_revision(revision.id) == ()


def test_robustness_experiment_runs_server_owned_start_offsets(tmp_path: Path) -> None:
    _base, revision, runner, service = _setup(tmp_path / "ruletrade.sqlite3")
    service._id_factory = iter([
        "experiment-robust", "candidate-r0", "candidate-r1", "candidate-r3", "candidate-r5"
    ]).__next__

    execution = service.create_robustness(
        revision.id,
        CreateRobustnessExperimentRequest.model_validate({
            "name": "Start sensitivity",
            "policy_id": "start-date-offset-v1",
            "config": {
                "start_date": "2024-01-02", "end_date": "2024-02-01",
                "initial_cash": "100000", "dataset_id": "filter-synthetic",
            },
        }),
    )

    assert execution.experiment.kind.value == "robustness"
    assert [item.parameters for item in execution.experiment.candidates] == [
        {"start_date_offset_days": 0}, {"start_date_offset_days": 1},
        {"start_date_offset_days": 3}, {"start_date_offset_days": 5},
    ]
    assert [run.run_config.start_date.isoformat() for run in execution.runs] == [
        "2024-01-02", "2024-01-03", "2024-01-05", "2024-01-07",
    ]
    assert all(
        item.source_hash == revision.source_hash
        and item.canonical_strategy == revision.canonical_strategy
        for item in execution.experiment.candidates
    )
    assert runner.calls == 4


def test_random_baseline_is_seeded_and_uses_catalog_universe(tmp_path: Path) -> None:
    base, revision, runner, service = _setup(tmp_path / "ruletrade.sqlite3")
    service._id_factory = iter([
        "experiment-random", "candidate-reference", "candidate-seed-7", "candidate-seed-11"
    ]).__next__

    execution = service.create_random_baseline(
        revision.id,
        CreateRandomBaselineExperimentRequest.model_validate({
            "name": "Seeded asset baseline",
            "base": base.model_dump(mode="json"),
            "seeds": [7, 11],
            "config": {
                "start_date": "2024-01-02", "end_date": "2024-02-01",
                "initial_cash": "100000", "dataset_id": "filter-synthetic",
            },
        }),
    )

    assert execution.experiment.kind.value == "random_baseline"
    assert execution.experiment.spec["universe"] == ["QQQ"]
    assert [item.parameters for item in execution.experiment.candidates] == [
        {"baseline_type": "strategy_reference"},
        {"baseline_type": "seeded_random_asset", "seed": 7, "selected_asset": "QQQ"},
        {"baseline_type": "seeded_random_asset", "seed": 11, "selected_asset": "QQQ"},
    ]
    assert all(run.revision_id == revision.id for run in execution.runs)
    assert [item.run_id for item in execution.experiment.candidates] == [
        run.id for run in execution.runs
    ]
    assert runner.calls == 3


def test_research_test_api_contracts(tmp_path: Path) -> None:
    base, revision, _runner, service = _setup(tmp_path / "ruletrade.sqlite3")
    service._id_factory = iter([
        "experiment-robust", "candidate-r0", "candidate-r1", "candidate-r3", "candidate-r5"
    ]).__next__
    app.dependency_overrides[get_research_experiment_service] = lambda: service
    try:
        with TestClient(app) as client:
            policies = client.get("/v2/research-experiments/robustness-policies")
            robust = client.post(
                f"/v2/revisions/{revision.id}/research-experiments/robustness",
                json={
                    "name": "Start sensitivity",
                    "policy_id": "start-date-offset-v1",
                    "config": {
                        "start_date": "2024-01-02", "end_date": "2024-02-01",
                        "initial_cash": "100000", "dataset_id": "filter-synthetic",
                    },
                },
            )
            service._id_factory = iter([
                "experiment-random", "candidate-reference", "candidate-seed-7", "candidate-seed-11"
            ]).__next__
            random_baseline = client.post(
                f"/v2/revisions/{revision.id}/research-experiments/random-baseline",
                json={
                    "name": "Seeded baseline",
                    "base": base.model_dump(mode="json"),
                    "seeds": [7, 11],
                    "config": {
                        "start_date": "2024-01-02", "end_date": "2024-02-01",
                        "initial_cash": "100000", "dataset_id": "filter-synthetic",
                    },
                },
            )
    finally:
        app.dependency_overrides.clear()

    assert policies.status_code == 200
    assert policies.json()["items"][0]["start_date_offsets"] == [0, 1, 3, 5]
    assert robust.status_code == 201
    assert len(robust.json()["runs"]) == 4
    assert random_baseline.status_code == 201
    assert random_baseline.json()["experiment"]["kind"] == "random_baseline"


def test_random_baseline_rejects_duplicate_seeds_before_persistence(tmp_path: Path) -> None:
    base, revision, _runner, service = _setup(tmp_path / "ruletrade.sqlite3")

    with pytest.raises(InvalidExperimentSpecError, match="seeds must be unique"):
        service.create_random_baseline(
            revision.id,
            CreateRandomBaselineExperimentRequest.model_validate({
                "name": "Duplicate",
                "base": base.model_dump(mode="json"),
                "seeds": [7, 7],
                "config": {
                    "start_date": "2024-01-02", "end_date": "2024-02-01",
                    "initial_cash": "100000", "dataset_id": "filter-synthetic",
                },
            }),
        )

    assert service.list_for_revision(revision.id) == ()


def test_forward_snapshots_remain_pinned_and_refresh_idempotently(tmp_path: Path) -> None:
    _base, revision, runner, service = _setup(tmp_path / "ruletrade.sqlite3")
    current = [datetime(2024, 1, 10, tzinfo=UTC)]
    service._clock = lambda: current[0]
    service._id_factory = iter([
        "experiment-forward", "candidate-forward-1", "candidate-forward-2"
    ]).__next__

    activated = service.create_forward(
        revision.id,
        CreateForwardExperimentRequest(
            name="Paper since January",
            start_date="2024-01-02",
            initial_cash="100000",
            dataset_id="filter-synthetic",
        ),
    )
    same_day = service.refresh_forward(activated.experiment.id)
    current[0] = datetime(2024, 1, 15, tzinfo=UTC)
    refreshed = service.refresh_forward(activated.experiment.id)

    assert activated.experiment.kind.value == "forward"
    assert activated.latest_run.run_config.end_date.isoformat() == "2024-01-10"
    assert same_day.latest_run.id == activated.latest_run.id
    assert runner.calls == 2
    assert refreshed.latest_run.run_config.start_date.isoformat() == "2024-01-02"
    assert refreshed.latest_run.run_config.end_date.isoformat() == "2024-01-15"
    assert [item.parameters for item in refreshed.experiment.candidates] == [
        {"as_of": "2024-01-10"}, {"as_of": "2024-01-15"}
    ]
    assert all(
        item.source_hash == revision.source_hash
        and item.canonical_strategy == revision.canonical_strategy
        for item in refreshed.experiment.candidates
    )


def test_forward_api_activates_and_refreshes_same_experiment(tmp_path: Path) -> None:
    _base, revision, _runner, service = _setup(tmp_path / "ruletrade.sqlite3")
    current = [datetime(2024, 1, 10, tzinfo=UTC)]
    service._clock = lambda: current[0]
    service._id_factory = iter([
        "experiment-forward", "candidate-forward-1", "candidate-forward-2"
    ]).__next__
    app.dependency_overrides[get_research_experiment_service] = lambda: service
    try:
        with TestClient(app) as client:
            activated = client.post(
                f"/v2/revisions/{revision.id}/research-experiments/forward",
                json={
                    "name": "Paper since January",
                    "start_date": "2024-01-02",
                    "initial_cash": "100000",
                    "dataset_id": "filter-synthetic",
                },
            )
            current[0] = datetime(2024, 1, 15, tzinfo=UTC)
            refreshed = client.post(
                "/v2/research-experiments/experiment-forward/forward/refresh"
            )
    finally:
        app.dependency_overrides.clear()

    assert activated.status_code == 201
    assert activated.json()["experiment"]["kind"] == "forward"
    assert refreshed.status_code == 200
    assert len(refreshed.json()["experiment"]["candidates"]) == 2
    assert refreshed.json()["latest_run"]["run_config"]["end_date"] == "2024-01-15"


def test_forward_rejects_future_start_before_persistence(tmp_path: Path) -> None:
    _base, revision, _runner, service = _setup(tmp_path / "ruletrade.sqlite3")
    service._clock = lambda: datetime(2024, 1, 10, tzinfo=UTC)

    with pytest.raises(InvalidExperimentSpecError, match="cannot be in the future"):
        service.create_forward(
            revision.id,
            CreateForwardExperimentRequest(
                name="Future",
                start_date="2024-01-11",
                initial_cash="100000",
                dataset_id="filter-synthetic",
            ),
        )

    assert service.list_for_revision(revision.id) == ()


def test_strategy_research_portfolio_spans_all_revisions(tmp_path: Path) -> None:
    base, revision, _runner, service = _setup(tmp_path / "ruletrade.sqlite3")
    detail = service.create_detail(revision.id, _request(base))
    changed = revision.canonical_strategy.model_copy(update={
        "metadata": revision.canonical_strategy.metadata.model_copy(update={
            "description": "Second revision for portfolio history",
        }),
    })
    saved = service.strategies.save_revision(revision.strategy_id, revision.id, changed)
    service._id_factory = iter([
        "experiment-2",
        "candidate-robust-1",
        "candidate-robust-2",
        "candidate-robust-3",
        "candidate-robust-4",
    ]).__next__
    robustness = service.create_robustness(
        saved.revision.id,
        CreateRobustnessExperimentRequest.model_validate({
            "name": "Later robustness",
            "policy_id": "start-date-offset-v1",
            "config": {
                "start_date": "2024-01-02",
                "end_date": "2024-02-01",
                "initial_cash": "100000",
                "dataset_id": "filter-synthetic",
            },
        }),
    )

    portfolio = service.list_for_strategy(revision.strategy_id)

    assert portfolio == (robustness.experiment, detail.experiment)
    assert {item.revision_id for item in portfolio} == {revision.id, saved.revision.id}

    app.dependency_overrides[get_research_experiment_service] = lambda: service
    try:
        with TestClient(app) as client:
            response = client.get(
                f"/v2/strategies/{revision.strategy_id}/research-experiments"
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [
        robustness.experiment.id,
        detail.experiment.id,
    ]
