from __future__ import annotations

import argparse
import json
from pathlib import Path

from ruletrade.compiler.lean.static_program_e2e import verify_static_program_e2e


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify static Program LEAN differential")
    parser.add_argument("--log", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument(
        "--profile", choices=("direct", "choose", "split", "conditional"), required=True,
    )
    args = parser.parse_args()
    result = verify_static_program_e2e(
        args.log.read_text(encoding="utf-8"),
        json.loads(args.result.read_text(encoding="utf-8")),
        args.fixture, profile=args.profile,
    )
    print(f"validated profile={result.profile} decisions={result.decisions} orders={result.orders}")


if __name__ == "__main__":
    main()
