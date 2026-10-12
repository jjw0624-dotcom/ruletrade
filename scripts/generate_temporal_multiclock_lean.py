from __future__ import annotations

import argparse
from pathlib import Path

from ruletrade.compiler.lean import CSharpGenerationSettings, generate_csharp
from ruletrade.strategy.v2.bridge import compile_v2_strategy_to_lean_plan
from ruletrade.strategy.v2.corpus import temporal_multiclock_strategy


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate bounded weekly/daily temporal LEAN algorithm")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    plan = compile_v2_strategy_to_lean_plan(temporal_multiclock_strategy())
    args.output.write_text(
        generate_csharp(plan, CSharpGenerationSettings(snapshot_id="lean-multiclock-data@1")),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
