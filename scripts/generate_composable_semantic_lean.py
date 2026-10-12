from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path

from ruletrade.compiler.lean import generate_csharp
from ruletrade.compiler.lean.codegen import CSharpGenerationSettings
from ruletrade.compiler.lean.checkpoint import deserialize_checkpoint, validate_checkpoint
from ruletrade.strategy.v2.bridge import compile_v2_strategy_to_lean_plan
from ruletrade.strategy.v2.corpus import (
    composable_semantic_execution_strategy, composable_split_execution_strategy,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate composable SemanticProgramV2 LEAN C#")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--start-date", type=date.fromisoformat, default=date(2024, 1, 2))
    parser.add_argument("--end-date", type=date.fromisoformat, default=date(2024, 12, 31))
    parser.add_argument("--checkpoint", type=Path)
    parser.add_argument("--profile", choices=("integrated", "split"), default="integrated")
    args = parser.parse_args()
    strategy = (
        composable_semantic_execution_strategy() if args.profile == "integrated"
        else composable_split_execution_strategy()
    )
    plan = compile_v2_strategy_to_lean_plan(strategy)
    checkpoint = deserialize_checkpoint(args.checkpoint.read_text(encoding="utf-8")) if args.checkpoint else None
    if checkpoint is not None:
        assert plan.temporal_program is not None
        validate_checkpoint(
            checkpoint, plan.temporal_program,
            strategy_identity=plan.strategy_identity,
            snapshot_id="lean-filter-composable@1", resume_start=args.start_date,
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(generate_csharp(
        plan, CSharpGenerationSettings(
            start_date=args.start_date, end_date=args.end_date,
            snapshot_id="lean-filter-composable@1", temporal_checkpoint=checkpoint,
        ),
    ), encoding="utf-8")
    print(args.output)


if __name__ == "__main__":
    main()
