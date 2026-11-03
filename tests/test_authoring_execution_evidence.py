from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_ui_serializations_are_never_semantic_authorities() -> None:
    payload = json.loads((ROOT / "corpus/representative-ui-serialization-fixtures.json").read_text())
    assert 5 <= len(payload["fixtures"]) <= 10
    assert all(item["semantic_authority"] is False for item in payload["fixtures"])
    actual = next(item for item in payload["fixtures"] if item["id"] == "monthly-qqq-blocky-working-draft")
    assert actual["serialization"]["activeGraphRootIds"] == ["draft:start"]
    assert actual["serialization"]["canvasBlocks"]["draft:asset"]["objectRef"] == "QQQ"


def test_end_to_end_claim_requires_distinct_authoring_and_execution_evidence() -> None:
    payload = json.loads((ROOT / "corpus/authoring-execution-evidence.json").read_text())
    for case in payload["cases"]:
        if case["end_to_end_claim"].startswith("supported_verified"):
            assert "verified" in case["authoring"]["status"]
            assert "docker_verified" in case["execution"]["status"]
