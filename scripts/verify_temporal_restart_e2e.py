from __future__ import annotations

import argparse
import json
from pathlib import Path

from ruletrade.compiler.lean.temporal_e2e import parse_temporal_evidence


SEMANTIC_KINDS = {
    "boundary", "event", "remember", "transition", "policy_decision", "target", "checkpoint",
}


def _normalized(paths: list[Path]) -> tuple[dict[str, str], ...]:
    records = []
    for path in paths:
        records.extend(parse_temporal_evidence(path.read_text(encoding="utf-8")))
    selected = []
    for item in records:
        if item.get("kind") not in SEMANTIC_KINDS:
            continue
        selected.append({key: value for key, value in item.items() if key != "sequence"})
    return tuple(selected)


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify fresh-process temporal checkpoint replay")
    parser.add_argument("--continuous-log", type=Path, required=True)
    parser.add_argument("--segment-log", type=Path, action="append", required=True)
    parser.add_argument("--checkpoint", type=Path, action="append", required=True)
    args = parser.parse_args()
    expected = _normalized([args.continuous_log])
    resumed = _normalized(args.segment_log)
    if resumed != expected:
        for index, (left, right) in enumerate(zip(expected, resumed)):
            if left != right:
                raise SystemExit(f"restart semantic mismatch at record {index}: {left!r} != {right!r}")
        raise SystemExit(f"restart semantic record count mismatch: {len(expected)} != {len(resumed)}")

    imports = [
        item
        for path in args.segment_log
        for item in parse_temporal_evidence(path.read_text(encoding="utf-8"))
        if item.get("kind") == "checkpoint_import"
    ]
    if len(imports) != len(args.checkpoint):
        raise SystemExit("every fresh LEAN process must emit one checkpoint import")
    for path, imported in zip(args.checkpoint, imports, strict=True):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if imported.get("integrity_hash") != payload["integrity_hash"]:
            raise SystemExit("imported checkpoint integrity identity mismatch")

    restores = [
        item
        for path in args.segment_log
        for item in parse_temporal_evidence(path.read_text(encoding="utf-8"))
        if item.get("kind") == "portfolio_restore"
    ]
    if len(restores) != 1 or restores[0].get("classification") != "brokerage_reconstitution":
        raise SystemExit("post-fill restart must explicitly classify portfolio reconstitution")
    continuous_orders = [
        item for item in parse_temporal_evidence(args.continuous_log.read_text(encoding="utf-8"))
        if item.get("kind") == "order"
    ]
    post_fill_orders = [
        item for item in parse_temporal_evidence(args.segment_log[-1].read_text(encoding="utf-8"))
        if item.get("kind") == "order"
    ]
    if not continuous_orders:
        raise SystemExit("continuous LEAN run emitted no actual fill")
    if not post_fill_orders:
        raise SystemExit("post-fill fresh process emitted no brokerage reconstitution fill")
    if any(item.get("symbol") != "QQQ" for item in (*continuous_orders, *post_fill_orders)):
        raise SystemExit("restart order/fill symbol mismatch")
    print(
        f"restart_replay_verified boundaries={sum(item.get('kind') == 'boundary' for item in resumed)} "
        f"imports={len(imports)} portfolio_reconstitutions={len(restores)} "
        f"continuous_fills={len(continuous_orders)} restored_fills={len(post_fill_orders)}"
    )


if __name__ == "__main__":
    main()
