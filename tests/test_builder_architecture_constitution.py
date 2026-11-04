import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load(path: str) -> dict:
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def test_every_builder_state_has_one_owner_and_hash_contract() -> None:
    states = load("docs/builder/state-ownership.json")["states"]
    assert len({state["id"] for state in states}) == len(states)
    assert all(state["owner"] and isinstance(state["affects_semantic_hash"], bool) for state in states)
    visual = {state["id"]: state for state in states if state["id"] in {"perspective_draft", "blocky_visual", "flow_visual", "navigation"}}
    assert visual and all(not state["affects_semantic_hash"] for state in visual.values())


def test_every_invariant_has_traceable_test_mapping() -> None:
    markdown = (ROOT / "docs/builder/architecture-invariants.md").read_text(encoding="utf-8")
    mapped = load("docs/builder/contract-test-map.json")["invariants"]
    ids = {item["id"] for item in mapped}
    assert ids == {f"BARCH-{index:03d}" for index in range(1, 16)}
    assert all(item_id in markdown for item_id in ids)
    assert all(item["source"] and item["tests"] and item["evidence"] for item in mapped)


def test_gap_matrix_never_marks_unproven_browser_behavior_verified() -> None:
    gaps = load("docs/builder/implementation-gap-matrix.json")["gaps"]
    assert any(gap["status"] == "missing" for gap in gaps)
    test_map = load("docs/builder/contract-test-map.json")["invariants"]
    for item in test_map:
        if item["status"] == "verified" and "browser" in item["evidence"]:
            assert any(path == "scripts/check_builder_browser.mjs" for path in item["tests"])
