from __future__ import annotations

import argparse
from pathlib import Path

from ruletrade.compiler.lean import generate_csharp
from ruletrade.strategy.v2.bridge import compile_v2_strategy_to_lean_plan
from ruletrade.strategy.v2.execution_profiles import production_execution_profile


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Group/Choose/Investment LEAN C#")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--profile", choices=("direct", "choose", "split", "conditional"),
        default="direct",
    )
    args = parser.parse_args()
    plan = compile_v2_strategy_to_lean_plan(production_execution_profile(args.profile))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(generate_csharp(plan), encoding="utf-8")
    print(args.output)


if __name__ == "__main__":
    main()
