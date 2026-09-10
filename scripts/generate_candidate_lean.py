from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from pathlib import Path
from tempfile import TemporaryDirectory

from ruletrade.backtest_runs.service import BacktestRunService
from ruletrade.backtests.lean_runner import LeanRunArtifact, LeanRunnerTimings
from ruletrade.backtests.models import BacktestConfig
from ruletrade.backtests.service import BacktestService
from ruletrade.candidates.models import FilterThresholdChange
from ruletrade.candidates.service import CandidateService
from ruletrade.compiler import compile_strategy_to_lean_plan
from ruletrade.compiler.lean import CSharpGenerationSettings, generate_csharp
from ruletrade.persistence import (
    SQLiteBacktestRunRepository,
    SQLiteCandidateRepository,
    SQLiteStrategyRepository,
)
from ruletrade.strategies.service import StrategyService
from ruletrade.strategy.v1.fixtures import filter_screening_strategy


@dataclass
class CaptureRunner:
    """Capture official generated source while returning deterministic Run artifacts."""

    image: str = "ruletrade/candidate-codegen-capture"
    generated_sources: list[str] = field(default_factory=list)

    def run(self, generated_csharp: str, *, dataset_id: str) -> LeanRunArtifact:
        self.generated_sources.append(generated_csharp)
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
            timings=LeanRunnerTimings(),
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate C# from a persisted and reopened negative-threshold Candidate."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("build/lean/candidate-ci/Main.cs"),
    )
    args = parser.parse_args()

    with TemporaryDirectory() as directory:
        database = Path(directory) / "ruletrade.sqlite3"
        strategies = StrategyService(SQLiteStrategyRepository(database))
        capture = CaptureRunner()
        runs = BacktestRunService(
            SQLiteBacktestRunRepository(database),
            strategies,
            BacktestService(capture),
        )
        candidates = CandidateService(
            SQLiteCandidateRepository(database), strategies, runs
        )
        revision = strategies.create_strategy(
            "Candidate codegen regression", filter_screening_strategy()
        ).current_revision
        config = BacktestConfig(dataset_id="filter-synthetic")
        original = runs.create_and_execute(revision.id, config)
        execution = candidates.create_and_execute(
            original.id,
            FilterThresholdChange(
                component_id="positive_return",
                field_path="config.threshold",
                expected_before="0",
                proposed_after="-0.01",
            ),
            originating_decision_event_id="event-000001",
        )
        reopened = candidates.get(execution.candidate.id)
        if reopened.candidate != execution.candidate:
            raise RuntimeError("Persisted Candidate changed after reopening.")
        plan = compile_strategy_to_lean_plan(reopened.candidate.canonical_strategy)
        generated = generate_csharp(
            plan,
            CSharpGenerationSettings(
                start_date=config.start_date,
                end_date=config.end_date,
                initial_cash=config.initial_cash,
            ),
        )
        if generated != capture.generated_sources[1]:
            raise RuntimeError("Reopened Candidate did not reproduce its executed C# source.")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(generated, encoding="utf-8")
    print(args.output)


if __name__ == "__main__":
    main()
