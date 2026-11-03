from __future__ import annotations

from collections.abc import Callable

import pytest

import ruletrade.strategy.v2.bridge as lowering
from ruletrade.compiler.lean.codegen import generate_csharp
from ruletrade.strategy.v2.corpus import (
    composable_semantic_execution_strategy,
    composable_split_execution_strategy,
    strongest_etfs_strategy,
    temporal_breakout_strategy,
    temporal_multiclock_strategy,
    weighted_momentum_allocation_strategy,
)
from ruletrade.strategy.v2.execution_profiles import production_execution_profile
from ruletrade.strategy.v2.models import CanonicalStrategyV2


def _maintained_program_profiles() -> tuple[tuple[str, Callable[[], CanonicalStrategyV2]], ...]:
    return (
        ("direct", lambda: production_execution_profile("direct")),
        ("selection", strongest_etfs_strategy),
        ("split", lambda: production_execution_profile("split")),
        ("conditional", lambda: production_execution_profile("conditional")),
        ("weighted-score", weighted_momentum_allocation_strategy),
        ("temporal", temporal_breakout_strategy),
        ("multi-clock", temporal_multiclock_strategy),
        ("composable", composable_semantic_execution_strategy),
        ("composable-split", composable_split_execution_strategy),
    )


@pytest.mark.parametrize(("profile", "factory"), _maintained_program_profiles())
def test_maintained_program_profiles_never_enter_v1_compiler(
    monkeypatch: pytest.MonkeyPatch,
    profile: str,
    factory: Callable[[], CanonicalStrategyV2],
) -> None:
    def forbidden(*_args: object, **_kwargs: object) -> None:
        raise AssertionError(f"{profile} entered the V1 compatibility compiler")

    monkeypatch.setattr(lowering, "lower_v2_to_v1", forbidden)
    monkeypatch.setattr(lowering, "compile_strategy_to_lean_plan", forbidden)
    plan = lowering.compile_v2_strategy_to_lean_plan(factory())
    assert plan.subscriptions
    assert generate_csharp(plan)


def test_selection_fallback_preserves_v2_semantic_addresses_and_evidence() -> None:
    strategy = strongest_etfs_strategy()
    plan = lowering.compile_v2_strategy_to_lean_plan(strategy)
    selection = plan.momentum_selections[0]
    sleeve = plan.target_sleeves[0]
    assert selection.id == "growth-selection"
    assert selection.selection_component_id == "select-growth"
    assert selection.filter_component_id == "select-growth-eligibility"
    assert sleeve.selection_id == selection.id
    assert sleeve.fallback_symbols == ("TLT",)
    source = generate_csharp(plan)
    assert '"filter_field", "condition"' in source
    selection_evidence = source.index(
        'EmitDecisionEvidence(eventIdentity, "selection", "selection"'
    )
    fallback_mutation = source.index('new List<string> { "TLT" }')
    assert selection_evidence < fallback_mutation


def test_weighted_score_preserves_v2_score_and_allocation_addresses() -> None:
    plan = lowering.compile_v2_strategy_to_lean_plan(weighted_momentum_allocation_strategy())
    selection = plan.momentum_selections[0]
    sleeve = plan.target_sleeves[0]
    assert selection.id == "growth-selection"
    assert selection.score_component_id == "weighted-momentum-score"
    assert selection.ranking_value is not None
    assert selection.ranking_value.kind == "weighted_score"
    assert sleeve.weighting_method == "proportional_score"
    assert sleeve.allocation_component_id == "allocate-by-score"
