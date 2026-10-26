from __future__ import annotations

from decimal import Decimal

import pytest

from ruletrade.hashing import semantic_payload, strategy_hash
from ruletrade.compiler.lean.codegen import generate_csharp
from ruletrade.strategy.v2.authoring import (
    ApplyV2AuthoringRequest,
    CommitMarketRegimeRotationIntent,
    CommitMultiClockPolicyIntent,
    CommitSingleAssetIntent,
    CommitSplitPortfolioIntent,
    CommitTemporalSequenceIntent,
    CommitWeightedScoreIntent,
    ProgramStrategyTemplateRequest,
    V2AuthoringError,
    apply_v2_authoring,
    create_program_strategy_template,
)
from ruletrade.strategy.v2.models import (
    AllocationStatementV2,
    CanonicalStrategyV2,
    ConditionalStatementV2,
    EventStatementV2,
    GuardedAllocationStatementV2,
    ScoreValueV2,
    SelectionStatementV2,
)
from ruletrade.strategy.v2.validation import validate_strategy_v2
from ruletrade.strategy.v2.bridge import compile_v2_strategy_to_lean_plan
from ruletrade.strategy.v2.execution_capability import assess_v2_execution_capability


def blank():
    return create_program_strategy_template(ProgramStrategyTemplateRequest(name="Intent test"))


def apply(operation):
    source = blank()
    return apply_v2_authoring(ApplyV2AuthoringRequest(
        strategy=source, expected_source_hash=strategy_hash(source), operation=operation,
    )).strategy


def test_single_asset_intent_is_direct_honest_monthly_rebalance() -> None:
    strategy = apply(CommitSingleAssetIntent(
        kind="commit_single_asset_intent", investment_id="investment-1",
        investment_name="Investment", asset_set_id="investment-1-assets",
        asset="QQQ", timeframe="monthly", timing_meaning="rebalance",
    ))
    assert validate_strategy_v2(strategy) == ()
    assert strategy.selection is None
    assert strategy.program is not None
    assert strategy.program.clocks[0].timeframe == "monthly"
    allocation = strategy.program.statements[0]
    assert isinstance(allocation, AllocationStatementV2)
    assert allocation.legs[0].target.kind == "asset"
    assert allocation.legs[0].target.ref == "QQQ"
    assert not any(isinstance(item, SelectionStatementV2) for item in strategy.program.statements)
    plan = compile_v2_strategy_to_lean_plan(strategy)
    assert plan.momentum_selections == ()
    assert [(item.symbol) for item in plan.subscriptions] == ["QQQ"]
    assert [(item.symbols, item.total_weight) for item in plan.target_sleeves] == [(("QQQ",), Decimal(1))]
    assert len(plan.monthly_events) == 1
    assert assess_v2_execution_capability(strategy).execution_state == "executable"
    source = generate_csharp(plan)
    assert 'SetHoldings(target.Key, target.Value)' in source
    assert '"final_targets"' in source


def test_market_regime_uses_explicit_otherwise_not_shortage_fallback() -> None:
    strategy = apply(CommitMarketRegimeRotationIntent(
        kind="commit_market_regime_rotation_intent",
        assets=("QQQ", "VGT", "SOXX", "SCHG"), trend_asset="QQQ",
        trend_lookback=200, ranking_lookback=126, count=2,
        fallback_asset="TLT", timeframe="monthly",
    ))
    assert validate_strategy_v2(strategy) == ()
    control = strategy.program.statements[0]
    assert isinstance(control, ConditionalStatementV2)
    selected = control.then_statements[0]
    assert isinstance(selected, SelectionStatementV2)
    assert selected.selection.fallback_asset is None
    defensive = control.otherwise_statements[0]
    assert isinstance(defensive, AllocationStatementV2)
    assert defensive.legs[0].target.ref == "TLT"
    plan = compile_v2_strategy_to_lean_plan(strategy)
    assert len(plan.rebalances) == 1
    assert plan.rebalances[0].condition_unknown_policy == "otherwise"
    assert plan.rebalances[0].otherwise_sleeve_ids
    assert {item.symbol for item in plan.subscriptions} == {"QQQ", "VGT", "SOXX", "SCHG", "TLT"}
    source = generate_csharp(plan)
    assert "CompareValuesThreeValued" in source
    assert '"unknown"' in source
    assert assess_v2_execution_capability(strategy).execution_state == "executable"


def test_split_intent_preserves_parallel_70_30_and_scoped_shortage() -> None:
    strategy = apply(CommitSplitPortfolioIntent(
        kind="commit_split_portfolio_intent",
        growth_assets=("QQQ", "VGT", "SOXX", "SCHG"),
        growth_weight=Decimal("0.70"), defensive_asset="IEF",
        ranking_lookback=126, fallback_asset="TLT", timeframe="monthly",
    ))
    assert validate_strategy_v2(strategy) == ()
    selection, split = strategy.program.statements
    assert isinstance(selection, SelectionStatementV2)
    assert selection.selection.fallback_asset == "TLT"
    assert isinstance(split, AllocationStatementV2)
    assert [leg.weight for leg in split.legs] == [Decimal("0.70"), Decimal("0.30")]
    assert [leg.target.kind for leg in split.legs] == ["selection", "asset"]
    assert split.legs[1].target.ref == "IEF"
    plan = compile_v2_strategy_to_lean_plan(strategy)
    assert [item.total_weight for item in plan.target_sleeves] == [Decimal("0.30"), Decimal("0.70")]
    growth = next(item for item in plan.target_sleeves if item.selection_id is not None)
    defensive = next(item for item in plan.target_sleeves if item.selection_id is None)
    assert growth.source_allocation == Decimal("0.70")
    assert growth.fallback_symbols == ("TLT",)
    assert defensive.symbols == ("IEF",)
    assert defensive.source_allocation == Decimal("0.30")
    assert assess_v2_execution_capability(strategy).execution_state == "executable"
    source = generate_csharp(plan)
    assert source.count('"sleeve_contribution"') >= 2


def test_weighted_score_intent_builds_top_three_and_proportional_allocation() -> None:
    strategy = apply(CommitWeightedScoreIntent(
        kind="commit_weighted_score_intent",
        assets=("QQQ", "VGT", "SOXX", "SCHG"),
        short_observations=21, long_observations=63,
        short_weight=Decimal("0.6"), long_weight=Decimal("0.4"),
        count=3, timeframe="monthly", missing_policy="require_all",
    ))
    assert validate_strategy_v2(strategy) == ()
    selection, allocation = strategy.program.statements
    assert isinstance(selection, SelectionStatementV2)
    assert selection.selection.count == 3
    assert isinstance(selection.selection.ranking, ScoreValueV2)
    assert [term.weight for term in selection.selection.ranking.terms] == [Decimal("0.6"), Decimal("0.4")]
    assert [term.value.observations for term in selection.selection.ranking.terms] == [21, 63]
    assert isinstance(allocation, AllocationStatementV2)
    assert allocation.method == "proportional_score"


def test_temporal_sequence_and_multiclock_policy_use_maintained_semantics() -> None:
    temporal = apply(CommitTemporalSequenceIntent(
        kind="commit_temporal_sequence_intent", asset="QQQ",
        breakout_threshold=Decimal(12), retest_window=3,
        confirmation_window=2, expiry_state="expired",
    ))
    assert validate_strategy_v2(temporal) == ()
    assert sum(isinstance(item, EventStatementV2) for item in temporal.program.statements) == 4
    assert temporal.program.initial_state == {"phase": "idle"}
    assert isinstance(temporal.program.statements[-1], GuardedAllocationStatementV2)

    multi = apply(CommitMultiClockPolicyIntent(
        kind="commit_multi_clock_policy_intent",
        assets=("QQQ", "VGT", "SOXX", "SCHG"),
        weekly_context_asset="QQQ", weekly_threshold=Decimal(0),
        daily_signal_asset="QQQ", daily_threshold=Decimal(0),
        score_observations=(21, 63), score_weights=(Decimal("0.6"), Decimal("0.4")),
        count=2, fallback_asset="TLT", unknown_risk_policy="block",
    ))
    assert validate_strategy_v2(multi) == ()
    assert {clock.timeframe for clock in multi.program.clocks} == {"daily", "weekly"}
    assert isinstance(multi.program.statements[-1], GuardedAllocationStatementV2)
    assert multi.program.statements[-1].unknown_guard_policy == "block"


def test_unformalized_temporal_variation_and_stale_cas_are_rejected() -> None:
    source = blank()
    with pytest.raises(V2AuthoringError, match="preserved as a draft") as unsupported:
        apply_v2_authoring(ApplyV2AuthoringRequest(
            strategy=source, expected_source_hash=strategy_hash(source),
            operation=CommitTemporalSequenceIntent(
                kind="commit_temporal_sequence_intent", asset="QQQ",
                breakout_threshold=Decimal(13), retest_window=3,
                confirmation_window=2, expiry_state="expired",
            ),
        ))
    assert unsupported.value.code == "temporal_recipe_not_formalized"

    with pytest.raises(V2AuthoringError, match="Strategy changed") as stale:
        apply_v2_authoring(ApplyV2AuthoringRequest(
            strategy=source, expected_source_hash="stale",
            operation=CommitSingleAssetIntent(
                kind="commit_single_asset_intent", investment_id="investment-1",
                investment_name="Investment", asset_set_id="investment-1-assets",
                asset="QQQ", timeframe="monthly", timing_meaning="rebalance",
            ),
        ))
    assert stale.value.code == "stale_authoring_source"


@pytest.mark.parametrize("operation", [
    CommitSingleAssetIntent(
        kind="commit_single_asset_intent", investment_id="investment-1",
        investment_name="Investment", asset_set_id="investment-1-assets",
        asset="QQQ", timeframe="monthly", timing_meaning="rebalance",
    ),
    CommitMarketRegimeRotationIntent(
        kind="commit_market_regime_rotation_intent",
        assets=("QQQ", "VGT", "SOXX", "SCHG"), trend_asset="QQQ",
        trend_lookback=200, ranking_lookback=126, count=2,
        fallback_asset="TLT", timeframe="monthly",
    ),
    CommitSplitPortfolioIntent(
        kind="commit_split_portfolio_intent",
        growth_assets=("QQQ", "VGT", "SOXX", "SCHG"),
        growth_weight=Decimal("0.70"), defensive_asset="IEF",
        ranking_lookback=126, fallback_asset="TLT", timeframe="monthly",
    ),
    CommitWeightedScoreIntent(
        kind="commit_weighted_score_intent",
        assets=("QQQ", "VGT", "SOXX", "SCHG"),
        short_observations=21, long_observations=63,
        short_weight=Decimal("0.6"), long_weight=Decimal("0.4"),
        count=3, timeframe="monthly", missing_policy="require_all",
    ),
    CommitTemporalSequenceIntent(
        kind="commit_temporal_sequence_intent", asset="QQQ",
        breakout_threshold=Decimal(12), retest_window=3,
        confirmation_window=2, expiry_state="expired",
    ),
    CommitMultiClockPolicyIntent(
        kind="commit_multi_clock_policy_intent",
        assets=("QQQ", "VGT", "SOXX", "SCHG"),
        weekly_context_asset="QQQ", weekly_threshold=Decimal(0),
        daily_signal_asset="QQQ", daily_threshold=Decimal(0),
        score_observations=(21, 63), score_weights=(Decimal("0.6"), Decimal("0.4")),
        count=2, fallback_asset="TLT", unknown_risk_policy="block",
    ),
])
def test_committed_intent_survives_canonical_save_and_reopen(operation) -> None:
    strategy = apply(operation)
    reopened = CanonicalStrategyV2.model_validate_json(strategy.model_dump_json())
    assert validate_strategy_v2(reopened) == ()
    assert semantic_payload(reopened) == semantic_payload(strategy)
    assert strategy_hash(reopened) == strategy_hash(strategy)
