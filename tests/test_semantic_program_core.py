from __future__ import annotations

from decimal import Decimal

import pytest

from ruletrade.strategy.v1.models import AssetSetDefinition, StrategyMetadata
from ruletrade.strategy.v2.authoring import V2AuthoringError, _replace_program_statement
from ruletrade.strategy.v2.daily_values import (
    DailyMarketSnapshot,
    DailyValueNode,
    MarketField,
    PriceBasis,
    SubjectKind,
)
from ruletrade.strategy.v2.models import (
    AllocationLegV2,
    AllocationStatementV2,
    AllocationTargetV2,
    BooleanGroupV2,
    CandidateBinding,
    CanonicalStrategyV2,
    ComparisonV2,
    ConditionalStatementV2,
    CrossSectionalValueV2,
    EventDefinitionV2,
    EventRelativeValueV2,
    EventStatementV2,
    GuardedAllocationStatementV2,
    OverrideRuleV2,
    ProgramClockV2,
    ScoreTermV2,
    ScoreValueV2,
    SelectionStatementV2,
    SelectionV2,
    SemanticProgramV2,
    StateTransitionStatementV2,
    StateTransitionV2,
    StateConditionV2,
    StrategyDefinitionsV2,
    UnresolvedStatementV2,
)
from ruletrade.strategy.v2.program_execution import ProgramExecutionError, execute_program_v2
from ruletrade.strategy.v2.program_validation import (
    CorpusDisposition,
    classify_corpus_case,
    validate_program_v2,
)
from ruletrade.strategy.v2.semantic_types import Axis, Clock, Quantity, Unit
from ruletrade.strategy.v2.validation import validate_strategy_v2, v2_capabilities


def snapshot() -> DailyMarketSnapshot:
    return DailyMarketSnapshot(
        snapshot_id="program-core",
        clock=Clock(id="daily-close"),
        dates=(
            "2026-01-01", "2026-01-02", "2026-01-05",
            "2026-01-06", "2026-01-30", "2026-02-02",
        ),
        domains={"growth": ("QQQ", "VGT", "SOXX")},
        series={
            "QQQ": {"close:adjusted": tuple(map(Decimal, ("100", "110", "121", "125", "130", "132")))},
            "VGT": {"close:adjusted": tuple(map(Decimal, ("100", "101", "102", "102", "103", "104")))},
            "SOXX": {"close:adjusted": tuple(map(Decimal, ("100", "95", "90", "89", "88", "87")))},
            "TLT": {"close:adjusted": tuple(map(Decimal, ("100", "100", "100", "100", "100", "100")))},
        },
    )


def candidate_close(semantic_id: str = "candidate-close") -> DailyValueNode:
    return DailyValueNode(
        semantic_id=semantic_id,
        kind="observe",
        subject_kind=SubjectKind.CANDIDATE,
        binding_id="candidate",
        field=MarketField.CLOSE,
        basis=PriceBasis.ADJUSTED,
    )


def candidate_return(semantic_id: str = "candidate-return") -> DailyValueNode:
    return DailyValueNode(
        semantic_id=semantic_id,
        kind="trailing_return",
        observations=1,
        operands=(candidate_close(f"{semantic_id}-close"),),
    )


def asset_close(symbol: str, semantic_id: str) -> DailyValueNode:
    return DailyValueNode(
        semantic_id=semantic_id,
        kind="observe",
        subject_kind=SubjectKind.ASSET,
        subject_id=symbol,
        field=MarketField.CLOSE,
        basis=PriceBasis.ADJUSTED,
    )


def literal(value: str, semantic_id: str, quantity=Quantity.PRICE, unit=Unit.USD_PER_SHARE) -> DailyValueNode:
    return DailyValueNode(
        semantic_id=semantic_id,
        kind="literal",
        value=Decimal(value),
        quantity=quantity,
        unit=unit,
        refinement="adjusted_close" if quantity == Quantity.PRICE else "score",
    )


def condition_over(value: str = "105") -> ComparisonV2:
    return ComparisonV2(
        semantic_id=f"qqq-over-{value}",
        operator="gt",
        left=asset_close("QQQ", "qqq-close"),
        right=literal(value, f"threshold-{value}"),
    )


def selection(ranking=None) -> SelectionV2:
    return SelectionV2(
        semantic_id="growth-selection",
        universe_id="growth",
        binding=CandidateBinding(id="candidate", domain_id="growth"),
        eligibility=None,
        ranking=ranking or candidate_return(),
        direction="descending",
        count=2,
        shortage_policy="require_full",
        fallback_asset="TLT",
    )


def equal_selection_allocation(output_id: str = "chosen") -> AllocationStatementV2:
    return AllocationStatementV2(
        semantic_id="allocate-selection",
        method="equal",
        legs=(
            AllocationLegV2(
                semantic_id="selected-leg",
                target=AllocationTargetV2(
                    semantic_id="selected-target", kind="selection", ref=output_id,
                ),
            ),
        ),
    )


def asset_allocation(symbol: str, semantic_id: str) -> AllocationStatementV2:
    return AllocationStatementV2(
        semantic_id=semantic_id,
        method="fixed",
        legs=(
            AllocationLegV2(
                semantic_id=f"{semantic_id}-leg",
                target=AllocationTargetV2(
                    semantic_id=f"{semantic_id}-target", kind="asset", ref=symbol,
                ),
                weight=Decimal("1"),
            ),
        ),
    )


def program(*statements, timeframe: str = "daily") -> SemanticProgramV2:
    return SemanticProgramV2(
        semantic_id="program",
        clocks=(ProgramClockV2(id=f"{timeframe}-close", timeframe=timeframe),),
        initial_state={"regime": "risk_off"},
        statements=statements,
    )


def test_cross_sectional_rank_percentile_quantile_bucket_and_score_are_deterministic() -> None:
    source = candidate_return()
    percentile = CrossSectionalValueV2(
        semantic_id="momentum-percentile",
        source=source,
        domain_id="growth",
        transform="percentile",
        direction="descending",
    )
    score = ScoreValueV2(
        semantic_id="composite-score",
        terms=(
            ScoreTermV2(semantic_id="percentile-term", value=percentile, weight=Decimal("0.75")),
            ScoreTermV2(
                semantic_id="return-term", value=source, weight=Decimal("0.25"),
            ),
        ),
    )
    core = program(
        SelectionStatementV2(
            semantic_id="select-by-score",
            selection=selection(score),
            output_id="chosen",
        ),
        equal_selection_allocation(),
    )
    result = execute_program_v2(core, snapshot(), cutoff_index=2)
    assert result.selection_outputs["chosen"] == ("QQQ", "VGT")
    assert result.target_weights == {"QQQ": Decimal("0.5"), "VGT": Decimal("0.5")}
    observed = {
        (item.semantic_id, item.candidate): item.value
        for item in result.value_observations
    }
    assert observed[("momentum-percentile", "QQQ")] == Decimal("1")
    assert observed[("momentum-percentile", "SOXX")] == Decimal("0")

    for transform in ("quantile", "bucket"):
        ranked = CrossSectionalValueV2(
            semantic_id=f"{transform}-value",
            source=source,
            domain_id="growth",
            transform=transform,
            bins=3,
        )
        candidate_program = program(
            SelectionStatementV2(
                semantic_id=f"select-{transform}",
                selection=selection(ranked),
                output_id="chosen",
            ),
        )
        outcome = execute_program_v2(candidate_program, snapshot(), cutoff_index=2)
        assert outcome.selection_outputs["chosen"][:2] == ("QQQ", "VGT")


def test_event_rising_edge_and_event_relative_reference_use_exact_anchor() -> None:
    relative = EventRelativeValueV2(
        semantic_id="event-close",
        event_id="risk-on-event",
        source=candidate_close("event-candidate-close"),
        offset_observations=0,
    )
    event_selection = selection(relative).model_copy(update={"count": 1})
    core = program(
        EventStatementV2(
            semantic_id="risk-on-handler",
            event=EventDefinitionV2(
                semantic_id="risk-on-event",
                clock_id="daily-close",
                condition=condition_over("105"),
                trigger="rising_edge",
            ),
            statements=(
                SelectionStatementV2(
                    semantic_id="event-selection",
                    selection=event_selection,
                    output_id="event-choice",
                ),
            ),
        ),
    )
    before = execute_program_v2(core, snapshot(), cutoff_index=0)
    triggered = execute_program_v2(core, snapshot(), cutoff_index=1)
    after = execute_program_v2(core, snapshot(), cutoff_index=2)
    assert "event-choice" not in before.selection_outputs
    assert triggered.selection_outputs["event-choice"] == ("QQQ",)
    assert triggered.event_truths == {"risk-on-event": "true"}
    assert "event-choice" not in after.selection_outputs
    assert any(item.semantic_id == "event-close" and item.observed_at == "2026-01-02" for item in triggered.value_observations)


def test_state_transition_is_explicit_and_does_not_mutate_on_false_or_unknown() -> None:
    core = program(
        StateTransitionStatementV2(
            semantic_id="enter-risk-on",
            transition=StateTransitionV2(
                semantic_id="risk-on-transition",
                state_key="regime",
                from_value="risk_off",
                to_value="risk_on",
                when=condition_over("105"),
                clock_id="daily-close",
            ),
        ),
    )
    assert execute_program_v2(core, snapshot(), cutoff_index=0).state["regime"] == "risk_off"
    assert execute_program_v2(core, snapshot(), cutoff_index=1).state["regime"] == "risk_on"


def test_multi_clock_runs_only_at_completed_boundary() -> None:
    weekly = SemanticProgramV2(
        semantic_id="weekly-program",
        clocks=(ProgramClockV2(id="weekly-close", timeframe="weekly"),),
        statements=(
            SelectionStatementV2(
                semantic_id="weekly-selection",
                selection=selection(),
                output_id="weekly-choice",
                clock_id="weekly-close",
            ),
        ),
    )
    assert "weekly-choice" not in execute_program_v2(weekly, snapshot(), cutoff_index=0).selection_outputs
    assert "weekly-choice" in execute_program_v2(weekly, snapshot(), cutoff_index=1).selection_outputs
    assert "weekly-choice" not in execute_program_v2(weekly, snapshot()).selection_outputs
    fixture_boundary = weekly.model_copy(update={
        "clocks": (weekly.clocks[0].model_copy(update={"terminal_boundary_policy": "fixture_end_is_boundary"}),),
    })
    assert "weekly-choice" in execute_program_v2(fixture_boundary, snapshot()).selection_outputs


def test_control_executes_only_selected_branch_and_unknown_retains() -> None:
    core = program(
        ConditionalStatementV2(
            semantic_id="risk-control",
            condition=condition_over("105"),
            then_statements=(asset_allocation("QQQ", "risk-on"),),
            otherwise_statements=(asset_allocation("TLT", "risk-off"),),
        ),
    )
    false_result = execute_program_v2(core, snapshot(), cutoff_index=0)
    true_result = execute_program_v2(core, snapshot(), cutoff_index=1)
    assert false_result.target_weights == {"TLT": Decimal("1")}
    assert true_result.target_weights == {"QQQ": Decimal("1")}
    assert {item.semantic_id for item in true_result.evidence if item.kind == "allocation"} == {"risk-on"}


def test_guard_override_primary_fallback_precedence_is_total() -> None:
    select_empty = SelectionStatementV2(
        semantic_id="empty-selection",
        selection=selection().model_copy(update={
            "eligibility": condition_over("1000"),
            "fallback_asset": None,
        }),
        output_id="chosen",
    )
    guarded = GuardedAllocationStatementV2(
        semantic_id="capital-policy",
        guard=condition_over("50"),
        primary=equal_selection_allocation(),
        overrides=(
            OverrideRuleV2(
                semantic_id="risk-override",
                priority=100,
                when=condition_over("120"),
                action=asset_allocation("TLT", "override-tlt"),
            ),
        ),
        fallback=asset_allocation("TLT", "fallback-tlt"),
    )
    core = program(select_empty, guarded)
    fallback = execute_program_v2(core, snapshot(), cutoff_index=1)
    override = execute_program_v2(core, snapshot(), cutoff_index=3)
    assert fallback.target_weights == {"TLT": Decimal("1")}
    assert any(item.outcome == "fallback" for item in fallback.evidence)
    assert override.target_weights == {"TLT": Decimal("1")}
    assert any(item.outcome == "override" for item in override.evidence)


def test_unknown_guard_blocks_and_retains_holdings() -> None:
    missing = ComparisonV2(
        semantic_id="missing-guard",
        operator="gt",
        left=DailyValueNode(
            semantic_id="missing-history",
            kind="sma",
            observations=20,
            operands=(asset_close("QQQ", "guard-close"),),
        ),
        right=literal("1", "one"),
    )
    core = program(
        GuardedAllocationStatementV2(
            semantic_id="guarded",
            guard=missing,
            primary=asset_allocation("QQQ", "primary"),
        ),
    )
    result = execute_program_v2(core, snapshot(), cutoff_index=1)
    assert result.retained_holdings is True
    assert result.target_weights == {}
    assert result.evidence[-1].outcome == "guard_blocked"


def test_fixed_allocation_requires_exact_total_and_parallel_targets() -> None:
    with pytest.raises(ValueError, match="sum exactly"):
        AllocationStatementV2(
            semantic_id="bad-split",
            method="fixed",
            legs=(
                AllocationLegV2(
                    semantic_id="growth",
                    target=AllocationTargetV2(
                        semantic_id="growth-target", kind="asset", ref="QQQ",
                    ),
                    weight=Decimal("0.7"),
                ),
                AllocationLegV2(
                    semantic_id="defensive",
                    target=AllocationTargetV2(
                        semantic_id="defensive-target", kind="asset", ref="TLT",
                    ),
                    weight=Decimal("0.2"),
                ),
            ),
        )


def test_fuzzy_or_unresolved_semantics_are_draft_only() -> None:
    unresolved = program(
        UnresolvedStatementV2(
            semantic_id="fuzzy-strong-market",
            source_text="buy when the market feels strong",
            category="fuzzy_term",
            reason="strong has no explicit measurable definition",
        ),
    )
    issues = validate_program_v2(unresolved)
    assert {item.code for item in issues} == {"unresolved_semantics"}
    with pytest.raises(ProgramExecutionError, match="unresolved_semantics"):
        execute_program_v2(unresolved, snapshot())


def test_169_corpus_representative_classification_is_honest() -> None:
    representable = classify_corpus_case(
        "K-cross-score-event-state",
        required_semantics={
            "cross_section", "score", "event", "state", "event_relative",
            "multi_clock", "allocation", "guard", "override", "fallback",
        },
    )
    provider = classify_corpus_case(
        "K-volume-breakout",
        required_semantics={"condition"},
        provider_fields={"adjusted_close", "volume"},
    )
    fuzzy = classify_corpus_case(
        "K-strong-market", required_semantics={"condition"}, has_fuzzy_terms=True,
    )
    deferred = classify_corpus_case(
        "K-options-vol-surface", required_semantics={"options_surface"},
    )
    assert representable.disposition == CorpusDisposition.REPRESENTABLE
    assert provider.disposition == CorpusDisposition.PROVIDER_BLOCKED
    assert fuzzy.disposition == CorpusDisposition.UNRESOLVED
    assert deferred.disposition == CorpusDisposition.DEFERRED


def test_declared_state_can_drive_control_and_undeclared_state_is_rejected() -> None:
    state_gate = StateConditionV2(
        semantic_id="risk-on-state", state_key="regime", expected="risk_on",
    )
    transition = StateTransitionStatementV2(
        semantic_id="turn-risk-on",
        transition=StateTransitionV2(
            semantic_id="regime-transition",
            state_key="regime",
            from_value="risk_off",
            to_value="risk_on",
            when=condition_over("105"),
        ),
    )
    routing = ConditionalStatementV2(
        semantic_id="state-route",
        condition=state_gate,
        then_statements=(asset_allocation("QQQ", "risk-on-allocation"),),
        otherwise_statements=(asset_allocation("TLT", "risk-off-allocation"),),
    )
    core = program(transition, routing)
    assert execute_program_v2(core, snapshot(), cutoff_index=1).target_weights == {"QQQ": Decimal("1")}

    invalid = program(routing.model_copy(update={
        "condition": state_gate.model_copy(update={"state_key": "undeclared"}),
    }))
    assert "undeclared_state" in {item.code for item in validate_program_v2(invalid)}
    invalid_eligibility = program(SelectionStatementV2(
        semantic_id="invalid-state-eligibility",
        selection=selection().model_copy(update={"eligibility": state_gate}),
        output_id="invalid-output",
    ))
    assert "state_condition_role_forbidden" in {
        item.code for item in validate_program_v2(invalid_eligibility)
    }


def test_group_allocation_expands_members_and_event_anchor_is_returned() -> None:
    group_allocation = AllocationStatementV2(
        semantic_id="group-allocation",
        method="equal",
        legs=(AllocationLegV2(
            semantic_id="group-leg",
            target=AllocationTargetV2(
                semantic_id="group-target", kind="group", ref="growth",
            ),
        ),),
    )
    group_result = execute_program_v2(program(group_allocation), snapshot())
    assert group_result.target_weights == {
        "QQQ": Decimal(1) / Decimal(3),
        "VGT": Decimal(1) / Decimal(3),
        "SOXX": Decimal(1) / Decimal(3),
    }

    event_program = program(EventStatementV2(
        semantic_id="event-handler",
        event=EventDefinitionV2(
            semantic_id="risk-on-event",
            clock_id="daily-close",
            condition=condition_over("105"),
            trigger="rising_edge",
        ),
        statements=(asset_allocation("QQQ", "event-allocation"),),
    ))
    event_result = execute_program_v2(event_program, snapshot(), cutoff_index=1)
    assert event_result.event_cutoffs == {"risk-on-event": 1}


def test_program_native_canonical_round_trip_and_capability_ledger() -> None:
    core = program(asset_allocation("QQQ", "all-in-qqq"))
    canonical = CanonicalStrategyV2(
        semantic_profile="profile-a/daily-compositional-core@1",
        metadata=StrategyMetadata(name="Program-native"),
        definitions=StrategyDefinitionsV2(
            asset_sets=(AssetSetDefinition(id="growth", assets=["QQQ", "VGT", "SOXX"]),),
            groups=(),
            asset_axis=Axis(name="asset", domain_id="growth"),
        ),
        operator_lock={"compare": "1"},
        program=core,
    )
    payload = canonical.model_dump(mode="json")
    reopened = CanonicalStrategyV2.model_validate(payload)
    assert reopened.selection is None
    assert reopened.program == core
    assert validate_strategy_v2(reopened) == ()
    ledger = v2_capabilities()
    assert ledger["program.cross_sectional@1"].reference_evaluable is True
    assert ledger["program.cross_sectional@1"].backend_lowerable is False
    assert ledger["program.cross_sectional@1"].production_ready is False


def test_selection_outputs_require_definite_program_order_and_nested_ids_are_unique() -> None:
    conditional_selection = ConditionalStatementV2(
        semantic_id="conditional-selection",
        condition=condition_over("105"),
        then_statements=(SelectionStatementV2(
            semantic_id="branch-selection",
            selection=selection(),
            output_id="branch-output",
        ),),
    )
    outside_allocation = equal_selection_allocation("branch-output")
    issues = validate_program_v2(program(conditional_selection, outside_allocation))
    assert "unknown_selection_output" in {item.code for item in issues}

    duplicate_nested = GuardedAllocationStatementV2(
        semantic_id="policy",
        primary=asset_allocation("QQQ", "duplicate-allocation"),
        fallback=asset_allocation("TLT", "duplicate-allocation"),
    )
    issues = validate_program_v2(program(duplicate_nested))
    assert "duplicate_program_semantic_id" in {item.code for item in issues}


def test_score_and_cross_section_domains_do_not_mix_units_or_universes() -> None:
    with pytest.raises(ValueError, match="non-zero"):
        ScoreValueV2(
            semantic_id="zero-score",
            terms=(ScoreTermV2(
                semantic_id="zero-term", value=candidate_return(), weight=Decimal("0"),
            ),),
        )

    price_score = ScoreValueV2(
        semantic_id="price-score",
        terms=(ScoreTermV2(
            semantic_id="price-term", value=candidate_close(), weight=Decimal("1"),
        ),),
    )
    price_issues = validate_program_v2(program(SelectionStatementV2(
        semantic_id="price-score-selection",
        selection=selection(price_score),
        output_id="price-score-output",
    )))
    assert "score_term_not_dimensionless" in {item.code for item in price_issues}

    wrong_domain = CrossSectionalValueV2(
        semantic_id="wrong-domain-rank",
        source=candidate_return(),
        domain_id="other-universe",
        transform="rank",
    )
    domain_issues = validate_program_v2(program(SelectionStatementV2(
        semantic_id="wrong-domain-selection",
        selection=selection(wrong_domain),
        output_id="wrong-domain-output",
    )))
    assert "cross_section_domain_mismatch" in {item.code for item in domain_issues}


def test_program_value_provenance_hashes_content_not_semantic_address() -> None:
    base = CrossSectionalValueV2(
        semantic_id="rank-address-a",
        source=candidate_return(),
        domain_id="growth",
        transform="percentile",
        direction="descending",
    )

    def observed_hash(value: CrossSectionalValueV2) -> str:
        result = execute_program_v2(program(SelectionStatementV2(
            semantic_id=f"selection-{value.semantic_id}",
            selection=selection(value),
            output_id=f"output-{value.semantic_id}",
        )), snapshot(), cutoff_index=2)
        return next(
            item.expression_hash for item in result.value_observations
            if item.semantic_id == value.semantic_id
        )

    assert observed_hash(base) == observed_hash(base.model_copy(update={"semantic_id": "rank-address-b"}))
    assert observed_hash(base) != observed_hash(base.model_copy(update={
        "semantic_id": "rank-direction-change", "direction": "ascending",
    }))


def test_program_authoring_addresses_nested_allocations_without_ambiguity() -> None:
    policy = GuardedAllocationStatementV2(
        semantic_id="addressable-policy",
        primary=asset_allocation("QQQ", "addressable-primary"),
        fallback=asset_allocation("TLT", "addressable-fallback"),
    )
    core = program(policy)
    replacement = asset_allocation("SOXX", "replacement-allocation")
    changed = _replace_program_statement(core, "addressable-fallback", replacement)
    changed_policy = changed.statements[0]
    assert isinstance(changed_policy, GuardedAllocationStatementV2)
    assert changed_policy.fallback == replacement
    assert changed_policy.primary == policy.primary

    with pytest.raises(V2AuthoringError, match="Allocation replacement"):
        _replace_program_statement(
            core,
            "addressable-primary",
            UnresolvedStatementV2(
                semantic_id="wrong-kind",
                source_text="unresolved",
                category="unsupported_semantics",
                reason="wrong replacement kind",
            ),
        )


def test_state_driven_event_edge_uses_incoming_not_already_mutated_state() -> None:
    enter_risk_on = StateTransitionStatementV2(
        semantic_id="enter-risk-on-before-event",
        transition=StateTransitionV2(
            semantic_id="risk-on-before-event-transition",
            state_key="regime",
            from_value="risk_off",
            to_value="risk_on",
            when=condition_over("105"),
        ),
    )
    state_event = EventStatementV2(
        semantic_id="state-event-handler",
        event=EventDefinitionV2(
            semantic_id="state-risk-on-event",
            clock_id="daily-close",
            condition=StateConditionV2(
                semantic_id="state-is-risk-on",
                state_key="regime",
                expected="risk_on",
            ),
            trigger="rising_edge",
        ),
        statements=(asset_allocation("QQQ", "state-event-allocation"),),
    )
    result = execute_program_v2(
        program(enter_risk_on, state_event), snapshot(), cutoff_index=1,
        prior_state={"regime": "risk_off"},
    )
    assert result.state["regime"] == "risk_on"
    assert result.target_weights == {"QQQ": Decimal("1")}
    assert result.event_truths == {"state-risk-on-event": "true"}


def test_overlapping_allocation_targets_add_exposure_instead_of_overwriting() -> None:
    base = snapshot()
    overlapping = DailyMarketSnapshot(
        snapshot_id=base.snapshot_id,
        clock=base.clock,
        dates=base.dates,
        domains={
            **base.domains,
            "growth-sleeve": ("QQQ", "VGT"),
            "defensive-sleeve": ("QQQ", "TLT"),
        },
        series=base.series,
    )
    allocation = AllocationStatementV2(
        semantic_id="overlapping-sleeves",
        method="fixed",
        legs=(
            AllocationLegV2(
                semantic_id="growth-sleeve-leg",
                target=AllocationTargetV2(
                    semantic_id="growth-sleeve-target", kind="group", ref="growth-sleeve",
                ),
                weight=Decimal("0.7"),
            ),
            AllocationLegV2(
                semantic_id="defensive-sleeve-leg",
                target=AllocationTargetV2(
                    semantic_id="defensive-sleeve-target", kind="group", ref="defensive-sleeve",
                ),
                weight=Decimal("0.3"),
            ),
        ),
    )
    result = execute_program_v2(program(allocation), overlapping)
    assert result.target_weights == {
        "QQQ": Decimal("0.50"),
        "VGT": Decimal("0.35"),
        "TLT": Decimal("0.15"),
    }
    assert sum(result.target_weights.values()) == Decimal("1")


def test_retain_is_an_unambiguous_whole_allocation_outcome() -> None:
    with pytest.raises(ValueError, match="sole target"):
        AllocationStatementV2(
            semantic_id="ambiguous-retain",
            method="equal",
            legs=(
                AllocationLegV2(
                    semantic_id="retain-leg",
                    target=AllocationTargetV2(
                        semantic_id="retain-target", kind="retain",
                    ),
                ),
                AllocationLegV2(
                    semantic_id="asset-leg",
                    target=AllocationTargetV2(
                        semantic_id="asset-target", kind="asset", ref="QQQ",
                    ),
                ),
            ),
        )

    retain = AllocationStatementV2(
        semantic_id="retain-all",
        method="equal",
        legs=(AllocationLegV2(
            semantic_id="retain-only-leg",
            target=AllocationTargetV2(
                semantic_id="retain-only-target", kind="retain",
            ),
        ),),
    )
    result = execute_program_v2(program(retain), snapshot())
    assert result.retained_holdings is True
    assert result.target_weights == {}
