from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path

from ruletrade.compiler.lean import CSharpGenerationSettings, generate_csharp
from ruletrade.compiler.lean.checkpoint import deserialize_checkpoint, validate_checkpoint
from ruletrade.strategy.v2.bridge import compile_v2_strategy_to_lean_plan
from ruletrade.strategy.v2.corpus import temporal_breakout_strategy, temporal_multiclock_strategy


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate temporal/stateful LEAN acceptance algorithm")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--profile", choices=("daily", "multiclock"), default="daily")
    parser.add_argument("--start-date", type=date.fromisoformat, default=date(2024, 1, 2))
    parser.add_argument("--end-date", type=date.fromisoformat, default=date(2024, 12, 31))
    parser.add_argument("--checkpoint", type=Path)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    strategy = temporal_multiclock_strategy() if args.profile == "multiclock" else temporal_breakout_strategy()
    plan = compile_v2_strategy_to_lean_plan(strategy)
    snapshot_id = "lean-multiclock-data@1" if args.profile == "multiclock" else "lean-temporal-data@1"
    checkpoint = deserialize_checkpoint(args.checkpoint.read_text(encoding="utf-8")) if args.checkpoint else None
    if checkpoint is not None:
        assert plan.temporal_program is not None
        validate_checkpoint(
            checkpoint, plan.temporal_program,
            strategy_identity=plan.strategy_identity,
            snapshot_id=snapshot_id,
            resume_start=args.start_date,
        )
    settings = CSharpGenerationSettings(
        start_date=args.start_date,
        end_date=args.end_date,
        snapshot_id=snapshot_id,
        temporal_checkpoint=checkpoint,
    )
    args.output.write_text(generate_csharp(plan, settings), encoding="utf-8")


if __name__ == "__main__":
    main()
