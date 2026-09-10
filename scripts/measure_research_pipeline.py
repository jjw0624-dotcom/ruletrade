from __future__ import annotations

import argparse
from decimal import Decimal
from pathlib import Path

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
from ruletrade.strategy.v1.fixtures import (
    cooldown_strategy,
    fallback_momentum_strategy,
    filter_screening_strategy,
    golden_portfolio_strategy,
    independent_schedules_strategy,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Execute representative real LEAN Runs and print pipeline diagnostics."
    )
    parser.add_argument(
        "--database",
        type=Path,
        default=Path("build/pipeline-measurements.sqlite3"),
    )
    args = parser.parse_args()
    if args.database.exists():
        parser.error(f"measurement database already exists: {args.database}")

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

    cases = (
        ("Golden", golden_portfolio_strategy(), "golden-synthetic"),
        ("Fallback", fallback_momentum_strategy(), "filter-synthetic"),
        ("Independent Schedules", independent_schedules_strategy(), "filter-synthetic"),
        ("Cooldown", cooldown_strategy(), "cooldown-synthetic"),
        ("Candidate Origin", filter_screening_strategy(), "filter-synthetic"),
    )
    completed = {}
    for name, source, dataset_id in cases:
        revision = strategies.create_strategy(name, source).current_revision
        run = runs.create_and_execute(
            revision.id, BacktestConfig(dataset_id=dataset_id)
        )
        completed[name] = run
        _print_run(name, run)

    origin = completed["Candidate Origin"]
    if origin.status.value != "succeeded":
        raise SystemExit("Candidate Origin Run failed; Candidate/Comparison not measured.")
    source = strategies.get_revision_by_id(origin.revision_id).canonical_strategy
    component = next(item for item in source.graph.components if item.id == "positive_return")
    before = Decimal(str(component.config["threshold"]))
    candidate_execution = candidates.create_and_execute(
        origin.id,
        FilterThresholdChange(
            component_id=component.id,
            expected_before=before,
            proposed_after=before - Decimal("0.01"),
        ),
    )
    candidate = candidate_execution.candidate
    print("\nCandidate")
    for key, value in candidate.diagnostics.model_dump().items():
        print(f"  {key:32} {value:>10}")
    comparison = comparisons.create(candidate.id)
    print("\nComparison")
    print(f"  {'aligned_evidence_records':32} {comparison.aligned_evidence_records:>10}")
    print(
        f"  {'changed_decision_contexts':32} "
        f"{len(comparison.changed_decision_contexts):>10}"
    )
    for key, value in comparison.diagnostics.model_dump().items():
        print(f"  {key:32} {value:>10}")


def _print_run(name, run) -> None:
    print(f"\n{name} [{run.status.value}]")
    for key, value in run.timings.model_dump().items():
        print(f"  {key:32} {value:>10}")
    for key, value in run.diagnostics.model_dump().items():
        print(f"  {key:32} {value:>10}")


if __name__ == "__main__":
    main()
