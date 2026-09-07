from copy import deepcopy

import pytest

from ruletrade.strategy.v1.fixtures import (
    GOLDEN_PORTFOLIO_PAYLOAD,
    GOLDEN_STATEFUL_RULE_PAYLOAD,
    golden_portfolio_strategy,
    golden_stateful_rule_strategy,
)
from ruletrade.strategy.v1.models import CanonicalStrategyV1
from ruletrade.strategy.v1.validation import (
    StrategySemanticError,
    collect_semantic_issues,
    validate_strategy_v1,
)


def test_golden_portfolio_is_semantically_valid() -> None:
    validate_strategy_v1(golden_portfolio_strategy())


def test_golden_stateful_rule_is_semantically_valid() -> None:
    validate_strategy_v1(golden_stateful_rule_strategy())


def test_unknown_asset_set_reference_is_reported() -> None:
    payload = deepcopy(GOLDEN_PORTFOLIO_PAYLOAD)
    payload["graph"]["components"][1]["config"]["asset_set_ref"] = "missing"
    strategy = CanonicalStrategyV1.model_validate(payload)

    issues = collect_semantic_issues(strategy)

    assert any("unknown asset set" in issue.message for issue in issues)


def test_port_type_mismatch_is_reported() -> None:
    payload = deepcopy(GOLDEN_PORTFOLIO_PAYLOAD)
    payload["graph"]["connections"][0]["target"] = {
        "component_id": "rebalance",
        "port": "targets",
    }
    strategy = CanonicalStrategyV1.model_validate(payload)

    with pytest.raises(StrategySemanticError, match="port type mismatch"):
        validate_strategy_v1(strategy)


def test_rule_action_units_are_checked() -> None:
    payload = deepcopy(GOLDEN_STATEFUL_RULE_PAYLOAD)
    payload["graph"]["components"][1]["actions"][0]["quantity"]["value_type"] = "money"
    strategy = CanonicalStrategyV1.model_validate(payload)

    with pytest.raises(StrategySemanticError, match="expected shares, got money"):
        validate_strategy_v1(strategy)


def test_unknown_state_reference_is_reported() -> None:
    payload = deepcopy(GOLDEN_STATEFUL_RULE_PAYLOAD)
    payload["graph"]["components"][1]["condition"]["left"]["state_id"] = "missing"
    strategy = CanonicalStrategyV1.model_validate(payload)

    with pytest.raises(StrategySemanticError, match="unknown state"):
        validate_strategy_v1(strategy)


def test_component_cycles_are_reported() -> None:
    payload = deepcopy(GOLDEN_PORTFOLIO_PAYLOAD)
    payload["graph"]["connections"].append(
        {
            "source": {"component_id": "targets", "port": "targets"},
            "target": {"component_id": "targets", "port": "left"},
        }
    )
    strategy = CanonicalStrategyV1.model_validate(payload)

    with pytest.raises(StrategySemanticError, match="contains a cycle"):
        validate_strategy_v1(strategy)
