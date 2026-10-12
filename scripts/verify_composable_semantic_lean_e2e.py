from __future__ import annotations

import argparse
import json
from pathlib import Path

from ruletrade.compiler.lean.composable_e2e import verify_composable_e2e


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify composable semantic LEAN differential")
    parser.add_argument("--log", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--profile", choices=("integrated", "split"), default="integrated")
    args = parser.parse_args()
    result = verify_composable_e2e(
        args.log.read_text(encoding="utf-8"),
        json.loads(args.result.read_text(encoding="utf-8")), args.fixture,
        profile=args.profile,
    )
    print(
        f"validated boundaries={result.boundaries} selections={result.selections} "
        f"allocations={result.allocations} checkpoints={result.checkpoints} "
        f"orders={result.orders}"
    )


if __name__ == "__main__":
    main()
