from copy import deepcopy

import pytest

from ruletrade.compiler import compile_strategy_to_lean_plan
from ruletrade.compiler.lean.lowering import LeanLoweringError
from ruletrade.strategy.v1.fixtures import GOLDEN_PORTFOLIO_PAYLOAD, golden_stateful_rule_strategy
from ruletrade.strategy.v1.models import CanonicalStrategyV1


def test_compiler_v0_rejects_stateful_rule_without_expanding_scope() -> None:
    with pytest.raises(LeanLoweringError, match="rule.condition_actions"):
        compile_strategy_to_lean_plan(golden_stateful_rule_strategy())


def test_compiler_v0_rejects_unsupported_monthly_day() -> None:
    payload = deepcopy(GOLDEN_PORTFOLIO_PAYLOAD)
    payload["graph"]["components"][0]["config"]["day"] = 15

    with pytest.raises(LeanLoweringError, match="first trading day"):
        compile_strategy_to_lean_plan(CanonicalStrategyV1.model_validate(payload))


def test_compiler_v0_rejects_random_count_larger_than_asset_set() -> None:
    payload = deepcopy(GOLDEN_PORTFOLIO_PAYLOAD)
    payload["graph"]["components"][2]["config"]["count"] = 5

    with pytest.raises(LeanLoweringError, match="cannot exceed"):
        compile_strategy_to_lean_plan(CanonicalStrategyV1.model_validate(payload))
