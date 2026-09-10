from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from ruletrade.api import app, get_candidate_service
from ruletrade.backtest_runs.models import BacktestRunStatus
from ruletrade.backtest_runs.service import BacktestRunService
from ruletrade.backtests.errors import LeanExecutionError
from ruletrade.backtests.lean_runner import LeanRunArtifact, LeanRunnerTimings
from ruletrade.backtests.models import BacktestConfig
from ruletrade.backtests.service import BacktestService
from ruletrade.candidates.errors import (
    CandidateAdoptionLineageError,
    CandidateArchivedStrategyError,
    CandidateExpectedValueMismatchError,
    InvalidCandidateChangeError,
)
from ruletrade.candidates.models import FilterThresholdChange
from ruletrade.candidates.service import CandidateService
from ruletrade.compiler import compile_strategy_to_lean_plan
from ruletrade.comparisons.service import ComparisonService
from ruletrade.compiler.lean import CSharpGenerationSettings, generate_csharp
from ruletrade.persistence import (
    SQLiteBacktestRunRepository,
    SQLiteCandidateRepository,
    SQLiteComparisonRepository,
    SQLiteStrategyRepository,
)
from ruletrade.strategies.errors import StaleRevisionError
from ruletrade.strategies.service import StrategyService
from ruletrade.strategy.v1.fixtures import filter_screening_strategy


@dataclass
class CandidateRunner:
    error: Exception | None = None
    image: str = "quantconnect/lean:test"
    calls: list[tuple[str, str]] = field(default_factory=list)

    def run(self, generated_csharp: str, *, dataset_id: str) -> LeanRunArtifact:
        self.calls.append((generated_csharp, dataset_id))
        if self.error is not None:
            raise self.error
        return LeanRunArtifact(
            log_text=(
                "RULETRADE_EVIDENCE_V2|sequence=1|session=2024-01-02|"
                "phase=evaluation|kind=filter|filter_component=positive_return|"
                "filter_field=config.threshold|operator=gt|threshold=0|"
                "decision_universe=QQQ,VGT,SOXX,SCHG|scores=QQQ%3D0.1|"
                "eligible=QQQ|rejected="
            ),
            result_payload={
                "statistics": {
                    "Start Equity": "100000",
                    "End Equity": "101000",
                    "Net Profit": "1%",
                    "Total Orders": "1",
                    "Total Fees": "$1",
                },
                "charts": {
                    "Strategy Equity": {
                        "series": {
                            "Equity": {
                                "values": [
                                    [1704153600, 100000, 100000, 100000, 100000],
                                    [1704240000, 101000, 101000, 101000, 101000],
                                ]
                            }
                        }
                    }
                },
            },
            timings=LeanRunnerTimings(csharp_compile_ms=1, lean_execution_ms=2, result_load_ms=1),
        )


def _services(
    path: Path, runner: CandidateRunner | None = None
) -> tuple[StrategyService, BacktestRunService, CandidateService]:
    strategies = StrategyService(SQLiteStrategyRepository(path))
    runs = BacktestRunService(
        SQLiteBacktestRunRepository(path), strategies, BacktestService(runner or CandidateRunner())
    )
    candidates = CandidateService(SQLiteCandidateRepository(path), strategies, runs)
    return strategies, runs, candidates


def _origin(path: Path, runner: CandidateRunner | None = None):
    strategies, runs, candidates = _services(path, runner)
    detail = strategies.create_strategy("Filter", filter_screening_strategy())
    config = BacktestConfig(
        start_date="2024-01-02",
        end_date="2024-02-29",
        initial_cash="250000",
        dataset_id="filter-synthetic",
    )
    run = runs.create_and_execute(detail.current_revision.id, config)
    return strategies, runs, candidates, detail, run


def _change(**updates: Any) -> FilterThresholdChange:
    return FilterThresholdChange.model_validate(
        {
            "component_id": "positive_return",
            "field_path": "config.threshold",
            "expected_before": "0",
            "proposed_after": "0.05",
            **updates,
        }
    )


def test_candidate_is_immutable_reproducible_and_uses_official_run_pipeline(tmp_path: Path) -> None:
    database = tmp_path / "ruletrade.sqlite3"
    runner = CandidateRunner()
    strategies, runs, candidates, detail, origin = _origin(database, runner)
    original_source = detail.current_revision.canonical_strategy

    execution = candidates.create_and_execute(
        origin.id, _change(), originating_decision_event_id="event-000001"
    )

    assert execution.candidate.base_revision_id == detail.current_revision.id
    assert execution.candidate.originating_run_id == origin.id
    assert execution.candidate.originating_decision_event_id == "event-000001"
    assert execution.candidate.change.expected_before == Decimal(0)
    changed = next(
        item for item in execution.candidate.canonical_strategy.graph.components
        if item.id == "positive_return"
    )
    assert changed.config["threshold"] == "0.05"
    assert execution.candidate.source_hash == execution.run.provenance.source_hash
    assert execution.run.candidate_id == execution.candidate.id
    assert execution.run.revision_id == detail.current_revision.id
    assert execution.run.run_config == origin.run_config
    assert execution.run.status == BacktestRunStatus.SUCCEEDED
    assert execution.run.result is not None
    assert len(runner.calls) == 2
    assert execution.candidate.diagnostics.canonical_bytes > 0
    assert execution.candidate.diagnostics.creation_overhead_ms >= 0
    assert execution.candidate.diagnostics.request_total_ms >= (
        execution.candidate.diagnostics.creation_overhead_ms
        + execution.run.timings.total_ms
    )
    current = strategies.get_strategy(detail.strategy.id)
    assert current.current_revision.canonical_strategy == original_source
    assert current.strategy.current_revision_id == detail.current_revision.id
    assert runs.get_run(origin.id) == origin

    reopened = CandidateService(
        SQLiteCandidateRepository(database), strategies, runs
    ).get(execution.candidate.id)
    assert reopened == execution
    assert runs.list_decision_events(execution.run.id)
    with (
        sqlite3.connect(database) as connection,
        pytest.raises(sqlite3.IntegrityError, match="immutable"),
    ):
        connection.execute(
            "UPDATE candidates SET source_hash = 'changed' WHERE id = ?",
            (execution.candidate.id,),
        )


def test_reopened_negative_threshold_candidate_codegen_remains_numeric(
    tmp_path: Path,
) -> None:
    database = tmp_path / "ruletrade.sqlite3"
    runner = CandidateRunner()
    _, _, candidates, _, origin = _origin(database, runner)

    execution = candidates.create_and_execute(
        origin.id,
        _change(proposed_after="-0.01"),
        originating_decision_event_id="event-000001",
    )
    reopened = candidates.get(execution.candidate.id)

    assert reopened.candidate == execution.candidate
    threshold = next(
        component.config["threshold"]
        for component in reopened.candidate.canonical_strategy.graph.components
        if component.id == "positive_return"
    )
    assert threshold == "-0.01"
    plan = compile_strategy_to_lean_plan(reopened.candidate.canonical_strategy)
    assert plan.momentum_selections[0].filter_threshold == Decimal("-0.01")
    generated = generate_csharp(
        plan,
        CSharpGenerationSettings(
            start_date=origin.run_config.start_date,
            end_date=origin.run_config.end_date,
            initial_cash=origin.run_config.initial_cash,
        ),
    )
    assert generated == runner.calls[1][0]
    assert "item.Value > (-0.01m)" in generated
    assert '(-0.01m).ToString("G29"' in generated
    assert '-0.01m.ToString("G29"' not in generated


def test_candidate_targeting_and_expected_before_are_strict(tmp_path: Path) -> None:
    _, _, candidates, _, origin = _origin(tmp_path / "ruletrade.sqlite3")
    with pytest.raises(CandidateExpectedValueMismatchError):
        candidates.create_and_execute(origin.id, _change(expected_before="0.1"))
    with pytest.raises(InvalidCandidateChangeError, match="not found"):
        candidates.create_and_execute(origin.id, _change(component_id="missing"))
    with pytest.raises(InvalidCandidateChangeError, match="supports only"):
        candidates.create_and_execute(origin.id, _change(component_id="top_n"))
    with pytest.raises(InvalidCandidateChangeError, match="must alter"):
        candidates.create_and_execute(origin.id, _change(proposed_after="0"))
    assert candidates.list_for_run(origin.id) == ()


def test_same_semantic_candidate_has_deterministic_hash_but_distinct_identity(
    tmp_path: Path,
) -> None:
    _, _, candidates, _, origin = _origin(tmp_path / "ruletrade.sqlite3")
    first = candidates.create_and_execute(origin.id, _change())
    second = candidates.create_and_execute(origin.id, _change())
    assert first.candidate.id != second.candidate.id
    assert first.run.id != second.run.id
    assert first.candidate.source_hash == second.candidate.source_hash


def test_valid_candidate_survives_execution_failure_and_archive_preserves_history(tmp_path: Path) -> None:
    database = tmp_path / "ruletrade.sqlite3"
    runner = CandidateRunner()
    strategies, _, candidates, detail, origin = _origin(database, runner)
    runner.error = LeanExecutionError("boom")
    execution = candidates.create_and_execute(origin.id, _change())
    assert execution.run.status == BacktestRunStatus.FAILED
    assert execution.run.result is None
    candidate_id = execution.candidate.id

    strategies.archive_strategy(detail.strategy.id)
    assert candidates.get(candidate_id) == execution
    with pytest.raises(CandidateArchivedStrategyError):
        candidates.create_and_execute(origin.id, _change(proposed_after="0.1"))


def test_later_revision_does_not_change_candidate_and_future_keep_detects_stale_base(
    tmp_path: Path,
) -> None:
    strategies, _, candidates, detail, origin = _origin(tmp_path / "ruletrade.sqlite3")
    execution = candidates.create_and_execute(origin.id, _change())
    advanced = detail.current_revision.canonical_strategy.model_copy(
        update={
            "metadata": detail.current_revision.canonical_strategy.metadata.model_copy(
                update={"description": "advanced"}
            )
        }
    )
    strategies.save_revision(detail.strategy.id, detail.current_revision.id, advanced)
    assert candidates.get(execution.candidate.id).candidate == execution.candidate
    with pytest.raises(StaleRevisionError):
        strategies.save_revision(
            detail.strategy.id,
            execution.candidate.base_revision_id,
            execution.candidate.canonical_strategy,
        )


def test_candidate_api_creates_lists_and_reads(tmp_path: Path) -> None:
    _, _, candidates, _, origin = _origin(tmp_path / "ruletrade.sqlite3")
    app.dependency_overrides[get_candidate_service] = lambda: candidates
    client = TestClient(app)
    try:
        response = client.post(
            f"/v1/backtest-runs/{origin.id}/candidates",
            json={"change": _change().model_dump(mode="json")},
        )
        assert response.status_code == 201
        candidate_id = response.json()["candidate"]["id"]
        assert client.get(f"/v1/candidates/{candidate_id}").status_code == 200
        listed = client.get(f"/v1/backtest-runs/{origin.id}/candidates")
        assert listed.status_code == 200
        assert [item["candidate"]["id"] for item in listed.json()["items"]] == [candidate_id]
        invalid = client.post(
            f"/v1/backtest-runs/{origin.id}/candidates",
            json={
                "change": {
                    **_change().model_dump(mode="json"),
                    "proposed_after": "not-a-number",
                }
            },
        )
        assert invalid.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_v4_database_migrates_to_candidate_schema(tmp_path: Path) -> None:
    database = tmp_path / "v4.sqlite3"
    with sqlite3.connect(database) as connection:
        connection.executescript(
            """
            PRAGMA user_version = 4;
            CREATE TABLE strategies (
                id TEXT PRIMARY KEY, name TEXT, created_at TEXT, updated_at TEXT,
                current_revision_id TEXT, archived_at TEXT
            );
            CREATE TABLE strategy_revisions (
                id TEXT PRIMARY KEY, strategy_id TEXT, parent_revision_id TEXT,
                canonical_json TEXT, source_hash TEXT, schema_version TEXT, created_at TEXT
            );
            CREATE TABLE backtest_runs (
                id TEXT PRIMARY KEY, revision_id TEXT NOT NULL, status TEXT NOT NULL,
                config_json TEXT NOT NULL, result_json TEXT, error_json TEXT,
                provenance_json TEXT NOT NULL, timings_json TEXT NOT NULL,
                created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT
            );
            CREATE TRIGGER backtest_runs_immutable_identity
            BEFORE UPDATE ON backtest_runs WHEN NEW.id != OLD.id
            BEGIN SELECT RAISE(ABORT, 'immutable'); END;
            CREATE TABLE decision_events (
                run_id TEXT, id TEXT, ordinal INTEGER, schema_version INTEGER,
                session_id TEXT, phase TEXT, kind TEXT, source_components_json TEXT,
                evidence_json TEXT, PRIMARY KEY (run_id, id)
            );
            """
        )

    SQLiteStrategyRepository(database)

    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 8
        columns = {
            row[1] for row in connection.execute("PRAGMA table_info(backtest_runs)")
        }
        assert "candidate_id" in columns
        assert connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'candidates'"
        ).fetchone() == ("candidates",)
        assert "diagnostics_json" in {
            row[1] for row in connection.execute("PRAGMA table_info(candidates)")
        }


def test_candidate_adoption_appends_once_without_rerunning_or_mutating_history(
    tmp_path: Path,
) -> None:
    database = tmp_path / "ruletrade.sqlite3"
    runner = CandidateRunner()
    strategies, runs, candidates, detail, origin = _origin(database, runner)
    execution = candidates.create_and_execute(origin.id, _change())
    comparison = ComparisonService(
        SQLiteComparisonRepository(database), candidates, runs
    ).create(execution.candidate.id)
    original_revision = detail.current_revision
    original_candidate = candidates.get(execution.candidate.id)
    calls_before_adoption = len(runner.calls)

    adopted = candidates.adopt(execution.candidate.id, original_revision.id)

    assert adopted.created is True
    assert adopted.strategy.current_revision_id == adopted.revision.id
    assert adopted.revision.parent_revision_id == original_revision.id
    assert adopted.revision.canonical_strategy == execution.candidate.canonical_strategy
    assert strategies.get_revision(detail.strategy.id, original_revision.id) == original_revision
    assert candidates.get(execution.candidate.id) == original_candidate
    assert runs.get_run(origin.id) == origin
    assert ComparisonService(
        SQLiteComparisonRepository(database), candidates, runs
    ).get(comparison.id) == comparison
    assert len(runner.calls) == calls_before_adoption

    reopened_candidates = CandidateService(
        SQLiteCandidateRepository(database), StrategyService(SQLiteStrategyRepository(database)), runs
    )
    retry = reopened_candidates.adopt(execution.candidate.id, original_revision.id)
    assert retry.created is False
    assert retry.revision.id == adopted.revision.id
    assert len(strategies.list_revisions(detail.strategy.id)) == 2
    assert len(runner.calls) == calls_before_adoption


def test_candidate_adoption_rejects_stale_lineage_and_archived_strategy(
    tmp_path: Path,
) -> None:
    database = tmp_path / "ruletrade.sqlite3"
    strategies, _, candidates, detail, origin = _origin(database)
    execution = candidates.create_and_execute(origin.id, _change())
    advanced = detail.current_revision.canonical_strategy.model_copy(
        update={
            "metadata": detail.current_revision.canonical_strategy.metadata.model_copy(
                update={"description": "advanced"}
            )
        }
    )
    strategies.save_revision(detail.strategy.id, detail.current_revision.id, advanced)

    with pytest.raises(StaleRevisionError):
        candidates.adopt(execution.candidate.id, detail.current_revision.id)
    with pytest.raises(CandidateAdoptionLineageError):
        candidates.adopt(execution.candidate.id, "wrong-revision")
    assert len(strategies.list_revisions(detail.strategy.id)) == 2

    archived_database = tmp_path / "archived.sqlite3"
    archived_strategies, _, archived_candidates, archived_detail, archived_origin = _origin(
        archived_database
    )
    archived_execution = archived_candidates.create_and_execute(
        archived_origin.id, _change()
    )
    archived_strategies.archive_strategy(archived_detail.strategy.id)
    with pytest.raises(CandidateArchivedStrategyError):
        archived_candidates.adopt(
            archived_execution.candidate.id, archived_detail.current_revision.id
        )
    assert len(archived_strategies.list_revisions(archived_detail.strategy.id)) == 1


def test_candidate_adoption_api_returns_revision_and_structured_stale_conflict(
    tmp_path: Path,
) -> None:
    strategies, _, candidates, detail, origin = _origin(tmp_path / "ruletrade.sqlite3")
    execution = candidates.create_and_execute(origin.id, _change())
    app.dependency_overrides[get_candidate_service] = lambda: candidates
    client = TestClient(app)
    try:
        response = client.post(
            f"/v1/candidates/{execution.candidate.id}/adopt",
            json={"expected_current_revision_id": detail.current_revision.id},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["created"] is True
        assert payload["revision"]["parent_revision_id"] == detail.current_revision.id
        stale = client.post(
            f"/v1/candidates/{execution.candidate.id}/adopt",
            json={"expected_current_revision_id": "other"},
        )
        assert stale.status_code == 409
        assert stale.json()["detail"]["code"] == "candidate_adoption_lineage_mismatch"
    finally:
        app.dependency_overrides.clear()
