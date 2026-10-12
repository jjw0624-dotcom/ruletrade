from __future__ import annotations

import argparse
from pathlib import Path

from ruletrade.compiler.lean.checkpoint import checkpoint_from_evidence, serialize_checkpoint
from ruletrade.compiler.lean.temporal_e2e import parse_temporal_evidence


def main() -> None:
    parser = argparse.ArgumentParser(description="Export a sealed temporal checkpoint from LEAN evidence")
    parser.add_argument("--log", type=Path, required=True)
    parser.add_argument("--cutoff", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    checkpoints = [
        item for item in parse_temporal_evidence(args.log.read_text(encoding="utf-8"))
        if item.get("kind") == "checkpoint" and item.get("cutoff") == args.cutoff
    ]
    if len(checkpoints) != 1:
        raise SystemExit(f"expected one checkpoint at {args.cutoff}, got {len(checkpoints)}")
    checkpoint = checkpoint_from_evidence(checkpoints[0])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(serialize_checkpoint(checkpoint) + "\n", encoding="utf-8")
    print(f"{args.cutoff} {checkpoint.integrity_hash}")


if __name__ == "__main__":
    main()
