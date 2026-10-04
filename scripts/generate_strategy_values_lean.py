from __future__ import annotations

import argparse
from pathlib import Path

from ruletrade.compiler import compile_strategy_to_lean_plan
from ruletrade.compiler.lean import generate_csharp
from ruletrade.strategy.v1.fixtures import strategy_values_composer_strategy


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the Strategy Values Composer LEAN proof")
    parser.add_argument("--output", type=Path, default=Path("build/lean/strategy-values/Main.cs"))
    args = parser.parse_args()
    source = generate_csharp(compile_strategy_to_lean_plan(strategy_values_composer_strategy()))
    if "CurrentPrice" not in source or "RollingPrice" not in source or "value_condition" not in source:
        raise RuntimeError("Strategy Values proof did not reach executable code generation.")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(source, encoding="utf-8")
    print(args.output)


if __name__ == "__main__":
    main()
