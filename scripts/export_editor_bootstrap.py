from __future__ import annotations

import argparse
import json
from pathlib import Path

from ruletrade.api import editor_bootstrap


def main() -> None:
    parser = argparse.ArgumentParser(description="Export the backend-owned editor bootstrap fixture")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--example",
        choices=("golden", "momentum", "filter", "fallback", "sleeves", "independent_schedules", "cooldown"),
        default="golden",
    )
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(editor_bootstrap(example=args.example), indent=2, sort_keys=True),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
