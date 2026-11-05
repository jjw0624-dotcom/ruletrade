from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def payload(name: str) -> dict:
    return json.loads((ROOT / "corpus" / name).read_text(encoding="utf-8"))


def test_authoring_commits_use_registered_operations() -> None:
    journeys = payload("perspective-authoring-journeys.json")["journeys"]
    registry = json.loads((ROOT / "docs/architecture/semantic-operation-registry.json").read_text())
    operations = set(registry["canonical_operations"])
    used = {
        step["canonical_operation"]
        for journey in journeys
        for step in journey["steps"]
        if step["canonical_operation"]
    }
    assert used <= operations


def test_conflicts_preserve_drafts_and_never_mutate_before_resolution() -> None:
    cases = payload("perspective-conflict-cases.json")["cases"]
    assert {case["classification"] for case in cases} >= {
        "no_semantic_change", "incomplete_draft", "stale_draft",
        "compatible_semantic_change", "direct_conflict", "dependency_conflict",
        "unsupported_translation",
    }
    assert all(case["draft_preservation"] == "all perspective drafts retained" for case in cases)
    assert all(
        case["canonical_mutation"] == "none until validated resolution"
        for case in cases if case["user_resolution_required"]
    )


def test_translation_support_never_exists_without_registered_operation() -> None:
    contracts = payload("perspective-translation-contracts.json")["contracts"]
    for contract in contracts:
        if contract["reverse"]["status"] == "supported_verified":
            assert contract["reverse"]["typed_operation"]


def test_coverage_uses_original_fragment_denominator() -> None:
    coverage = payload("coverage-and-gap-analysis.json")
    assert coverage["denominator"] == 169
    assert all(item["denominator"] == 169 for item in coverage["coverage"].values())


def test_generated_contracts_are_current() -> None:
    subprocess.run([sys.executable, "scripts/build_perspective_contracts.py", "--check"], cwd=ROOT, check=True)
