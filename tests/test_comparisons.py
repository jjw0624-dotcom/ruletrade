from __future__ import annotations

import json
import sqlite3
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ruletrade.api import app, get_comparison_service
from ruletrade.backtest_runs.models import (
    BacktestRunProvenance,
    BacktestRunRecord,
    BacktestRunStatus,
)
from ruletrade.backtest_runs.service import BacktestRunService
from ruletrade.backtests.models import BacktestConfig, BacktestResult, BacktestTimings, EquityPoint
from ruletrade.backtests.service import BacktestService
from ruletrade.candidates.models import CandidateRecord, FilterThresholdChange
from ruletrade.candidates.service import CandidateService
from ruletrade.comparisons.errors import (
    ComparisonEvidenceUnsupportedError,
    IncomparableRunsError,
)
from ruletrade.comparisons.service import ComparisonService
from ruletrade.decision_evidence.models import (
    AssetPredicate,
    CollectedDecisionEvent,
    FallbackEvidence,
    FilterEvidence,
    FinalSelectionEvidence,
    FinalTargetsEvidence,
    SelectionAssetOutcome,
    SelectionEvidence,
    SourceComponentRef,
)
from ruletrade.hashing import strategy_hash
from ruletrade.persistence import (
    SQLiteBacktestRunRepository,
    SQLiteCandidateRepository,
    SQLiteComparisonRepository,
    SQLiteStrategyRepository,
)
from ruletrade.strategies.service import StrategyService
from ruletrade.strategy.v1.fixtures import filter_screening_strategy

NOW = datetime(2024, 3, 1, tzinfo=UTC)
SESSION = date(2024, 2, 1)


class NeverRunner:
    image = "lean:test"
    calls = 0

    def run(self, _source: str, *, dataset_id: str):
        self.calls += 1
        raise AssertionError(f"Comparison reran LEAN for {dataset_id}")


def _event(
    sequence: int,
    evidence,
    *,
    phase: str,
    component: str,
    role: str,
    field_path: str | None = None,
    schema_version: int = 2,
) -> CollectedDecisionEvent:
    return CollectedDecisionEvent.model_validate(
        {
            "schema_version": schema_version,
            "sequence": sequence,
            "session_id": SESSION,
            "phase": phase,
            "source_components": [
                {
                    "role": role,
                    "component_id": component,
                    "field_path": field_path,
                }
            ],
            "evidence": evidence.model_dump(mode="json"),
        }
    )


def _original_events(*, version: int = 2) -> tuple[CollectedDecisionEvent, ...]:
    return (
        _event(
            1,
            FilterEvidence(
                operator="gt",
                threshold=Decimal("0.05"),
                decision_universe=("QQQ", "VGT"),
                evaluations=(
                    AssetPredicate(asset="QQQ", observed=Decimal("0.10"), passed=True),
                    AssetPredicate(
                        asset="VGT",
                        observed=Decimal("0.03"),
                        passed=False,
                        stopping_stage="filter",
                    ),
                ),
            ),
            phase="evaluation",
            component="positive_return",
            role="filter",
            field_path="config.threshold" if version == 2 else None,
            schema_version=version,
        ),
        _event(
            2,
            SelectionEvidence(
                scores={"QQQ": Decimal("0.10")},
                ranked=("QQQ",),
                candidates=("QQQ",),
                primary_selected=(),
                decision="insufficient",
                required_count=2 if version == 2 else None,
                asset_outcomes=(
                    SelectionAssetOutcome(
                        asset="QQQ",
                        signal="present",
                        rank=1,
                        primary_selected=False,
                        stopping_stage="fallback_replacement",
                    ),
                ) if version == 2 else None,
            ),
            phase="selection",
            component="top_n",
            role="selection",
            field_path="config.count" if version == 2 else None,
            schema_version=version,
        ),
        _event(
            3,
            FallbackEvidence(asset="TLT", activated=True),
            phase="selection",
            component="fallback",
            role="fallback",
            schema_version=version,
        ),
        _event(
            4,
            FinalSelectionEvidence(selected=("TLT",), source="fallback"),
            phase="selection",
            component="fallback",
            role="selection",
            schema_version=version,
        ),
        _event(
            5,
            FinalTargetsEvidence(selected=("TLT",), targets={"TLT": Decimal(1)}),
            phase="portfolio_execution",
            component="rebalance",
            role="rebalance",
            schema_version=version,
        ),
    )


def _candidate_events() -> tuple[CollectedDecisionEvent, ...]:
    return (
        _event(
            1,
            FilterEvidence(
                operator="gt",
                threshold=Decimal(0),
                decision_universe=("QQQ", "VGT"),
                evaluations=(
                    AssetPredicate(asset="QQQ", observed=Decimal("0.10"), passed=True),
                    AssetPredicate(asset="VGT", observed=Decimal("0.03"), passed=True),
                ),
            ),
            phase="evaluation",
            component="positive_return",
            role="filter",
            field_path="config.threshold",
        ),
        _event(
            2,
            SelectionEvidence(
                scores={"QQQ": Decimal("0.10"), "VGT": Decimal("0.03")},
                ranked=("QQQ", "VGT"),
                candidates=("QQQ", "VGT"),
                primary_selected=("QQQ", "VGT"),
                decision="executed",
                required_count=2,
                asset_outcomes=(
                    SelectionAssetOutcome(
                        asset="QQQ", signal="present", rank=1, primary_selected=True
                    ),
                    SelectionAssetOutcome(
                        asset="VGT", signal="present", rank=2, primary_selected=True
                    ),
                ),
            ),
            phase="selection",
            component="top_n",
            role="selection",
            field_path="config.count",
        ),
        _event(
            3,
            FinalSelectionEvidence(selected=("QQQ", "VGT"), source="primary"),
            phase="selection",
            component="fallback",
            role="selection",
        ),
        _event(
            4,
            FinalTargetsEvidence(
                selected=("QQQ", "VGT"),
                targets={"QQQ": Decimal("0.5"), "VGT": Decimal("0.5")},
            ),
            phase="portfolio_execution",
            component="rebalance",
            role="rebalance",
        ),
    )


def _result(final: str, orders: int, fees: str) -> BacktestResult:
    return BacktestResult(
        initial_value=Decimal("100000"),
        final_value=Decimal(final),
        total_return=(Decimal(final) / Decimal("100000")) - 1,
        total_orders=orders,
        total_fees=Decimal(fees),
        equity_curve=[EquityPoint(timestamp=NOW, value=Decimal(final))],
    )


def _persist_run(
    repository: SQLiteBacktestRunRepository,
    *,
    run_id: str,
    revision_id: str,
    candidate_id: str | None,
    config: BacktestConfig,
    events: tuple[CollectedDecisionEvent, ...],
    result: BacktestResult,
    source_hash: str,
) -> BacktestRunRecord:
    pending = BacktestRunRecord(
        id=run_id,
        revision_id=revision_id,
        candidate_id=candidate_id,
        status=BacktestRunStatus.PENDING,
        run_config=config,
        provenance=BacktestRunProvenance(
            source_hash=source_hash,
            strategy_schema_version="ruletrade.dev/strategy/v1",
            application_version="test",
            dataset_id=config.dataset_id,
        ),
        timings=BacktestTimings(),
        created_at=NOW,
    )
    repository.create_run(pending)
    repository.mark_running(run_id, NOW)
    return repository.complete_succeeded_with_evidence(
        run_id, result, BacktestTimings(), NOW, events
    )


def _fixture(
    database: Path,
    *,
    original_events: tuple[CollectedDecisionEvent, ...] | None = None,
    candidate_events: tuple[CollectedDecisionEvent, ...] | None = None,
    candidate_config: BacktestConfig | None = None,
):
    strategy_repository = SQLiteStrategyRepository(database)
    strategies = StrategyService(strategy_repository)
    source = filter_screening_strategy()
    source = source.model_copy(
        update={
            "graph": source.graph.model_copy(
                update={
                    "components": tuple(
                        component.model_copy(
                            update={"config": {**component.config, "threshold": "0.05"}}
                        )
                        if component.id == "positive_return"
                        else component
                        for component in source.graph.components
                    )
                }
            )
        }
    )
    revision = strategies.create_strategy(
        "Comparison", source
    ).current_revision
    run_repository = SQLiteBacktestRunRepository(database)
    config = BacktestConfig(dataset_id="filter-synthetic")
    original = _persist_run(
        run_repository,
        run_id="original-run",
        revision_id=revision.id,
        candidate_id=None,
        config=config,
        events=original_events or _original_events(),
        result=_result("131000", 21, "20.50"),
        source_hash=revision.source_hash,
    )
    source = revision.canonical_strategy
    components = tuple(
        component.model_copy(
            update={"config": {**component.config, "threshold": "0"}}
        ) if component.id == "positive_return" else component
        for component in source.graph.components
    )
    candidate_source = source.model_copy(
        update={"graph": source.graph.model_copy(update={"components": components})}
    )
    candidate = CandidateRecord(
        id="candidate-1",
        base_revision_id=revision.id,
        originating_run_id=original.id,
        originating_decision_event_id="event-000001",
        change=FilterThresholdChange(
            component_id="positive_return",
            expected_before=Decimal("0.05"),
            proposed_after=Decimal(0),
        ),
        canonical_strategy=candidate_source,
        source_hash=strategy_hash(candidate_source),
        schema_version=candidate_source.api_version,
        created_at=NOW,
    )
    candidate_repository = SQLiteCandidateRepository(database)
    candidate_repository.create(candidate)
    candidate_run = _persist_run(
        run_repository,
        run_id="candidate-run",
        revision_id=revision.id,
        candidate_id=candidate.id,
        config=candidate_config or config,
        events=candidate_events or _candidate_events(),
        result=_result("135000", 29, "28.75"),
        source_hash=candidate.source_hash,
    )
    runner = NeverRunner()
    runs = BacktestRunService(run_repository, strategies, BacktestService(runner))
    candidates = CandidateService(candidate_repository, strategies, runs)
    comparisons = ComparisonService(
        SQLiteComparisonRepository(database), candidates, runs
    )
    return comparisons, runner, candidate, original, candidate_run


def test_comparison_persists_strategy_behavior_and_result_diffs(tmp_path: Path) -> None:
    database = tmp_path / "ruletrade.sqlite3"
    service, runner, candidate, original, candidate_run = _fixture(database)

    comparison = service.create(candidate.id)

    assert comparison.strategy_diff.component_id == "positive_return"
    assert comparison.strategy_diff.field_path == "config.threshold"
    assert comparison.strategy_diff.before == Decimal("0.05")
    assert comparison.strategy_diff.after == Decimal(0)
    assert comparison.original_run_id == original.id
    assert comparison.candidate_run_id == candidate_run.id
    assert comparison.aligned_evidence_records == 5
    assert len(comparison.changed_decision_contexts) == 1
    kinds = {
        kind
        for difference in comparison.changed_decision_contexts[0].differences
        for kind in difference.kinds
    }
    assert {
        "qualification_changed",
        "candidate_membership_changed",
        "primary_selection_changed",
        "fallback_activation_changed",
        "final_selection_changed",
        "final_target_changed",
    } <= kinds
    fallback = next(
        item
        for item in comparison.changed_decision_contexts[0].differences
        if item.presence == "original_only"
    )
    assert fallback.original_event is not None and fallback.candidate_event is None
    assert comparison.first_difference is not None
    assert comparison.first_difference.session_id == SESSION
    assert comparison.result_diff.total_return.delta == Decimal("0.04")
    assert comparison.result_diff.total_orders.delta == 8
    assert comparison.result_diff.total_fees.delta == Decimal("8.25")
    assert comparison.result_diff.original_equity_run_id == original.id
    assert comparison.result_diff.candidate_equity_run_id == candidate_run.id
    assert comparison.compute_ms >= 0
    assert runner.calls == 0

    reopened = ComparisonService(
        SQLiteComparisonRepository(database), service.candidates, service.runs
    ).get(comparison.id)
    assert reopened == comparison
    assert service.create(candidate.id) == comparison
    assert runner.calls == 0


def test_zero_behavioral_differences_are_valid(tmp_path: Path) -> None:
    events = _original_events()
    service, _, candidate, _, _ = _fixture(
        tmp_path / "ruletrade.sqlite3",
        original_events=events,
        candidate_events=events,
    )
    comparison = service.create(candidate.id)
    assert comparison.changed_decision_contexts == ()
    assert comparison.first_difference is None
    assert comparison.aligned_evidence_records == len(events)


def test_alignment_handles_original_only_and_candidate_only_events(tmp_path: Path) -> None:
    candidate_events = (
        *_candidate_events(),
        _event(
            5,
            FallbackEvidence(asset="IEF", activated=False),
            phase="selection",
            component="fallback",
            role="fallback",
        ),
    )
    service, _, candidate, _, _ = _fixture(
        tmp_path / "ruletrade.sqlite3",
        candidate_events=candidate_events,
    )
    comparison = service.create(candidate.id)
    presence = {
        difference.presence
        for context in comparison.changed_decision_contexts
        for difference in context.differences
        if "event_presence_changed" in difference.kinds
    }
    assert presence == {"original_only", "candidate_only"}
    assert comparison.first_difference is not None
    assert comparison.first_difference.difference_key.startswith(
        "2024-02-01|evaluation|filter|"
    )


def test_comparison_rejects_incompatible_failed_or_legacy_runs(tmp_path: Path) -> None:
    incompatible = BacktestConfig(
        start_date="2024-02-01",
        end_date="2024-12-31",
        dataset_id="filter-synthetic",
    )
    service, _, candidate, original, candidate_run = _fixture(
        tmp_path / "incompatible.sqlite3", candidate_config=incompatible
    )
    with pytest.raises(IncomparableRunsError, match="configurations"):
        service.create(candidate.id)
    with pytest.raises(IncomparableRunsError, match="does not belong"):
        service._validate_pair(
            candidate.base_revision_id,
            original.provenance.source_hash,
            candidate.source_hash,
            original,
            candidate_run.model_copy(update={"candidate_id": "other"}),
            candidate.id,
        )
    with pytest.raises(IncomparableRunsError, match="succeeded"):
        service._validate_pair(
            candidate.base_revision_id,
            original.provenance.source_hash,
            candidate.source_hash,
            original,
            candidate_run.model_copy(
                update={
                    "run_config": original.run_config,
                    "status": BacktestRunStatus.FAILED,
                }
            ),
            candidate.id,
        )

    with pytest.raises(IncomparableRunsError, match="source does not match Candidate"):
        service._validate_pair(
            candidate.base_revision_id,
            original.provenance.source_hash,
            "sha256:expected-candidate",
            original,
            candidate_run,
            candidate.id,
        )

    legacy, _, legacy_candidate, _, _ = _fixture(
        tmp_path / "legacy.sqlite3",
        original_events=_original_events(version=1),
    )
    with pytest.raises(ComparisonEvidenceUnsupportedError, match="v2"):
        legacy.create(legacy_candidate.id)


def test_comparison_api_and_storage_are_immutable(tmp_path: Path) -> None:
    database = tmp_path / "ruletrade.sqlite3"
    service, _, candidate, _, _ = _fixture(database)
    app.dependency_overrides[get_comparison_service] = lambda: service
    client = TestClient(app)
    try:
        response = client.post(f"/v1/candidates/{candidate.id}/comparison")
        assert response.status_code == 201
        comparison_id = response.json()["id"]
        assert client.get(f"/v1/comparisons/{comparison_id}").json() == response.json()
    finally:
        app.dependency_overrides.clear()
    with (
        sqlite3.connect(database) as connection,
        pytest.raises(sqlite3.IntegrityError, match="immutable"),
    ):
        connection.execute(
            "UPDATE comparisons SET comparison_json = '{}' WHERE id = ?",
            (comparison_id,),
        )


def test_comparison_remains_readable_after_strategy_archive(tmp_path: Path) -> None:
    database = tmp_path / "ruletrade.sqlite3"
    service, _, candidate, _, _ = _fixture(database)
    comparison = service.create(candidate.id)
    revision = service.candidates.strategies.get_revision_by_id(candidate.base_revision_id)
    service.candidates.strategies.archive_strategy(revision.strategy_id)

    assert service.get(comparison.id) == comparison


def test_persisted_comparison_is_proportional_and_fast(tmp_path: Path) -> None:
    database = tmp_path / "ruletrade.sqlite3"
    service, _, candidate, _, _ = _fixture(database)
    comparison = service.create(candidate.id)
    serialized = json.dumps(comparison.model_dump(mode="json"), separators=(",", ":"))
    assert len(serialized) < 15_000
    assert comparison.compute_ms < 1_000
