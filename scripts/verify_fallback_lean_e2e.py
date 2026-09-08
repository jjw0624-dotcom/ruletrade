from __future__ import annotations

import argparse
import json
from pathlib import Path

from ruletrade.compiler.lean.fallback_e2e import verify_fallback_e2e


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify Fallback LEAN differential E2E")
    parser.add_argument("--log", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument(
        "--fixture", type=Path, default=Path("tests/fixtures/lean-filter-data")
    )
    args = parser.parse_args()
    events, primary, fallback, orders = verify_fallback_e2e(
        args.log.read_text(encoding="utf-8"),
        json.loads(args.result.read_text(encoding="utf-8")),
        args.fixture,
    )
    print(
        f"validated {events} Fallback events; primary={primary}; "
        f"fallback={fallback}; Total Orders={orders}"
    )


if __name__ == "__main__":
    main()
