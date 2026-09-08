from __future__ import annotations

import argparse
import json
from pathlib import Path

from ruletrade.compiler.lean.e2e import validate_golden_e2e


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify a Golden Strategy LEAN backtest")
    parser.add_argument("--log", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--expected-events", type=int, default=12)
    parser.add_argument("--expected-first-event", default="2024-01-02")
    args = parser.parse_args()

    validation = validate_golden_e2e(
        args.log.read_text(encoding="utf-8", errors="replace"),
        json.loads(args.result.read_text(encoding="utf-8")),
        expected_events=args.expected_events,
        expected_first_event=args.expected_first_event,
    )
    print(
        f"validated {validation.monthly_events} monthly events; "
        f"Total Orders={validation.total_orders}; "
        f"interest-rate warning={validation.interest_rate_fixture_warning}"
    )


if __name__ == "__main__":
    main()
