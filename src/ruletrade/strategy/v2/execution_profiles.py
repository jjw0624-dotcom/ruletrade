"""Production-authoring fixtures for Group/Choose/Investment execution closure."""
from __future__ import annotations

from decimal import Decimal
from typing import Literal

from ruletrade.hashing import strategy_hash
from ruletrade.strategy.v2.authoring import (
    AddProgramGroup,
    ApplyV2AuthoringRequest,
    CommitMarketRegimeRotationIntent,
    CommitSingleAssetIntent,
    CommitSplitPortfolioIntent,
    CreateProgramChoose,
    ProgramStrategyTemplateRequest,
    SetProgramFallback,
    SetProgramInvestment,
    SetProgramSchedule,
    apply_v2_authoring,
    create_program_strategy_template,
)
from ruletrade.strategy.v2.models import CanonicalStrategyV2


ExecutionClosureProfile = Literal["direct", "choose", "split", "conditional"]


def _apply(strategy: CanonicalStrategyV2, operation: object) -> CanonicalStrategyV2:
    return apply_v2_authoring(ApplyV2AuthoringRequest(
        strategy=strategy,
        expected_source_hash=strategy_hash(strategy),
        operation=operation,
    )).strategy


def production_execution_profile(profile: ExecutionClosureProfile) -> CanonicalStrategyV2:
    """Build A-D through the same typed operations used by the production Builder."""
    strategy = create_program_strategy_template(ProgramStrategyTemplateRequest(
        name=f"Execution closure · {profile}",
    ))
    if profile == "direct":
        return _apply(strategy, CommitSingleAssetIntent(
            kind="commit_single_asset_intent",
            investment_id="qqq", investment_name="QQQ Investment",
            asset_set_id="qqq-assets", asset="QQQ",
            timeframe="monthly", timing_meaning="rebalance",
        ))
    if profile == "choose":
        strategy = _apply(strategy, AddProgramGroup(
            kind="add_program_group", group_id="growth", name="Growth",
            asset_set_id="growth-assets", assets=("QQQ", "VGT", "SOXX", "SCHG"),
        ))
        strategy = _apply(strategy, CreateProgramChoose(
            kind="create_program_choose", semantic_id="choose-growth",
            group_id="growth", output_id="selected-growth", clock_id="daily-close",
            lookback=126, direction="descending", count=2,
            shortage_policy="require_full", qualification_lookback=126,
            qualification_operator="gt", qualification_threshold=Decimal(0),
        ))
        strategy = _apply(strategy, SetProgramFallback(
            kind="set_program_fallback", semantic_id="choose-growth", fallback_asset="TLT",
        ))
        strategy = _apply(strategy, SetProgramInvestment(
            kind="set_program_investment", semantic_id="growth-investment",
            target_kind="selection", target_ref="selected-growth",
            internal_allocation="equal", clock_id="daily-close",
        ))
        return _apply(strategy, SetProgramSchedule(
            kind="set_program_schedule", clock_id="daily-close", timeframe="monthly",
        ))
    if profile == "split":
        return _apply(strategy, CommitSplitPortfolioIntent(
            kind="commit_split_portfolio_intent",
            growth_assets=("QQQ", "VGT", "SOXX", "SCHG"),
            growth_weight=Decimal("0.70"), defensive_asset="IEF",
            ranking_lookback=126, fallback_asset="TLT", timeframe="monthly",
        ))
    return _apply(strategy, CommitMarketRegimeRotationIntent(
        kind="commit_market_regime_rotation_intent",
        assets=("QQQ", "VGT", "SOXX", "SCHG"), trend_asset="QQQ",
        trend_lookback=200, ranking_lookback=126, count=2,
        fallback_asset="TLT", timeframe="monthly",
    ))
