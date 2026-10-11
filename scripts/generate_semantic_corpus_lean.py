from __future__ import annotations

import argparse
from pathlib import Path

from ruletrade.compiler.lean import generate_csharp
from ruletrade.strategy.v2.bridge import compile_v2_strategy_to_lean_plan
from ruletrade.strategy.v2.corpus import strongest_etfs_strategy


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate LEAN C# from the executable SemanticProgramV2 corpus profile",
    )
    parser.add_argument(
        "--output", type=Path,
        default=Path("build/lean/semantic-corpus/Main.cs"),
    )
    args = parser.parse_args()
    plan = compile_v2_strategy_to_lean_plan(strongest_etfs_strategy())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(generate_csharp(plan), encoding="utf-8")
    print(args.output)


if __name__ == "__main__":
    main()
