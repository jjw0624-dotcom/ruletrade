from __future__ import annotations

import argparse
import json
from pathlib import Path

from ruletrade.compiler.lean.independent_schedules_e2e import (
    verify_independent_schedules_e2e,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify Independent Schedules LEAN output")
    parser.add_argument("--log", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--fixture", type=Path, default=Path("tests/fixtures/lean-filter-data"))
    args = parser.parse_args()
    refreshes, portfolio_events, primary, orders = verify_independent_schedules_e2e(
        args.log.read_text(encoding="utf-8"),
        json.loads(args.result.read_text(encoding="utf-8")),
        args.fixture,
    )
    print(
        f"validated {refreshes} sleeve refreshes and {portfolio_events} portfolio events; "
        f"growth primary={primary}; Total Orders={orders}"
    )


if __name__ == "__main__":
    main()
