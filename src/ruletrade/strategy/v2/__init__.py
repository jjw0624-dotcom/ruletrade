"""RuleTrade Semantic Strategy Language v2 foundation."""

from ruletrade.strategy.v2.bridge import compile_v2_strategy_to_lean_plan, lower_v2_to_v1
from ruletrade.strategy.v2.daily_provider import (
    DailyDatasetContract,
    DailyDatasetProviderError,
    DailyFieldAvailability,
    DatasetDailySnapshotProvider,
)
from ruletrade.strategy.v2.daily_values import (
    DailyMarketSnapshot,
    DailyValueEvaluator,
    DailyValueNode,
    TypedValuePlan,
    format_daily_value,
    infer_daily_type,
    plan_daily_value,
)
from ruletrade.strategy.v2.migration import MigrationCandidate, upgrade_v1_to_v2
from ruletrade.strategy.v2.models import CanonicalStrategyV2
from ruletrade.strategy.v2.validation import OP_SPECS, SemanticDiagnostic, SemanticRole, validate_strategy_v2

__all__ = [
    "CanonicalStrategyV2",
    "DailyDatasetContract",
    "DailyDatasetProviderError",
    "DailyFieldAvailability",
    "DatasetDailySnapshotProvider",
    "DailyMarketSnapshot",
    "DailyValueEvaluator",
    "DailyValueNode",
    "MigrationCandidate",
    "OP_SPECS",
    "SemanticDiagnostic",
    "SemanticRole",
    "TypedValuePlan",
    "compile_v2_strategy_to_lean_plan",
    "format_daily_value",
    "infer_daily_type",
    "lower_v2_to_v1",
    "plan_daily_value",
    "upgrade_v1_to_v2",
    "validate_strategy_v2",
]
