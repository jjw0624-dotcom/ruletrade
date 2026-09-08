from dataclasses import replace

from ruletrade.compiler import compile_strategy_to_lean_plan
from ruletrade.compiler.lean.plan import LeanMonthlyEvent, normalize_lean_plan
from ruletrade.strategy.v1.fixtures import golden_portfolio_strategy


def test_lowering_produces_typed_golden_lean_plan() -> None:
    plan = compile_strategy_to_lean_plan(golden_portfolio_strategy())

    assert plan.strategy_identity.startswith("sha256:")
    assert plan.random_selections[0].component_id == "growth_random"
    assert plan.random_selections[0].symbols == ("QQQ", "VGT", "SOXX", "SCHG")
    assert plan.random_selections[0].count == 2
    assert plan.random_selections[0].resample == "per_event"
    assert [(item.id, str(item.total_weight), item.selection_id) for item in plan.target_sleeves] == [
        ("growth_weights", "0.70", "growth_random"),
        ("safe_weights", "0.30", None),
    ]
    assert plan.rebalances[0].sleeve_ids == ("growth_weights", "safe_weights")
    assert plan.monthly_events[0].execution.required_symbols == (
        "IEF",
        "QQQ",
        "SCHG",
        "SOXX",
        "TLT",
        "VGT",
    )


def test_normalization_deduplicates_subscriptions_and_groups_events() -> None:
    plan = compile_strategy_to_lean_plan(golden_portfolio_strategy())
    duplicate_event = LeanMonthlyEvent(
        id="other_monthly",
        day=1,
        anchor_symbol=plan.monthly_events[0].anchor_symbol,
        rebalance_ids=("other_rebalance",),
        execution=plan.monthly_events[0].execution,
    )
    duplicated = replace(
        plan,
        subscriptions=plan.subscriptions + (plan.subscriptions[0],),
        monthly_events=plan.monthly_events + (duplicate_event,),
    )

    normalized = normalize_lean_plan(duplicated)

    assert len(normalized.subscriptions) == 6
    assert normalized.monthly_events == (
        replace(
            plan.monthly_events[0],
            rebalance_ids=("other_rebalance", "rebalance"),
        ),
    )
