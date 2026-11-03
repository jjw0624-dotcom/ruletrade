from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).parents[1]


def test_capability_evidence_keeps_support_dimensions_independent() -> None:
    matrix = json.loads(
        (ROOT / "corpus" / "ruletrade-capability-evidence.json").read_text(encoding="utf-8")
    )
    claims = {item["id"]: item for item in matrix["claims"]}

    v2 = claims["semantic-program-v2-authority"]["capabilities"]
    assert v2["representable"] == "PASS"
    assert v2["persistable"] == "PASS"
    assert v2["api_executable"] == "PARTIAL"

    transient = claims["v2-transient-lean-api"]["capabilities"]
    persisted = claims["persisted-run-lifecycle"]["capabilities"]
    assert transient["api_executable"] == "PASS"
    assert transient["persistable"] == "UNSUPPORTED"
    assert persisted["persistable"] == "PASS"
    assert "V1" in claims["persisted-run-lifecycle"]["summary"]

    ai = claims["ai-perspective"]["capabilities"]
    assert ai["api_executable"] == "UNSUPPORTED"
    assert ai["browser_verified"] != "PASS"


def test_representative_matrix_does_not_infer_product_closure_from_docker() -> None:
    matrix = json.loads(
        (ROOT / "corpus" / "ruletrade-capability-evidence.json").read_text(encoding="utf-8")
    )
    strategies = {item["id"]: item for item in matrix["representative_strategies"]}

    assert len(strategies) == 6
    for strategy in strategies.values():
        assert strategy["statuses"]["docker_lean"] == "PASS"
        assert strategy["statuses"]["api_result_retrieval"] == "PARTIAL"
        assert strategy["statuses"]["frontend_display"] == "PARTIAL"
        assert strategy["data_provenance"]
