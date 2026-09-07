from copy import deepcopy
from decimal import Decimal

import pytest
from pydantic import ValidationError

from ruletrade.strategy.v1.fixtures import (
    GOLDEN_PORTFOLIO_PAYLOAD,
    golden_portfolio_strategy,
    golden_stateful_rule_strategy,
)
from ruletrade.strategy.v1.models import CanonicalStrategyV1


def test_golden_fixtures_parse() -> None:
    portfolio = golden_portfolio_strategy()
    stateful = golden_stateful_rule_strategy()

    assert portfolio.api_version == "ruletrade.dev/strategy/v1"
    assert portfolio.definitions.asset_sets[0].assets[0] == "QQQ"
    assert stateful.definitions.state[0].id == "buy_count"


def test_asset_symbols_are_normalized() -> None:
    payload = deepcopy(GOLDEN_PORTFOLIO_PAYLOAD)
    payload["definitions"]["asset_sets"][0]["assets"] = ["qqq", " vgt "]

    strategy = CanonicalStrategyV1.model_validate(payload)

    assert strategy.definitions.asset_sets[0].assets == ["QQQ", "VGT"]


def test_duplicate_component_ids_are_rejected() -> None:
    payload = deepcopy(GOLDEN_PORTFOLIO_PAYLOAD)
    payload["graph"]["components"][1]["id"] = "monthly"

    with pytest.raises(ValidationError, match="component ids must be unique"):
        CanonicalStrategyV1.model_validate(payload)


def test_typed_defaults_are_checked() -> None:
    payload = deepcopy(GOLDEN_PORTFOLIO_PAYLOAD)
    payload["definitions"]["parameters"] = [
        {"id": "lookback", "value_type": "integer", "default": "twenty"}
    ]

    with pytest.raises(ValidationError, match="parameter default does not match"):
        CanonicalStrategyV1.model_validate(payload)


def test_typed_values_are_canonically_normalized() -> None:
    strategy = golden_stateful_rule_strategy()
    buy = strategy.graph.components[1].actions[0]

    assert buy.asset.value == "QQQ"
    assert buy.quantity.value == Decimal("1")
