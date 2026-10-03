from ruletrade.strategy.v1.compatibility import (
    BranchSupport,
    SemanticEffect,
    StatementFamily,
    classify_branch,
)


def test_selection_allocation_action_is_commit_ready() -> None:
    result = classify_branch(
        (
            StatementFamily.SELECTION,
            StatementFamily.ALLOCATION,
            StatementFamily.ACTION,
        )
    )
    assert result.commit_ready
    assert result.final_effect is SemanticEffect.EXECUTION


def test_timing_is_invalid_inside_control_branch() -> None:
    result = classify_branch((StatementFamily.TIMING,))
    assert result.support is BranchSupport.INVALID_IN_CONTROL_BRANCH
    assert not result.commit_ready


def test_nested_control_is_draftable_only_for_predicate_v1() -> None:
    result = classify_branch((StatementFamily.CONTROL,))
    assert result.support is BranchSupport.DRAFTABLE_ONLY
    assert not result.commit_ready


def test_selection_fallback_is_not_otherwise() -> None:
    result = classify_branch((StatementFamily.SELECTION_FALLBACK,))
    assert result.support is BranchSupport.INVALID_IN_CONTROL_BRANCH


def test_incompatible_effect_chain_is_draftable_not_executable() -> None:
    result = classify_branch((StatementFamily.SELECTION, StatementFamily.ACTION))
    assert result.support is BranchSupport.DRAFTABLE_ONLY
    assert result.final_effect is SemanticEffect.CANDIDATES


def test_empty_branch_is_not_commit_ready() -> None:
    result = classify_branch(())
    assert result.support is BranchSupport.DRAFTABLE_ONLY
    assert result.final_effect is SemanticEffect.NONE
