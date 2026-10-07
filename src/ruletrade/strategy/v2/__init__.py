"""RuleTrade Semantic Strategy Language v2 foundation.

v1 remains the authoritative reader/compiler for historical revisions.  v2 is a
separate, explicit document family and is bridged only by named lowerings.
"""
from ruletrade.strategy.v2.bridge import compile_v2_strategy_to_lean_plan, lower_v2_to_v1
from ruletrade.strategy.v2.migration import MigrationCandidate, upgrade_v1_to_v2
from ruletrade.strategy.v2.models import CanonicalStrategyV2
from ruletrade.strategy.v2.validation import (
    OP_SPECS,
    SemanticDiagnostic,
    SemanticRole,
    validate_strategy_v2,
)

__all__ = [
    "CanonicalStrategyV2",
    "MigrationCandidate",
    "OP_SPECS",
    "SemanticDiagnostic",
    "SemanticRole",
    "compile_v2_strategy_to_lean_plan",
    "lower_v2_to_v1",
    "upgrade_v1_to_v2",
    "validate_strategy_v2",
]
