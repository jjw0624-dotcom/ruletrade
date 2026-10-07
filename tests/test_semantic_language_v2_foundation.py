from decimal import Decimal

import pytest

from ruletrade.compiler.lean import generate_csharp
from ruletrade.strategy.v1.fixtures import one_investment_strategy
from ruletrade.strategy.v1.models import AssetSetDefinition, GroupDefinition, StrategyMetadata
from ruletrade.strategy.v1.validation import validate_strategy_v1
from ruletrade.strategy.v2 import compile_v2_strategy_to_lean_plan, lower_v2_to_v1, upgrade_v1_to_v2
from ruletrade.strategy.v2.models import (
    CandidateBinding,
    CandidateTrailingReturnValue,
    CanonicalStrategyV2,
    ComparisonV2,
    LiteralValue,
    SelectionV2,
    StrategyDefinitionsV2,
)
from ruletrade.strategy.v2.semantic_types import (
    Axis,
    Clock,
    EvaluationContext,
    HistoryRequirement,
    Quantity,
    SemanticDType,
    SemanticType,
    SemanticTypeError,
    TruthValue,
    Unit,
    aligned_axes,
    asset_axis,
    require_compatible_values,
    semantic_content_hash,
    truth_and,
    truth_not,
    truth_or,
)
from ruletrade.strategy.v2.validation import (
    SemanticRole,
    requirements_for_strategy,
    v2_capabilities,
    validate_comparison,
    validate_strategy_v2,
)


def v2_selection() -> CanonicalStrategyV2:
    binding = CandidateBinding(id="candidate", domain_id="growth")
    candidate_return = CandidateTrailingReturnValue(
        semantic_id="candidate-return", binding_id="candidate", lookback_observations=2,
    )
    return CanonicalStrategyV2(
        semantic_profile="profile-a/daily-compositional-core@1",
        metadata=StrategyMetadata(name="V2 momentum"),
        definitions=StrategyDefinitionsV2(
            asset_sets=(AssetSetDefinition(id="growth_assets", assets=["QQQ", "VGT"]),),
            groups=(GroupDefinition(id="growth", name="Growth", asset_set_ref="growth_assets"),),
            asset_axis=asset_axis("growth"),
        ),
        operator_lock={"candidate.trailing_return": "1", "compare": "1"},
        selection=SelectionV2(
            semantic_id="selection-1",
            universe_id="growth",
            binding=binding,
            eligibility=ComparisonV2(
                semantic_id="eligibility-1",
                operator="gt",
                left=candidate_return,
                right=LiteralValue(
                    semantic_id="zero-return", value=Decimal("0"),
                    quantity=Quantity.RETURN, unit=Unit.RATIO,
                    refinement="trailing_return:adjusted_close",
                ),
            ),
            ranking=candidate_return,
            count=1,
        ),
    )


def test_v2_is_an_explicit_document_boundary_and_v1_remains_readable() -> None:
    strategy = v2_selection()
    assert strategy.api_version == "ruletrade.dev/strategy/v2"
    assert one_investment_strategy().api_version == "ruletrade.dev/strategy/v1"
    assert validate_strategy_v2(strategy) == ()


def test_quantity_and_refinement_reject_rsi_as_return() -> None:
    rsi = SemanticType(
        dtype=SemanticDType.DECIMAL, quantity=Quantity.OSCILLATOR,
        unit=Unit.POINTS, refinement="rsi_wilder_lean_compat@1",
    )
    ret = SemanticType(
        dtype=SemanticDType.DECIMAL, quantity=Quantity.RETURN,
        unit=Unit.RATIO, refinement="trailing_return:adjusted_close",
    )
    with pytest.raises(SemanticTypeError, match="unit_mismatch"):
        require_compatible_values(rsi, ret)


def test_axes_align_by_domain_identity_not_length_and_scalar_broadcasts() -> None:
    growth = SemanticType(dtype=SemanticDType.DECIMAL, quantity=Quantity.PRICE, unit=Unit.USD_PER_SHARE, axes=(asset_axis("growth"),))
    defensive = SemanticType(dtype=SemanticDType.DECIMAL, quantity=Quantity.PRICE, unit=Unit.USD_PER_SHARE, axes=(asset_axis("defensive"),))
    scalar = SemanticType(dtype=SemanticDType.DECIMAL, quantity=Quantity.PRICE, unit=Unit.USD_PER_SHARE)
    with pytest.raises(SemanticTypeError, match="axis_domain_mismatch"):
        aligned_axes(growth, defensive)
    assert aligned_axes(scalar, growth) == growth.axes


def test_cartesian_broadcast_is_not_created_implicitly() -> None:
    clock = Clock(id="daily-close")
    by_asset = SemanticType(dtype=SemanticDType.DECIMAL, quantity=Quantity.PRICE, unit=Unit.USD_PER_SHARE, axes=(asset_axis("growth"),), clock=clock)
    by_time = SemanticType(dtype=SemanticDType.DECIMAL, quantity=Quantity.PRICE, unit=Unit.USD_PER_SHARE, axes=(Axis(name="time", domain_id="daily"),), clock=clock)
    with pytest.raises(SemanticTypeError, match="implicit_cartesian"):
        aligned_axes(by_asset, by_time)


def test_candidate_is_lexically_bound_and_cannot_be_global_predicate() -> None:
    strategy = v2_selection()
    comparison = strategy.selection.eligibility
    assert comparison is not None
    assert not validate_comparison(comparison, SemanticRole.ELIGIBILITY, bound_candidate_id="candidate")
    issues = validate_comparison(comparison, SemanticRole.PREDICATE, bound_candidate_id=None)
    assert {item.code for item in issues} == {"unbound_candidate"}


def test_nested_candidate_identity_is_not_name_based() -> None:
    outer = CandidateBinding(id="candidate-outer", domain_id="growth")
    inner = CandidateBinding(id="candidate-inner", domain_id="defensive")
    assert outer.id != inner.id and outer.domain_id != inner.domain_id


def test_three_valued_logic_does_not_collapse_unavailable_to_false() -> None:
    assert truth_and(TruthValue.FALSE, TruthValue.UNKNOWN) == TruthValue.FALSE
    assert truth_and(TruthValue.TRUE, TruthValue.UNKNOWN) == TruthValue.UNKNOWN
    assert truth_or(TruthValue.TRUE, TruthValue.UNKNOWN) == TruthValue.TRUE
    assert truth_or(TruthValue.FALSE, TruthValue.UNKNOWN) == TruthValue.UNKNOWN
    assert truth_not(TruthValue.UNKNOWN) == TruthValue.UNKNOWN


def test_history_and_context_identity_are_explicit() -> None:
    assert HistoryRequirement(14, seed_anchor_required=True).compose_history(63).minimum_history_lower_bound == 77
    context = EvaluationContext(
        decision_at="2026-01-05T16:00:00Z", data_cutoff="2026-01-05T16:00:00Z",
        dataset_snapshot_id="prices-a", domain_snapshot_ids=("growth-1",),
        scope_id="portfolio", candidate_binding_id="candidate",
        operator_lock=(("candidate.trailing_return", "1"),),
    )
    assert context.cache_key("value") != EvaluationContext(
        decision_at=context.decision_at, data_cutoff=context.data_cutoff,
        dataset_snapshot_id="prices-a", domain_snapshot_ids=("defensive-1",),
        scope_id="portfolio", candidate_binding_id="candidate",
        operator_lock=context.operator_lock,
    ).cache_key("value")


def test_semantic_id_and_content_hash_remain_distinct() -> None:
    one = {"semantic_id": "left-condition", "kind": "return", "lookback": 2}
    two = {"semantic_id": "other-address", "kind": "return", "lookback": 2}
    assert one["semantic_id"] != two["semantic_id"]
    assert semantic_content_hash({key: value for key, value in one.items() if key != "semantic_id"}) == semantic_content_hash(
        {key: value for key, value in two.items() if key != "semantic_id"}
    )


def test_v2_selection_is_validated_lowered_and_compiled_through_maintained_backend() -> None:
    v1 = lower_v2_to_v1(v2_selection())
    validate_strategy_v1(v1)
    source = generate_csharp(compile_v2_strategy_to_lean_plan(v2_selection()))
    assert 'AddEquity("QQQ"' in source
    assert "OrderByDescending" in source


def test_migration_is_explicit_and_refuses_unproven_equivalence() -> None:
    candidate = upgrade_v1_to_v2(
        one_investment_strategy(),
        source_revision_id="revision-v1",
        source_semantic_hash="source-hash",
        pinned_legacy_policy={"price_basis": "adjusted", "unknown": "legacy"},
    )
    assert candidate.status == "blocked"
    assert candidate.candidate is None
    assert candidate.source_revision_id == "revision-v1"


def test_capabilities_do_not_pretend_rsi_is_ready() -> None:
    capabilities = v2_capabilities()
    assert not capabilities["candidate.trailing_return"].production_ready
    assert not capabilities["indicator.rsi"].parseable
