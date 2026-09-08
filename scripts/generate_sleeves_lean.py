from __future__ import annotations

import argparse
from pathlib import Path

from ruletrade.compiler import compile_strategy_to_lean_plan
from ruletrade.compiler.lean import generate_csharp
from ruletrade.strategy.v1.fixtures import portfolio_sleeves_strategy


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the Portfolio Sleeves LEAN algorithm")
    parser.add_argument("--output", type=Path, default=Path("build/lean/sleeves/Main.cs"))
    args = parser.parse_args()
    plan = compile_strategy_to_lean_plan(portfolio_sleeves_strategy())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(generate_csharp(plan), encoding="utf-8")
    print(args.output)


if __name__ == "__main__":
    main()
