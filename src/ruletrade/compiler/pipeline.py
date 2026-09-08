from __future__ import annotations

from collections.abc import Mapping

from ruletrade.compiler.analysis import analyze_strategy_ir
from ruletrade.compiler.frontend import StrategyDesugaringError, lower_strategy_model_to_ir
from ruletrade.compiler.lean.lowering import LeanLoweringError, lower_strategy_ir_to_lean_plan
from ruletrade.compiler.lean.plan import LeanPlan
from ruletrade.ir.strategy import IRValidationError
from ruletrade.strategy.v1.models import CanonicalStrategyV1
from ruletrade.strategy.v1.registry import BUILTIN_REGISTRY, PrimitiveRegistry


def compile_strategy_to_lean_plan(
    strategy: CanonicalStrategyV1,
    registry: PrimitiveRegistry = BUILTIN_REGISTRY,
    *,
    parameter_bindings: Mapping[str, object] | None = None,
) -> LeanPlan:
    """Official one-way Strategy Model → Strategy IR → LeanPlan pipeline."""

    try:
        strategy_ir = lower_strategy_model_to_ir(
            strategy,
            registry,
            parameter_bindings=parameter_bindings,
        )
    except (StrategyDesugaringError, IRValidationError) as exc:
        raise LeanLoweringError(f"unsupported LEAN v0: {exc}") from exc
    requirements = analyze_strategy_ir(strategy_ir)
    return lower_strategy_ir_to_lean_plan(strategy_ir, requirements)
