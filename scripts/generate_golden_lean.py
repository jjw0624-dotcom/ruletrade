from __future__ import annotations

import argparse
from pathlib import Path

from ruletrade.compiler.lean import generate_csharp, lower_to_lean_plan
from ruletrade.strategy.v1.fixtures import golden_portfolio_strategy


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the RuleTrade golden LEAN algorithm")
    parser.add_argument("--output", type=Path, default=Path("build/lean/Main.cs"))
    args = parser.parse_args()

    plan = lower_to_lean_plan(golden_portfolio_strategy())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(generate_csharp(plan), encoding="utf-8")
    print(args.output)


if __name__ == "__main__":
    main()
