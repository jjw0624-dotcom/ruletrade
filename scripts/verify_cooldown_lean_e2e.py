from __future__ import annotations

import argparse
import json
from pathlib import Path

from ruletrade.compiler.lean.cooldown_e2e import verify_cooldown_e2e


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify Cooldown LEAN output")
    parser.add_argument("--log", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument(
        "--fixture",
        type=Path,
        default=Path("tests/fixtures/lean-cooldown-data"),
    )
    args = parser.parse_args()
    events, orders, reentry = verify_cooldown_e2e(
        args.log.read_text(encoding="utf-8"),
        json.loads(args.result.read_text(encoding="utf-8")),
        args.fixture,
    )
    print(f"validated {events} Cooldown events; re-entry={reentry}; Total Orders={orders}")


if __name__ == "__main__":
    main()
