from __future__ import annotations

import ast
import json
from pathlib import Path


ROOT = Path(__file__).parents[1]
V2 = ROOT / "src/ruletrade/strategy/v2"
GRAPH = ROOT / "docs/engine/v1-v2-dependency-graph.json"
RETIREMENT = ROOT / "docs/engine/v1-retirement-inventory.json"


def _imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    result: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            result.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            result.add(node.module)
    return result


def test_v2_semantic_validation_and_evaluation_do_not_import_v1() -> None:
    independent = {
        "daily_values.py",
        "daily_provider.py",
        "execution.py",
        "execution_capability.py",
        "execution_profiles.py",
        "perspectives.py",
        "program_execution.py",
        "program_validation.py",
        "projections.py",
        "semantic_types.py",
        "validation.py",
    }
    violations = {
        name: sorted(
            item for item in _imports(V2 / name)
            if item == "ruletrade.strategy.v1" or item.startswith("ruletrade.strategy.v1.")
        )
        for name in independent
    }
    assert not {name: imports for name, imports in violations.items() if imports}


def test_current_v1_dependencies_are_explicitly_inventory_backed() -> None:
    actual = {
        path.name
        for path in V2.glob("*.py")
        if any(
            item == "ruletrade.strategy.v1" or item.startswith("ruletrade.strategy.v1.")
            for item in _imports(path)
        )
    }
    inventory = json.loads(RETIREMENT.read_text(encoding="utf-8"))
    declared = {
        item["source"].rsplit("/", 1)[-1]
        for item in inventory["items"]
        if item["source"].startswith("src/ruletrade/strategy/v2/")
        and item["classification"] in {"compatibility_adapter", "temporary_bridge", "shared_model_debt"}
    }
    assert actual == declared


def test_dependency_graph_has_required_engine_boundaries() -> None:
    graph = json.loads(GRAPH.read_text(encoding="utf-8"))
    assert graph["schema_version"] == 1
    node_ids = {item["id"] for item in graph["nodes"]}
    assert {
        "v2_semantics", "v2_validation", "v2_authoring", "v2_reference",
        "v2_lowering", "lean_plan", "lean_codegen", "docker_lean",
        "persistence", "compatibility_v1",
    } <= node_ids
    edge_pairs = {(item["from"], item["to"]) for item in graph["edges"]}
    assert ("v2_validation", "v2_semantics") in edge_pairs
    assert ("v2_lowering", "compatibility_v1") in edge_pairs
    assert ("lean_codegen", "lean_plan") in edge_pairs


def test_shared_lean_plan_and_codegen_do_not_import_strategy_versions() -> None:
    paths = (
        ROOT / "src/ruletrade/compiler/lean/plan.py",
        ROOT / "src/ruletrade/compiler/lean/codegen.py",
        ROOT / "src/ruletrade/adapters/lean/runtime.py",
    )
    violations = {
        str(path.relative_to(ROOT)): sorted(
            item for item in _imports(path)
            if item.startswith("ruletrade.strategy.v1") or item.startswith("ruletrade.strategy.v2")
        )
        for path in paths
    }
    assert not {path: imports for path, imports in violations.items() if imports}
