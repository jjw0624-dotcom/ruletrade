from __future__ import annotations

from typing import Mapping

from ruletrade.compiler.frontend.desugar import desugar_strategy
from ruletrade.ir.strategy import StrategyIR, normalize_strategy_ir, validate_strategy_ir
from ruletrade.strategy.v1.models import CanonicalStrategyV1
from ruletrade.strategy.v1.registry import BUILTIN_REGISTRY, PrimitiveRegistry
from ruletrade.strategy.v1.validation import validate_strategy_v1


def lower_strategy_model_to_ir(
    strategy: CanonicalStrategyV1,
    registry: PrimitiveRegistry = BUILTIN_REGISTRY,
    *,
    parameter_bindings: Mapping[str, object] | None = None,
) -> StrategyIR:
    """Run source validation, desugaring, normalization, and IR validation."""

    validate_strategy_v1(strategy, registry)
    strategy_ir = normalize_strategy_ir(
        desugar_strategy(strategy, registry, parameter_bindings=parameter_bindings)
    )
    validate_strategy_ir(strategy_ir)
    return strategy_ir
