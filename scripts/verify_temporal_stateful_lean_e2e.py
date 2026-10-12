from __future__ import annotations

import argparse
import json
from pathlib import Path

from ruletrade.compiler.lean.temporal_e2e import verify_temporal_e2e


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify temporal/stateful LEAN differential")
    parser.add_argument("--log", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--fixture", type=Path, default=Path("build/lean/lean-temporal-data"))
    parser.add_argument("--profile", choices=("daily", "multiclock"), default="daily")
    args = parser.parse_args()
    result = verify_temporal_e2e(
        args.log.read_text(encoding="utf-8"),
        json.loads(args.result.read_text(encoding="utf-8")),
        args.fixture,
        profile=args.profile,
    )
    print(result)


if __name__ == "__main__":
    main()
