from decimal import Decimal

from ruletrade.compiler import compile_strategy_to_lean_plan
from ruletrade.compiler.analysis import analyze_strategy_ir
from ruletrade.compiler.frontend import lower_strategy_model_to_ir
from ruletrade.compiler.lean.codegen import generate_csharp
from ruletrade.compiler.lean.lowering import lower_strategy_ir_to_lean_plan
from ruletrade.compiler.lean.plan import (
    LeanMonthlyEvent,
    LeanOnDataExecution,
    LeanPlan,
    LeanRandomSelection,
    LeanRebalance,
    LeanSubscription,
    LeanTargetSleeve,
)
from ruletrade.hashing import strategy_hash
from ruletrade.strategy.v1.fixtures import golden_portfolio_strategy


def _legacy_direct_lowering_oracle() -> LeanPlan:
    """Exact Golden LeanPlan captured before the Strategy IR insertion."""

    strategy = golden_portfolio_strategy()
    symbols = ("IEF", "QQQ", "SCHG", "SOXX", "TLT", "VGT")
    return LeanPlan(
        strategy_identity=strategy_hash(strategy),
        subscriptions=tuple(LeanSubscription(symbol=symbol) for symbol in symbols),
        random_selections=(
            LeanRandomSelection(
                id="growth_random",
                component_id="growth_random",
                symbols=("QQQ", "VGT", "SOXX", "SCHG"),
                count=2,
                resample="per_event",
                parameter_bindings_json="{}",
            ),
        ),
        target_sleeves=(
            LeanTargetSleeve(
                id="growth_weights",
                symbols=("QQQ", "VGT", "SOXX", "SCHG"),
                total_weight=Decimal("0.70"),
                selection_id="growth_random",
            ),
            LeanTargetSleeve(
                id="safe_weights",
                symbols=("TLT", "IEF"),
                total_weight=Decimal("0.30"),
            ),
        ),
        rebalances=(
            LeanRebalance(
                id="rebalance",
                sleeve_ids=("growth_weights", "safe_weights"),
            ),
        ),
        monthly_events=(
            LeanMonthlyEvent(
                id="monthly",
                day=1,
                anchor_symbol="IEF",
                rebalance_ids=("rebalance",),
                execution=LeanOnDataExecution(required_symbols=symbols),
            ),
        ),
    )


def test_strategy_ir_pipeline_exactly_matches_legacy_golden_plan_and_csharp() -> None:
    legacy_plan = _legacy_direct_lowering_oracle()
    new_plan = compile_strategy_to_lean_plan(golden_portfolio_strategy())

    assert new_plan == legacy_plan
    assert generate_csharp(new_plan) == generate_csharp(legacy_plan)


def test_lean_backend_lowering_consumes_strategy_ir_and_analysis() -> None:
    strategy_ir = lower_strategy_model_to_ir(golden_portfolio_strategy())
    requirements = analyze_strategy_ir(strategy_ir)

    plan = lower_strategy_ir_to_lean_plan(strategy_ir, requirements)

    assert plan == _legacy_direct_lowering_oracle()
