from __future__ import annotations

import argparse
import json
from pathlib import Path

from ruletrade.compiler.lean.temporal_e2e import parse_temporal_evidence


SEMANTIC_KINDS = {
    "boundary", "event", "remember", "transition", "policy_decision",
    "selection", "allocation", "target", "checkpoint",
}


def _normalized(paths: list[Path]) -> tuple[dict[str, str], ...]:
    result: list[dict[str, str]] = []
    for path in paths:
        for item in parse_temporal_evidence(path.read_text(encoding="utf-8")):
            if item.get("kind") in SEMANTIC_KINDS:
                result.append({key: value for key, value in item.items() if key != "sequence"})
    return tuple(result)


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify composable fresh-process replay")
    parser.add_argument("--continuous-log", type=Path, required=True)
    parser.add_argument("--segment-log", type=Path, action="append", required=True)
    parser.add_argument("--checkpoint", type=Path, action="append", required=True)
    args = parser.parse_args()
    continuous = _normalized([args.continuous_log])
    resumed = _normalized(args.segment_log)
    if resumed != continuous:
        for index, (expected, actual) in enumerate(zip(continuous, resumed)):
            if expected != actual:
                raise SystemExit(f"composable restart mismatch at {index}: {expected!r} != {actual!r}")
        raise SystemExit(f"composable restart count mismatch: {len(continuous)} != {len(resumed)}")
    imports = [
        item for path in args.segment_log
        for item in parse_temporal_evidence(path.read_text(encoding="utf-8"))
        if item.get("kind") == "checkpoint_import"
    ]
    if len(imports) != len(args.checkpoint):
        raise SystemExit("every resumed process must import one composable checkpoint")
    for path, imported in zip(args.checkpoint, imports, strict=True):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if imported.get("integrity_hash") != payload["integrity_hash"]:
            raise SystemExit("composable checkpoint integrity identity mismatch")
    restores = [
        item for path in args.segment_log
        for item in parse_temporal_evidence(path.read_text(encoding="utf-8"))
        if item.get("kind") == "portfolio_restore"
    ]
    if len(restores) != len(args.checkpoint):
        raise SystemExit("each resumed process must reconstitute its portfolio weights")
    if any(item.get("target_kind") != "portfolio" for item in restores):
        raise SystemExit("composable restart restored a non-portfolio target")
    print(
        f"composable_restart_verified records={len(resumed)} imports={len(imports)} "
        f"portfolio_reconstitutions={len(restores)}"
    )


if __name__ == "__main__":
    main()
