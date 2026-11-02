#!/usr/bin/env python3
"""Validate that capability claims remain traceable and conservatively classified."""
from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "corpus" / "ruletrade-capability-evidence.json"
ALLOWED = {"PASS", "PARTIAL", "UNSUPPORTED", "UNKNOWN", "NOT_APPLICABLE"}
REQUIRED_DIMENSIONS = {
    "representable",
    "authorable",
    "persistable",
    "reference_evaluable",
    "lowerable",
    "docker_verified",
    "api_executable",
    "browser_verified",
}
REQUIRED_FAMILIES = {
    "single-asset-monthly",
    "strongest-etfs",
    "growth-defensive",
    "weighted-score",
    "temporal-stateful",
    "multi-clock",
}


def fail(message: str) -> None:
    raise SystemExit(f"capability evidence invalid: {message}")


def validate_evidence(owner: str, entries: list[dict[str, object]]) -> None:
    if not entries:
        fail(f"{owner} has no evidence")
    for entry in entries:
        raw_path = entry.get("path")
        if not isinstance(raw_path, str) or not raw_path:
            fail(f"{owner} has evidence without a path")
        path = ROOT / raw_path
        if not path.is_file():
            fail(f"{owner} references missing {raw_path}")
        symbol = entry.get("symbol")
        if symbol is not None:
            if not isinstance(symbol, str) or not symbol:
                fail(f"{owner} has an invalid symbol for {raw_path}")
            if symbol not in path.read_text(encoding="utf-8"):
                fail(f"{owner} symbol {symbol!r} is absent from {raw_path}")


def main() -> None:
    data = json.loads(MATRIX.read_text(encoding="utf-8"))
    if data.get("schema_version") != "ruletrade.dev/capability-evidence/v1":
        fail("unexpected schema_version")
    if set(data.get("dimensions", [])) != REQUIRED_DIMENSIONS:
        fail("dimension set drifted")

    claims = data.get("claims")
    if not isinstance(claims, list) or not claims:
        fail("claims must be a non-empty list")
    ids: set[str] = set()
    for claim in claims:
        claim_id = claim.get("id")
        if not isinstance(claim_id, str) or not claim_id or claim_id in ids:
            fail(f"invalid or duplicate claim id {claim_id!r}")
        ids.add(claim_id)
        capabilities = claim.get("capabilities")
        if not isinstance(capabilities, dict) or set(capabilities) != REQUIRED_DIMENSIONS:
            fail(f"{claim_id} does not classify every dimension")
        invalid = {value for value in capabilities.values() if value not in ALLOWED}
        if invalid:
            fail(f"{claim_id} uses invalid statuses {sorted(invalid)}")
        validate_evidence(claim_id, claim.get("evidence", []))
        if "PASS" in capabilities.values() and not claim.get("limits"):
            fail(f"{claim_id} must record its support boundary")

    families = data.get("representative_strategies")
    if not isinstance(families, list):
        fail("representative_strategies must be a list")
    family_ids = {item.get("id") for item in families}
    if family_ids != REQUIRED_FAMILIES:
        fail(f"representative family set drifted: {sorted(str(item) for item in family_ids)}")
    for family in families:
        family_id = str(family["id"])
        statuses = family.get("statuses")
        if not isinstance(statuses, dict) or not statuses:
            fail(f"{family_id} has no status matrix")
        invalid = {value for value in statuses.values() if value not in ALLOWED}
        if invalid:
            fail(f"{family_id} uses invalid statuses {sorted(invalid)}")
        validate_evidence(family_id, family.get("evidence", []))
        if not family.get("data_provenance"):
            fail(f"{family_id} has no data provenance")

    print(f"validated {len(claims)} capability claims and {len(families)} strategy families")


if __name__ == "__main__":
    main()
