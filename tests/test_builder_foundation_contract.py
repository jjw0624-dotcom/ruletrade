from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_state_ownership_matrix_has_one_authority_and_complete_lifecycle() -> None:
    payload = json.loads((ROOT / "docs" / "builder-state-ownership-matrix.json").read_text())
    states = payload["states"]
    assert payload["schema"] == "ruletrade.dev/builder-state-ownership/v1"
    assert len({state["id"] for state in states}) == len(states)
    required = {
        "authority",
        "created_by",
        "mutated_by",
        "observed_by",
        "persistence",
        "cancel",
        "perspective_switch",
        "save_reopen",
        "stale_update",
    }
    assert all(required <= state.keys() for state in states)
    by_id = {state["id"]: state for state in states}
    assert by_id["blockly_workspace"]["authority"] == "native Blockly WorkspaceSvg"
    assert "React never replays draft connections" in by_id["blockly_workspace"]["stale_update"]
    assert by_id["group_definition_draft"]["cancel"] == "no Group and no reference"
    assert by_id["flow_layout"]["authority"] == "React Flow"


def test_required_builder_foundation_documents_exist() -> None:
    required = {
        "builder-foundation-audit.md",
        "builder-responsibility-contract.md",
        "builder-state-ownership-matrix.json",
        "builder-interaction-lifecycle.md",
        "builder-perspective-contract.md",
        "builder-browser-acceptance.md",
    }
    assert required <= {path.name for path in (ROOT / "docs").iterdir()}
