from __future__ import annotations

from decimal import Decimal

from ruletrade.hashing import semantic_payload, strategy_hash
from ruletrade.strategy.v2.bridge import compile_v2_strategy_to_lean_plan
from ruletrade.strategy.v2.daily_values import DailyMarketSnapshot
from ruletrade.strategy.v2.execution_capability import assess_v2_execution_capability
from ruletrade.strategy.v2.execution_profiles import production_execution_profile
from ruletrade.strategy.v2.models import CanonicalStrategyV2
from ruletrade.strategy.v2.program_execution import execute_program_v2
from ruletrade.strategy.v2.semantic_types import Clock


def test_a_through_d_authoring_profiles_are_executable_and_round_trip() -> None:
    for profile in ("direct", "choose", "split", "conditional"):
        strategy = production_execution_profile(profile)
        capability = assess_v2_execution_capability(strategy)
        assert capability.semantic_state == "valid"
        assert capability.execution_state == "executable"
        assert capability.backend_lowerable is True
        assert compile_v2_strategy_to_lean_plan(strategy).subscriptions

        reopened = CanonicalStrategyV2.model_validate_json(strategy.model_dump_json())
        assert semantic_payload(reopened) == semantic_payload(strategy)
        assert strategy_hash(reopened) == strategy_hash(strategy)
        assert compile_v2_strategy_to_lean_plan(reopened) == compile_v2_strategy_to_lean_plan(strategy)


def test_split_keeps_portfolio_share_separate_from_local_equal_weight() -> None:
    plan = compile_v2_strategy_to_lean_plan(production_execution_profile("split"))
    growth = next(item for item in plan.target_sleeves if item.selection_id is not None)
    defensive = next(item for item in plan.target_sleeves if item.selection_id is None)
    assert growth.total_weight == growth.source_allocation
    assert growth.local_total_weight == 1
    assert defensive.total_weight == defensive.source_allocation
    assert defensive.local_total_weight == 1


def test_conditional_unknown_policy_is_preserved_in_typed_plan() -> None:
    plan = compile_v2_strategy_to_lean_plan(production_execution_profile("conditional"))
    assert plan.rebalances[0].condition_unknown_policy == "otherwise"
    assert plan.rebalances[0].condition
    assert plan.rebalances[0].otherwise_sleeve_ids


def test_month_close_uses_next_observed_session_across_exchange_holiday() -> None:
    strategy = production_execution_profile("direct")
    assert strategy.program is not None
    snapshot = DailyMarketSnapshot(
        snapshot_id="good-friday-boundary",
        clock=Clock(id="daily-close"),
        dates=("2024-03-28", "2024-04-01"),
        domains={"qqq": ("QQQ",)},
        series={"QQQ": {"close:adjusted": (Decimal("100"), Decimal("101"))}},
    )
    assert execute_program_v2(
        strategy.program, snapshot, cutoff_index=0,
    ).target_weights == {"QQQ": Decimal(1)}
