from collections.abc import Mapping
from typing import TYPE_CHECKING

from ruletrade.compiler.lean.codegen import CSharpGenerationSettings, generate_csharp
from ruletrade.compiler.lean.lowering import LeanLoweringError, lower_strategy_ir_to_lean_plan
from ruletrade.compiler.lean.plan import LeanPlan, normalize_lean_plan

if TYPE_CHECKING:
    from ruletrade.strategy.v1.models import CanonicalStrategyV1
    from ruletrade.strategy.v1.registry import PrimitiveRegistry


def lower_to_lean_plan(
    strategy: "CanonicalStrategyV1",
    registry: "PrimitiveRegistry | None" = None,
    *,
    parameter_bindings: Mapping[str, object] | None = None,
) -> LeanPlan:
    """Compatibility facade; new code should use compiler.compile_strategy_to_lean_plan."""

    from ruletrade.compiler.pipeline import compile_strategy_to_lean_plan
    from ruletrade.strategy.v1.registry import BUILTIN_REGISTRY

    return compile_strategy_to_lean_plan(
        strategy,
        BUILTIN_REGISTRY if registry is None else registry,
        parameter_bindings=parameter_bindings,
    )


__all__ = [
    "CSharpGenerationSettings",
    "LeanLoweringError",
    "LeanPlan",
    "generate_csharp",
    "lower_strategy_ir_to_lean_plan",
    "lower_to_lean_plan",
    "normalize_lean_plan",
]
