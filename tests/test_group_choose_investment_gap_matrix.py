from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_execution_gap_matrix_names_every_a_through_d_boundary() -> None:
    payload = json.loads(
        (ROOT / "corpus/group-choose-investment-execution-gap-matrix.json").read_text()
    )
    assert payload["schema_version"].endswith("/v1")
    assert [item["id"] for item in payload["profiles"]] == [
        "single_direct_asset",
        "group_choose_investment",
        "parallel_investment_split",
        "conditional_investment",
    ]
    assert all(item["after"] == "backend_lowerable" for item in payload["profiles"])
    assert payload["runtime_and_provider_are_assessed_separately"] is True
    assert "external capital contribution" in payload["unsupported"]
