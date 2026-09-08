from copy import deepcopy
from dataclasses import replace
from decimal import Decimal
from typing import Any, cast

import pytest

from ruletrade.compiler.frontend import lower_strategy_model_to_ir
from ruletrade.ir.strategy import (
    AssetSetOp,
    EqualWeightOp,
    IRValidationError,
    MonthlyScheduleOp,
    RandomNOp,
    StrategyIR,
    validate_strategy_ir,
)
from ruletrade.strategy.v1.fixtures import GOLDEN_PORTFOLIO_PAYLOAD, golden_portfolio_strategy
from ruletrade.strategy.v1.models import CanonicalStrategyV1


def test_golden_strategy_model_desugars_to_typed_strategy_ir() -> None:
    strategy = golden_portfolio_strategy()
    strategy_ir = lower_strategy_model_to_ir(strategy)
    operations = {operation.id: operation for operation in strategy_ir.operations}

    assert strategy_ir.strategy_identity.startswith("sha256:")
    assert len(strategy_ir.operations) == len(strategy.graph.components)
    assert isinstance(operations["monthly"], MonthlyScheduleOp)
    assert operations["growth_assets"] == AssetSetOp(
        id="growth_assets",
        symbols=("QQQ", "VGT", "SOXX", "SCHG"),
        provenance=operations["growth_assets"].provenance,
    )
    assert operations["growth_random"] == RandomNOp(
        id="growth_random",
        assets="growth_assets",
        count=2,
        resample="per_event",
        parameter_bindings_json="{}",
        provenance=operations["growth_random"].provenance,
    )
    assert operations["growth_weights"] == EqualWeightOp(
        id="growth_weights",
        assets="growth_random",
        total_weight=Decimal("0.70"),
        provenance=operations["growth_weights"].provenance,
    )
    assert strategy_ir.entrypoints[0].event == "monthly"
    assert strategy_ir.entrypoints[0].target == "rebalance"
    assert [operation.id for operation in strategy_ir.operations] == sorted(
        operation.id for operation in strategy_ir.operations
    )


def test_ir_operations_retain_source_component_provenance() -> None:
    strategy_ir = lower_strategy_model_to_ir(golden_portfolio_strategy())

    assert all(
        operation.provenance.component_id == operation.id
        for operation in strategy_ir.operations
    )


def test_ir_preserves_once_and_normalized_parameter_bindings() -> None:
    payload = deepcopy(GOLDEN_PORTFOLIO_PAYLOAD)
    payload["definitions"]["parameters"] = [
        {"id": "selection_count", "value_type": "integer", "default": 2}
    ]
    payload["graph"]["components"][2]["config"]["resample"] = "once"
    strategy_ir = lower_strategy_model_to_ir(
        CanonicalStrategyV1.model_validate(payload),
        parameter_bindings={"selection_count": 3},
    )
    operation = next(item for item in strategy_ir.operations if item.id == "growth_random")

    assert isinstance(operation, RandomNOp)
    assert operation.resample == "once"
    assert operation.parameter_bindings_json == '{"selection_count":3}'


def test_ir_validation_rejects_operand_type_mismatch() -> None:
    strategy_ir = lower_strategy_model_to_ir(golden_portfolio_strategy())
    operations = tuple(
        replace(operation, assets="monthly")
        if isinstance(operation, EqualWeightOp) and operation.id == "safe_weights"
        else operation
        for operation in strategy_ir.operations
    )

    with pytest.raises(IRValidationError, match="expected asset_set, got event"):
        validate_strategy_ir(replace(strategy_ir, operations=operations))


def test_ir_validation_rejects_unknown_operation_kind() -> None:
    strategy_ir = StrategyIR(
        strategy_identity="sha256:test",
        operations=(cast(Any, object()),),
        entrypoints=(),
    )

    with pytest.raises(IRValidationError, match="unknown IR operation"):
        validate_strategy_ir(strategy_ir)
