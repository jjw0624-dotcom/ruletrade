from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path

from ruletrade.compiler import compile_strategy_to_lean_plan
from ruletrade.compiler.lean import CSharpGenerationSettings, generate_csharp
from ruletrade.strategy.v1.fixtures import cooldown_strategy


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the Cooldown LEAN algorithm")
    parser.add_argument("--output", type=Path, default=Path("build/lean/cooldown/Main.cs"))
    args = parser.parse_args()
    plan = compile_strategy_to_lean_plan(cooldown_strategy())
    source = generate_csharp(
        plan,
        CSharpGenerationSettings(
            start_date=date(2024, 1, 1),
            end_date=date(2024, 2, 29),
        ),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(source, encoding="utf-8")
    print(args.output)


if __name__ == "__main__":
    main()
