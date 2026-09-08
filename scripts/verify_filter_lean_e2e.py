from __future__ import annotations

import argparse
import json
from pathlib import Path

from ruletrade.compiler.lean.filter_e2e import verify_filter_e2e


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify Filter screening LEAN differential E2E")
    parser.add_argument("--log", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument(
        "--fixture", type=Path, default=Path("tests/fixtures/lean-filter-data")
    )
    args = parser.parse_args()
    events, successful, skipped, orders = verify_filter_e2e(
        args.log.read_text(encoding="utf-8"),
        json.loads(args.result.read_text(encoding="utf-8")),
        args.fixture,
    )
    print(
        f"validated {events} Filter events; successful={successful}; "
        f"skipped={skipped}; Total Orders={orders}"
    )


if __name__ == "__main__":
    main()
