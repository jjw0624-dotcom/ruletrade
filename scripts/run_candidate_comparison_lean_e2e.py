from __future__ import annotations

import argparse
import json
from pathlib import Path

from ruletrade.backtest_runs.models import BacktestRunRecord, BacktestRunStatus
from ruletrade.backtest_runs.service import BacktestRunService
from ruletrade.backtests.lean_runner import DockerLeanRunner
from ruletrade.backtests.models import BacktestConfig
from ruletrade.backtests.service import BacktestService
from ruletrade.candidates.models import FilterThresholdChange
from ruletrade.candidates.service import CandidateService
from ruletrade.comparisons.service import ComparisonService
from ruletrade.persistence import (
    SQLiteBacktestRunRepository,
    SQLiteCandidateRepository,
    SQLiteComparisonRepository,
    SQLiteStrategyRepository,
)
from ruletrade.strategies.service import StrategyService
from ruletrade.strategy.v1.fixtures import filter_screening_strategy


def _require_success(run: BacktestRunRecord, label: str) -> None:
    if run.status != BacktestRunStatus.SUCCEEDED:
        error = None if run.error is None else run.error.model_dump(mode="json")
        raise RuntimeError(f"{label} failed: {error}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run real Candidate numeric-codegen and Comparison acceptance."
    )
    parser.add_argument(
        "--database",
        type=Path,
        default=Path("build/lean/candidate-comparison-e2e/ruletrade.sqlite3"),
    )
    args = parser.parse_args()
    if args.database.exists():
        parser.error(f"acceptance database already exists: {args.database}")

    strategies = StrategyService(SQLiteStrategyRepository(args.database))
    runs = BacktestRunService(
        SQLiteBacktestRunRepository(args.database),
        strategies,
        BacktestService(DockerLeanRunner()),
    )
    candidates = CandidateService(
        SQLiteCandidateRepository(args.database), strategies, runs
    )
    comparisons = ComparisonService(
        SQLiteComparisonRepository(args.database), candidates, runs
    )

    revision = strategies.create_strategy(
        "Candidate negative-threshold acceptance", filter_screening_strategy()
    ).current_revision
    original = runs.create_and_execute(
        revision.id, BacktestConfig(dataset_id="filter-synthetic")
    )
    _require_success(original, "Original Run")
    original_events = runs.list_decision_events(original.id)
    filter_event = next(event for event in original_events if event.kind == "filter")

    execution = candidates.create_and_execute(
        original.id,
        FilterThresholdChange(
            component_id="positive_return",
            field_path="config.threshold",
            expected_before="0",
            proposed_after="-0.01",
        ),
        originating_decision_event_id=filter_event.id,
    )
    _require_success(execution.run, "Candidate Run")
    candidate_events = runs.list_decision_events(execution.run.id)
    if not candidate_events or any(event.schema_version != 2 for event in candidate_events):
        raise RuntimeError("Candidate Run did not persist Decision Evidence v2.")
    comparison = comparisons.create(execution.candidate.id)

    print(
        json.dumps(
            {
                "revision_id": revision.id,
                "original_run_id": original.id,
                "candidate_id": execution.candidate.id,
                "candidate_source_hash": execution.candidate.source_hash,
                "candidate_run_id": execution.run.id,
                "candidate_run_status": execution.run.status.value,
                "candidate_evidence_events": len(candidate_events),
                "comparison_id": comparison.id,
                "changed_decision_contexts": len(
                    comparison.changed_decision_contexts
                ),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
