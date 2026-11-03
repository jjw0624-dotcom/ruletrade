from __future__ import annotations

import ast
from pathlib import Path

import pytest

from ruletrade.strategy.v1.fixtures import golden_portfolio_strategy
from ruletrade.strategy.v1.models import CanonicalStrategyV1
from ruletrade.strategy.v2.authoring import ProgramStrategyTemplateRequest, create_program_strategy_template
from ruletrade.strategy.v2.models import CanonicalStrategyV2
from ruletrade.strategy.versioning import parse_canonical_strategy


def test_v2_model_module_has_no_v1_import() -> None:
    path = Path(__file__).parents[1] / "src/ruletrade/strategy/v2/models.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    modules = {
        node.module for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module
    }
    assert not any(item.startswith("ruletrade.strategy.v1") for item in modules)


def test_version_boundary_reads_explicit_and_historical_payloads() -> None:
    v1 = golden_portfolio_strategy()
    v2 = create_program_strategy_template(ProgramStrategyTemplateRequest(name="V2"))
    assert isinstance(parse_canonical_strategy(v1.model_dump(mode="json")), CanonicalStrategyV1)
    historical = v1.model_dump(mode="json")
    historical.pop("api_version")
    assert isinstance(parse_canonical_strategy(historical), CanonicalStrategyV1)
    assert isinstance(parse_canonical_strategy(v2.model_dump(mode="json")), CanonicalStrategyV2)


def test_version_boundary_rejects_unknown_versions() -> None:
    with pytest.raises(ValueError, match="unsupported canonical api_version"):
        parse_canonical_strategy({"api_version": "ruletrade.dev/strategy/v3"})
