from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_every_acceptance_strategy_has_two_natural_construction_orders() -> None:
    payload = json.loads((ROOT / "corpus/intent-authoring-user-actions.json").read_text())
    by_strategy: dict[str, set[str]] = {}
    for journey in payload["journeys"]:
        by_strategy.setdefault(journey["strategy"], set()).add(journey["start_path"])
        assert journey["steps"]
        for step in journey["steps"]:
            assert set(step) == {
                "action", "view", "draft_object", "unresolved", "visible",
                "commit", "capability", "next",
            }
    assert set(by_strategy) == {"Invest in QQQ every month", "A", "B", "C", "D", "E"}
    assert all(len(paths) >= 2 for paths in by_strategy.values())


def test_capability_matrix_is_explicit_and_never_calls_contribution_rebalance() -> None:
    payload = json.loads((ROOT / "corpus/intent-authoring-capability-matrix.json").read_text())
    dimensions = set(payload["dimensions"])
    assert dimensions == {
        "draft", "semantic", "representable", "reference_evaluable",
        "backend_lowerable", "docker_verified", "provider_supported",
    }
    intents = {entry["id"]: entry for entry in payload["intents"]}
    assert intents["single_asset_contribution"]["draft"] == "unsupported"
    assert "never become rebalance" in intents["single_asset_contribution"]["note"]
    assert intents["weighted_score"]["docker_verified"] is True
    assert intents["temporal_sequence"]["docker_verified"] is True
    assert intents["multi_clock_policy"]["docker_verified"] is True
