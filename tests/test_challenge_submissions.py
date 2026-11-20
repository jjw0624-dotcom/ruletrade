from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from ruletrade.api import app, get_challenge_submission_service
from ruletrade.backtest_runs.service import BacktestRunService
from ruletrade.backtests.lean_runner import LeanRunArtifact, LeanRunnerTimings
from ruletrade.backtests.service import BacktestService
from ruletrade.challenges.errors import InvalidChallengeSubmissionError
from ruletrade.challenges.service import ChallengeSubmissionService
from ruletrade.persistence.sqlite_backtest_runs import SQLiteBacktestRunRepository
from ruletrade.persistence.sqlite_challenges import SQLiteChallengeSubmissionRepository
from ruletrade.persistence.sqlite_strategies import SQLiteStrategyRepository
from ruletrade.strategies.service import StrategyService
from ruletrade.strategy.v2.catalog import SingleAssetCatalogRequest, create_catalog_strategy


@dataclass
class FakeRunner:
    evidence_component: str
    total_return: str = "10%"
    total_orders: int = 1
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
            result_payload={
                "statistics": {
                    "Start Equity": "100000",
                    "End Equity": "110000",
                    "Net Profit": self.total_return,
                    "Total Orders": str(self.total_orders),
                    "Total Fees": "$1",
                },
                "charts": {"Strategy Equity": {"series": {"Equity": {"values": [
                    [1704153600, 100000, 100000, 100000, 100000],
                    [1735603200, 110000, 110000, 110000, 110000],
                ]}}}},
            },
            timings=LeanRunnerTimings(csharp_compile_ms=1, lean_execution_ms=1, result_load_ms=1),
        )


def _setup(database: Path, *, asset: str = "QQQ", total_orders: int = 1):
    strategies = StrategyService(SQLiteStrategyRepository(database))
    catalog_request = SingleAssetCatalogRequest(
        catalog_id="single_asset_periodic",
        name=f"{asset} monthly",
        asset=asset,
        timeframe="monthly",
    )
    created = create_catalog_strategy(catalog_request)
    revision = strategies.create_strategy(catalog_request.name, created.strategy).current_revision
    assert created.strategy.program is not None
    runner = FakeRunner(
        created.strategy.program.statements[0].semantic_id,
        total_orders=total_orders,
    )
    runs = BacktestRunService(
        SQLiteBacktestRunRepository(database),
        strategies,
        BacktestService(runner),
        build_commit="test",
    )
    service = ChallengeSubmissionService(
        SQLiteChallengeSubmissionRepository(database),
        strategies,
        runs,
        id_factory=iter(["submission-1", "submission-2"]).__next__,
    )
    return revision, runner, service


def test_learning_submission_runs_official_policy_and_persists_score(tmp_path: Path) -> None:
    database = tmp_path / "ruletrade.sqlite3"
    revision, runner, service = _setup(database)

    execution = service.submit("learn-monthly-single-asset-v1", revision.id)

    assert runner.calls == 1
    assert execution.run.run_config.dataset_id == "filter-synthetic"
    assert execution.run.run_config.start_date.isoformat() == "2024-01-02"
    assert execution.submission.challenge_version == 1
    assert execution.submission.policy_version == 1
    assert execution.submission.catalog_id == "single_asset_periodic"
    assert execution.submission.catalog_parameters["asset"] == "QQQ"
    assert execution.submission.eligible is True
    assert execution.submission.score == execution.run.result.total_return
    assert service.get("submission-1") == execution.submission

    recovered = ChallengeSubmissionService(
        SQLiteChallengeSubmissionRepository(database),
        service.strategies,
        service.runs,
    )
    assert recovered.get("submission-1") == execution.submission
    assert recovered.list_for_challenge("learn-monthly-single-asset-v1") == (
        execution.submission,
    )


def test_competition_rejects_disallowed_asset_before_lean(tmp_path: Path) -> None:
    revision, runner, service = _setup(tmp_path / "ruletrade.sqlite3", asset="QQQ")

    with pytest.raises(InvalidChallengeSubmissionError, match="Assets are not allowed"):
        service.submit("competition-controlled-downside-v1", revision.id)

    assert runner.calls == 0
    assert service.list_for_challenge("competition-controlled-downside-v1") == ()


def test_forged_catalog_tag_is_rejected_before_lean(tmp_path: Path) -> None:
    database = tmp_path / "ruletrade.sqlite3"
    revision, runner, service = _setup(database)
    forged = revision.canonical_strategy.model_copy(
        update={
            "metadata": revision.canonical_strategy.metadata.model_copy(
                update={"name": "Changed outside catalog factory"}
            )
        }
    )
    forged_revision = service.strategies.create_strategy(
        "Forged provenance", forged
    ).current_revision

    with pytest.raises(
        InvalidChallengeSubmissionError,
        match="catalog family is not allowed",
    ):
        service.submit("learn-monthly-single-asset-v1", forged_revision.id)

    assert runner.calls == 0


def test_result_constraint_marks_submission_ineligible(tmp_path: Path) -> None:
    revision, runner, service = _setup(
        tmp_path / "ruletrade.sqlite3", asset="SPY", total_orders=20
    )

    execution = service.submit("competition-controlled-downside-v1", revision.id)

    assert runner.calls == 1
    assert execution.submission.eligible is False
    assert execution.submission.score is None
    assert execution.submission.violations == (
        "Total orders 20 exceed the limit 12.",
    )


def test_challenge_submission_api_create_list_read_and_reject(tmp_path: Path) -> None:
    revision, runner, service = _setup(tmp_path / "ruletrade.sqlite3")
    app.dependency_overrides[get_challenge_submission_service] = lambda: service
    try:
        with TestClient(app) as client:
            created = client.post(
                "/v2/challenges/learn-monthly-single-asset-v1/submissions",
                json={"revision_id": revision.id},
            )
            listed = client.get(
                "/v2/challenges/learn-monthly-single-asset-v1/submissions"
            )
            read = client.get("/v2/challenge-submissions/submission-1")
            rejected = client.post(
                "/v2/challenges/competition-controlled-downside-v1/submissions",
                json={"revision_id": revision.id},
            )
    finally:
        app.dependency_overrides.clear()

    assert runner.calls == 1
    assert created.status_code == 201
    assert created.json()["submission"]["score"] == "0.1"
    assert created.json()["run"]["revision_id"] == revision.id
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()["items"]] == ["submission-1"]
    assert read.status_code == 200 and read.json()["policy_version"] == 1
    assert rejected.status_code == 422
    assert rejected.json()["detail"]["code"] == "invalid_challenge_submission"
