from __future__ import annotations

import argparse
import json
from pathlib import Path

from ruletrade.backtests.lean_runner import DockerLeanRunner


def main() -> None:
    parser = argparse.ArgumentParser(description="Run compiler-generated C# through Docker LEAN")
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--dataset-id", default="golden-synthetic")
    args = parser.parse_args()

    artifact = DockerLeanRunner().run(
        args.source.read_text(encoding="utf-8"),
        dataset_id=args.dataset_id,
    )
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "lean.log").write_text(artifact.log_text, encoding="utf-8")
    (args.output_dir / "backtest-result.json").write_text(
        json.dumps(artifact.result_payload, indent=2),
        encoding="utf-8",
    )
    print(args.output_dir)


if __name__ == "__main__":
    main()
