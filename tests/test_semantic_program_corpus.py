from __future__ import annotations

from decimal import Decimal

import pytest

from ruletrade.strategy.v2.daily_values import (
    DailyMarketSnapshot, DailyValueNode, MarketField, PriceBasis, SubjectKind,
)
from ruletrade.strategy.v2.models import (
    AllocationLegV2, AllocationStatementV2, AllocationTargetV2,
    BarsSinceEventValueV2, BooleanGroupV2, CandidateBinding, ClockedValueV2, ComparisonV2,
    ConditionPointTermV2, CrossSectionalAggregateValueV2, CrossSectionalValueV2,
    EventDefinitionV2, EventRelativeValueV2, EventStatementV2, EventWindowConditionV2,
    FormalizationProvenanceV2, GuardedAllocationStatementV2, LiteralValue,
    NOfMConditionV2, OverrideRuleV2, ProgramClockV2, RememberedValueV2,
    RememberValueStatementV2, ScoreTermV2, ScoreValueV2, SelectionStatementV2,
    SelectionV2, SemanticProgramV2, StateConditionV2, StateTransitionStatementV2,
    StateTransitionV2, UnresolvedStatementV2,
    TimeSinceEventValueV2, TimeSinceStateValueV2,
)
from ruletrade.strategy.v2.program_execution import ProgramExecutionError, execute_program_v2
from ruletrade.strategy.v2.program_validation import validate_program_v2
from ruletrade.strategy.v2.semantic_types import Clock, Quantity, Unit
from ruletrade.strategy.v2.validation import v2_capabilities


def snapshot() -> DailyMarketSnapshot:
    dates = ("2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-12")
    return DailyMarketSnapshot(
        snapshot_id="program-corpus", clock=Clock(id="daily-close"), dates=dates,
        domains={"group": ("A", "B", "C")},
        series={
            "A": {"close:adjusted": tuple(map(Decimal, ("10", "11", "12", "13", "14", "15")))},
            "B": {"close:adjusted": tuple(map(Decimal, ("10", "10", "11", "11", "12", "12")))},
            "C": {"close:adjusted": tuple(map(Decimal, ("10", "9", "8", "9", "8", "7")))},
            "CASH": {"close:adjusted": tuple(map(Decimal, ("1", "1", "1", "1", "1", "1")))},
        },
    )


def observe(symbol: str, semantic_id: str) -> DailyValueNode:
    return DailyValueNode(
        semantic_id=semantic_id, kind="observe", subject_kind=SubjectKind.ASSET,
        subject_id=symbol, field=MarketField.CLOSE, basis=PriceBasis.ADJUSTED,
    )


def candidate_return(semantic_id: str = "candidate-return") -> DailyValueNode:
    source = DailyValueNode(
        semantic_id=f"{semantic_id}-source", kind="observe", subject_kind=SubjectKind.CANDIDATE,
        binding_id="candidate", field=MarketField.CLOSE, basis=PriceBasis.ADJUSTED,
    )
    return DailyValueNode(
        semantic_id=semantic_id, kind="trailing_return", observations=1, operands=(source,),
    )


def literal(value: str, semantic_id: str, quantity=Quantity.PRICE, unit=Unit.USD_PER_SHARE) -> LiteralValue:
    return LiteralValue(
        semantic_id=semantic_id, value=Decimal(value), quantity=quantity, unit=unit,
        refinement="adjusted_close" if quantity == Quantity.PRICE else "score",
    )


def compare(left, operator: str, right, semantic_id: str) -> ComparisonV2:
    return ComparisonV2(semantic_id=semantic_id, operator=operator, left=left, right=right)


def selection(ranking, *, count: int = 2, eligibility=None) -> SelectionV2:
    return SelectionV2(
        semantic_id="selection", universe_id="group",
        binding=CandidateBinding(id="candidate", domain_id="group"),
        eligibility=eligibility, ranking=ranking, direction="descending", count=count,
        shortage_policy="choose_all",
    )


def selection_statement(ranking, *, count: int = 2, eligibility=None) -> SelectionStatementV2:
    return SelectionStatementV2(
        semantic_id="select", selection=selection(ranking, count=count, eligibility=eligibility),
        output_id="chosen",
    )


def allocation(method: str = "equal", **updates) -> AllocationStatementV2:
    return AllocationStatementV2(
        semantic_id="allocation", method=method,
        legs=(AllocationLegV2(
            semantic_id="allocation-leg",
            target=AllocationTargetV2(semantic_id="allocation-target", kind="selection", ref="chosen"),
        ),), **updates,
    )


def program(*statements, clocks=None, formalizations=()) -> SemanticProgramV2:
    return SemanticProgramV2(
        semantic_id="program",
        clocks=clocks or (ProgramClockV2(id="daily-close", timeframe="daily"),),
        initial_state={"phase": "idle"}, formalizations=formalizations, statements=statements,
    )


def test_price_sma_and_candidate_vs_group_median_are_typed_and_deterministic() -> None:
    price = observe("A", "a-price")
    sma = DailyValueNode(semantic_id="a-sma", kind="sma", observations=3, operands=(price,))
    price_over_sma = compare(price, "gt", sma, "price-over-sma")
    median = CrossSectionalAggregateValueV2(
        semantic_id="median-return", source=candidate_return(), domain_id="group", reduction="median",
    )
    above_median = compare(candidate_return("candidate-return-2"), "gt", median, "above-median")
    core = program(selection_statement(candidate_return("ranking-return"), eligibility=above_median))
    assert validate_program_v2(core) == ()
    result = execute_program_v2(core, snapshot(), cutoff_index=4)
    assert result.selection_outputs["chosen"] == ("B",)
    runtime = execute_program_v2(
        program(EventStatementV2(
            semantic_id="sma-event-statement",
            event=EventDefinitionV2(semantic_id="sma-event", clock_id="daily-close", condition=price_over_sma, trigger="while_true"),
            statements=(RememberValueStatementV2(
                semantic_id="remember-price", memory_id="entry-level", value=price,
            ),),
        )), snapshot(), cutoff_index=4,
    )
    assert runtime.remembered_values["entry-level"] == Decimal("14")


def test_composite_score_can_be_ranked_again_with_stable_ties_and_provenance() -> None:
    factor_a = CrossSectionalValueV2(
        semantic_id="rank-a", source=candidate_return("return-a"), domain_id="group", transform="rank",
    )
    factor_b = CrossSectionalValueV2(
        semantic_id="rank-b", source=candidate_return("return-b"), domain_id="group", transform="percentile",
    )
    score = ScoreValueV2(
        semantic_id="composite", terms=(
            ScoreTermV2(semantic_id="term-a", value=factor_a, weight=Decimal("1")),
            ScoreTermV2(semantic_id="term-b", value=factor_b, weight=Decimal("1")),
        ), normalization="sum_abs",
    )
    rerank = CrossSectionalValueV2(
        semantic_id="composite-rank", source=score, domain_id="group", transform="rank",
        direction="ascending",
    )
    statement = selection_statement(rerank)
    statement = statement.model_copy(update={"selection": statement.selection.model_copy(update={"direction": "ascending"})})
    result = execute_program_v2(program(statement), snapshot(), cutoff_index=4)
    assert result.selection_outputs["chosen"] == ("B", "A")
    coverage = next(item for item in result.value_observations if item.semantic_id == "composite-rank" and item.candidate == "A")
    assert coverage.requested_members == ("A", "B", "C")
    assert coverage.missing_members == ()


def test_quantile_bucket_points_and_n_of_m_truth_unknown_contract() -> None:
    bucket = CrossSectionalValueV2(
        semantic_id="return-bucket", source=candidate_return(), domain_id="group",
        transform="bucket", bins=3,
    )
    zero_return = LiteralValue(
        semantic_id="zero", value=Decimal(0), quantity=Quantity.RETURN,
        unit=Unit.RATIO, refinement="trailing_return:adjusted_close",
    )
    positive = compare(candidate_return("positive-return"), "gt", zero_return, "positive")
    score = ScoreValueV2(
        semantic_id="points", terms=(ScoreTermV2(semantic_id="bucket-points", value=bucket, weight=Decimal("1")),),
        condition_terms=(ConditionPointTermV2(
            semantic_id="positive-points", condition=positive, true_points=Decimal("2"), false_points=Decimal("-1"),
        ),), clamp_min=Decimal("0"), clamp_max=Decimal("5"),
    )
    result = execute_program_v2(program(selection_statement(score)), snapshot(), cutoff_index=4)
    assert result.selection_outputs["chosen"][:1] == ("B",)
    truth = NOfMConditionV2(
        semantic_id="two-of-three", minimum_true=2,
        children=(positive, StateConditionV2(semantic_id="idle", state_key="phase", expected="idle"),
                  EventWindowConditionV2(semantic_id="missing-event-window", event_id="not-yet", relation="after")),
    )
    with pytest.raises(ProgramExecutionError, match="unknown_event_reference"):
        execute_program_v2(program(EventStatementV2(
            semantic_id="invalid-event", event=EventDefinitionV2(
                semantic_id="event", clock_id="daily-close", condition=truth,
            ), statements=(allocation(),),
        )), snapshot())


def test_n_of_m_three_valued_threshold_is_not_boolean_count_coercion() -> None:
    never = EventStatementV2(
        semantic_id="never-event-statement", event=EventDefinitionV2(
            semantic_id="never-event", clock_id="daily-close",
            condition=compare(observe("A", "never-a"), "gt", literal("100", "never-100"), "never-condition"),
        ), statements=(RememberValueStatementV2(
            semantic_id="never-memory", memory_id="never-memory-id", value=observe("A", "never-value"),
        ),),
    )
    children = (
        compare(observe("A", "true-a"), "gt", literal("0", "true-zero"), "true-child"),
        compare(observe("A", "false-a"), "gt", literal("100", "false-level"), "false-child"),
        EventWindowConditionV2(semantic_id="unknown-child", event_id="never-event", relation="after"),
    )
    threshold = EventStatementV2(
        semantic_id="threshold-event-statement", event=EventDefinitionV2(
            semantic_id="threshold-event", clock_id="daily-close",
            condition=NOfMConditionV2(semantic_id="two-of-three-runtime", minimum_true=2, children=children),
            trigger="while_true",
        ), statements=(RememberValueStatementV2(
            semantic_id="threshold-memory", memory_id="threshold-result", value=observe("A", "threshold-value"),
        ),),
    )
    result = execute_program_v2(program(never, threshold), snapshot(), cutoff_index=4)
    threshold_evidence = next(item for item in result.evidence if item.semantic_id == "threshold-event-statement")
    assert threshold_evidence.outcome == "not_triggered"
    assert result.event_truths["threshold-event"] == "unknown"


def test_event_state_sequence_memory_and_ordinal_are_checkpoint_deterministic() -> None:
    crossing = compare(observe("A", "cross-price"), "gt", literal("12", "cross-level"), "crossing")
    remember = RememberValueStatementV2(
        semantic_id="remember-entry", memory_id="entry-level", value=observe("A", "entry-price"),
    )
    event = EventStatementV2(
        semantic_id="entry-event-statement",
        event=EventDefinitionV2(
            semantic_id="entry-event", clock_id="daily-close", condition=crossing,
            trigger="crosses_above", occurrence="first",
        ),
        statements=(remember, StateTransitionStatementV2(
            semantic_id="enter-position", transition=StateTransitionV2(
                semantic_id="enter-position-transition", state_key="phase", from_value="idle", to_value="entered",
                when=StateConditionV2(semantic_id="still-idle", state_key="phase", expected="idle"),
            ),
        )),
    )
    entered = execute_program_v2(program(event), snapshot(), cutoff_index=3)
    assert entered.state == {"phase": "entered"}
    assert entered.remembered_values == {"entry-level": Decimal("13")}
    assert entered.event_counts == {"entry-event": 1}
    remembered = RememberedValueV2(
        semantic_id="remembered-entry", memory_id="entry-level", quantity=Quantity.PRICE,
        unit=Unit.USD_PER_SHARE, refinement="adjusted_close",
    )
    exit_condition = compare(observe("A", "later-price"), "gt", remembered, "above-entry")
    later = execute_program_v2(
        program(event), snapshot(), cutoff_index=4, prior_state=entered.state,
        event_cutoffs=entered.event_cutoffs, prior_event_truths=entered.event_truths,
        event_counts=entered.event_counts, state_entered_cutoffs=entered.state_entered_cutoffs,
        remembered_values=entered.remembered_values,
    )
    assert later.event_counts["entry-event"] == 1
    assert later.remembered_values["entry-level"] == Decimal("13")
    # The remembered structural value participates in ordinary typed comparison.
    probe = program(EventStatementV2(
        semantic_id="exit-event-statement",
        event=EventDefinitionV2(semantic_id="exit-event", clock_id="daily-close", condition=exit_condition, trigger="while_true"),
        statements=(RememberValueStatementV2(semantic_id="exit-marker", memory_id="exit-level", value=observe("A", "exit-price")),),
    ), RememberValueStatementV2(semantic_id="declare-entry-memory", memory_id="entry-level", value=observe("A", "seed-entry")))
    assert validate_program_v2(probe) == ()


def test_breakout_retest_confirmation_is_an_event_state_sequence_not_a_workflow_dsl() -> None:
    source = snapshot()
    shaped = DailyMarketSnapshot(
        snapshot_id="breakout-sequence", clock=source.clock, dates=source.dates,
        domains=source.domains,
        series={**source.series, "A": {"close:adjusted": tuple(map(Decimal, ("10", "11", "13", "12", "14", "15")))}},
    )
    breakout_condition = compare(observe("A", "breakout-price"), "gt", literal("12", "breakout-level"), "breakout-condition")
    retest_condition = BooleanGroupV2(
        kind="all", semantic_id="retest-condition", children=(
            StateConditionV2(semantic_id="is-broken", state_key="phase", expected="broken"),
            compare(observe("A", "retest-price"), "lte", literal("12", "retest-level"), "retest-level-condition"),
        ),
    )
    confirmation_condition = BooleanGroupV2(
        kind="all", semantic_id="confirmation-condition", children=(
            StateConditionV2(semantic_id="is-retested", state_key="phase", expected="retested"),
            compare(observe("A", "confirmation-price"), "gt", literal("13", "confirmation-level"), "confirmation-level-condition"),
        ),
    )
    def transition(statement_id: str, transition_id: str, before: str, after: str, condition) -> StateTransitionStatementV2:
        return StateTransitionStatementV2(
            semantic_id=statement_id, transition=StateTransitionV2(
                semantic_id=transition_id, state_key="phase", from_value=before, to_value=after, when=condition,
            ),
        )
    core = program(
        EventStatementV2(
            semantic_id="breakout-event-statement", event=EventDefinitionV2(
                semantic_id="breakout-event", clock_id="daily-close", condition=breakout_condition, trigger="crosses_above",
            ), statements=(transition("breakout-transition-statement", "breakout-transition", "idle", "broken",
                                     StateConditionV2(semantic_id="breakout-idle", state_key="phase", expected="idle")),),
        ),
        EventStatementV2(
            semantic_id="retest-event-statement", event=EventDefinitionV2(
                semantic_id="retest-event", clock_id="daily-close", condition=retest_condition, trigger="while_true",
            ), statements=(transition("retest-transition-statement", "retest-transition", "broken", "retested",
                                     StateConditionV2(semantic_id="retest-broken", state_key="phase", expected="broken")),),
        ),
        EventStatementV2(
            semantic_id="confirmation-event-statement", event=EventDefinitionV2(
                semantic_id="confirmation-event", clock_id="daily-close", condition=confirmation_condition, trigger="while_true",
            ), statements=(transition("confirm-transition-statement", "confirm-transition", "retested", "confirmed",
                                     StateConditionV2(semantic_id="confirm-retested", state_key="phase", expected="retested")),),
        ),
    )
    checkpoint = None
    for cutoff, expected in ((2, "broken"), (3, "retested"), (4, "confirmed")):
        result = execute_program_v2(
            core, shaped, cutoff_index=cutoff,
            prior_state=None if checkpoint is None else checkpoint.state,
            event_cutoffs=None if checkpoint is None else checkpoint.event_cutoffs,
            prior_event_truths=None if checkpoint is None else checkpoint.event_truths,
            event_counts=None if checkpoint is None else checkpoint.event_counts,
            state_entered_cutoffs=None if checkpoint is None else checkpoint.state_entered_cutoffs,
            remembered_values=None if checkpoint is None else checkpoint.remembered_values,
        )
        assert result.state["phase"] == expected
        checkpoint = result


def test_higher_timeframe_context_uses_only_completed_boundary() -> None:
    weekly = ProgramClockV2(id="weekly-close", timeframe="weekly")
    daily = ProgramClockV2(id="daily-close", timeframe="daily")
    weekly_value = ClockedValueV2(
        semantic_id="weekly-context", source=observe("A", "weekly-source"), clock_id="weekly-close",
    )
    condition = compare(weekly_value, "gt", literal("13", "weekly-threshold"), "weekly-positive")
    core = program(EventStatementV2(
        semantic_id="ltf-trigger", event=EventDefinitionV2(
            semantic_id="ltf-event", clock_id="daily-close", condition=condition, trigger="while_true",
        ), statements=(RememberValueStatementV2(
            semantic_id="remember-context", memory_id="context", value=weekly_value,
        ),),
    ), clocks=(daily, weekly))
    monday = execute_program_v2(core, snapshot(), cutoff_index=5)
    assert monday.remembered_values["context"] == Decimal("14")
    assert next(item for item in monday.value_observations if item.semantic_id == "weekly-context").observed_at == "2026-01-09"
    base = snapshot()
    extended = DailyMarketSnapshot(
        snapshot_id="future-extended", clock=base.clock,
        dates=base.dates + ("2026-01-13",), domains=base.domains,
        series={symbol: {
            field: values + (Decimal("999"),) for field, values in fields.items()
        } for symbol, fields in base.series.items()},
    )
    extended_result = execute_program_v2(core, extended, cutoff_index=5)
    assert extended_result.remembered_values["context"] == monday.remembered_values["context"]


def test_proportional_inverse_bounds_cash_and_overlapping_exposure() -> None:
    result = execute_program_v2(
        program(selection_statement(candidate_return()), allocation(
            "proportional_score", maximum_weight=Decimal("0.4"), cash_remainder_asset="CASH",
        )), snapshot(), cutoff_index=4,
    )
    assert sum(result.target_weights.values(), Decimal(0)) == Decimal(1)
    assert result.target_weights["CASH"] > 0
    inverse = execute_program_v2(
        program(selection_statement(candidate_return()), allocation("inverse_volatility")), snapshot(), cutoff_index=4,
    )
    assert sum(inverse.target_weights.values(), Decimal(0)) == Decimal(1)
    with pytest.raises(ValueError, match="minimum_weight"):
        allocation("proportional_score", minimum_weight=Decimal("0.8"), maximum_weight=Decimal("0.2"))


def test_policy_precedence_is_explicit_and_conflicts_are_rejected() -> None:
    no_trade = compare(observe("A", "guard-price"), "gt", literal("0", "guard-zero"), "no-trade")
    primary = AllocationStatementV2(
        semantic_id="primary", method="fixed", legs=(AllocationLegV2(
            semantic_id="primary-leg", target=AllocationTargetV2(semantic_id="primary-target", kind="asset", ref="A"), weight=Decimal(1),
        ),),
    )
    cash = AllocationStatementV2(
        semantic_id="cash", method="fixed", legs=(AllocationLegV2(
            semantic_id="cash-leg", target=AllocationTargetV2(semantic_id="cash-target", kind="cash"), weight=Decimal(1),
        ),),
    )
    guarded = GuardedAllocationStatementV2(
        semantic_id="policy", primary=primary,
        overrides=(OverrideRuleV2(semantic_id="no-trade-override", priority=100, when=no_trade, action=cash),),
    )
    result = execute_program_v2(program(guarded), snapshot(), cutoff_index=4)
    assert result.target_weights == {"CASH": Decimal(1)}
    reason = next(item for item in result.evidence if item.kind == "policy_precedence")
    assert reason.detail == "rule=no-trade-override; priority=100"
    duplicate = guarded.model_copy(update={"overrides": guarded.overrides + (
        OverrideRuleV2(semantic_id="tie", priority=100, when=no_trade, action=cash.model_copy(update={"semantic_id": "cash-2"})),
    )})
    assert any(item.code == "duplicate_override_priority" for item in validate_program_v2(program(duplicate)))


def test_fuzzy_text_is_non_executable_and_formalization_preserves_phrase() -> None:
    unresolved = UnresolvedStatementV2(
        semantic_id="strong-breakout", source_text="buy on a strong breakout",
        category="fuzzy_term", reason="strong is not formally defined",
    )
    core = program(
        unresolved,
        formalizations=(FormalizationProvenanceV2(
            source_phrase="strong breakout", status="unresolved",
        ),),
    )
    issues = validate_program_v2(core)
    assert {item.code for item in issues} >= {"unresolved_semantics", "unresolved_formalization"}
    with pytest.raises(ProgramExecutionError, match="unresolved"):
        execute_program_v2(core, snapshot())
    concrete = RememberValueStatementV2(
        semantic_id="formal-breakout", memory_id="breakout-level", value=observe("A", "formal-breakout-value"),
    )
    formalized = program(concrete, formalizations=(FormalizationProvenanceV2(
        source_phrase="strong breakout", status="formalized",
        semantic_ids=("formal-breakout", "formal-breakout-value"),
        interpretation="A close above the explicitly configured structural level.",
    ),))
    assert validate_program_v2(formalized) == ()


def test_counterexamples_missing_history_retain_mix_and_shared_identity() -> None:
    relative = EventRelativeValueV2(
        semantic_id="relative-value", event_id="event", source=observe("A", "relative-source"),
    )
    event = EventStatementV2(
        semantic_id="event-statement", event=EventDefinitionV2(
            semantic_id="event", clock_id="daily-close",
            condition=compare(observe("A", "event-price"), "gt", literal("100", "event-level"), "never"),
        ), statements=(RememberValueStatementV2(
            semantic_id="remember-relative", memory_id="relative", value=relative,
        ),),
    )
    result = execute_program_v2(program(event), snapshot(), cutoff_index=4)
    assert result.event_cutoffs == {}
    with pytest.raises(ValueError, match="retain must be the sole target"):
        AllocationStatementV2(
            semantic_id="bad-retain", method="equal", legs=(
                AllocationLegV2(semantic_id="retain", target=AllocationTargetV2(semantic_id="retain-target", kind="retain")),
                AllocationLegV2(semantic_id="mutate", target=AllocationTargetV2(semantic_id="asset-target", kind="asset", ref="A")),
            ),
        )
    shared_a = candidate_return("shared-a")
    shared_b = shared_a.model_copy(update={"semantic_id": "shared-b"})
    assert shared_a.content_hash == shared_b.content_hash
    score = ScoreValueV2(semantic_id="shared-score", terms=(
        ScoreTermV2(semantic_id="shared-term-a", value=shared_a, weight=Decimal(1)),
        ScoreTermV2(semantic_id="shared-term-b", value=shared_b, weight=Decimal(1)),
    ))
    observed = execute_program_v2(program(selection_statement(score)), snapshot(), cutoff_index=4).value_observations
    assert {item.semantic_id for item in observed} >= {"shared-a", "shared-b"}
    invalid_memory = RememberedValueV2(
        semantic_id="invalid-memory", memory_id="not-declared",
        quantity=Quantity.PRICE, unit=Unit.USD_PER_SHARE, refinement="adjusted_close",
    )
    invalid_program = program(EventStatementV2(
        semantic_id="invalid-memory-event", event=EventDefinitionV2(
            semantic_id="invalid-memory-event-id", clock_id="daily-close",
            condition=compare(observe("A", "invalid-memory-price"), "gt", invalid_memory, "invalid-memory-condition"),
            trigger="while_true",
        ), statements=(RememberValueStatementV2(
            semantic_id="irrelevant-memory", memory_id="other-memory", value=observe("A", "other-value"),
        ),),
    ))
    assert any(item.code == "unknown_memory_reference" for item in validate_program_v2(invalid_program))


def test_parallel_state_keys_are_explicit_and_never_inferred_as_nested() -> None:
    true_condition = compare(observe("A", "state-price"), "gt", literal("0", "state-zero"), "state-true")
    core = SemanticProgramV2(
        semantic_id="parallel-state-program",
        clocks=(ProgramClockV2(id="daily-close", timeframe="daily"),),
        initial_state={"phase": "idle", "risk": "normal"},
        statements=(
            StateTransitionStatementV2(
                semantic_id="phase-transition-statement", transition=StateTransitionV2(
                    semantic_id="phase-transition", state_key="phase", from_value="idle", to_value="entered", when=true_condition,
                ),
            ),
            StateTransitionStatementV2(
                semantic_id="risk-transition-statement", transition=StateTransitionV2(
                    semantic_id="risk-transition", state_key="risk", from_value="normal", to_value="blocked", when=true_condition,
                ),
            ),
        ),
    )
    result = execute_program_v2(core, snapshot(), cutoff_index=2)
    assert result.state == {"phase": "entered", "risk": "blocked"}
    assert result.state_entered_cutoffs == {"phase": 2, "risk": 2}


def test_cross_section_normalization_and_missing_member_coverage_are_explicit() -> None:
    normalized = CrossSectionalValueV2(
        semantic_id="normalized-return", source=candidate_return(), domain_id="group", transform="min_max",
    )
    result = execute_program_v2(program(selection_statement(normalized)), snapshot(), cutoff_index=4)
    values = {(item.semantic_id, item.candidate): item for item in result.value_observations}
    assert Decimal(0) < values[("normalized-return", "A")].value < Decimal(1)
    assert values[("normalized-return", "B")].value == Decimal(1)
    assert values[("normalized-return", "C")].value == Decimal(0)

    source = snapshot()
    missing = DailyMarketSnapshot(
        snapshot_id="missing-member", clock=source.clock, dates=source.dates, domains=source.domains,
        series={**source.series, "C": {"close:adjusted": source.series["C"]["close:adjusted"][:-1] + (None,)}},
    )
    result = execute_program_v2(program(selection_statement(normalized)), missing, cutoff_index=5)
    observation = next(
        item for item in result.value_observations
        if item.semantic_id == "normalized-return" and item.candidate == "A"
    )
    assert observation.missing_members == ("C",)
    assert observation.available_members == ("A", "B")


def test_same_timestamp_events_ordered_transitions_and_elapsed_references() -> None:
    true_condition = compare(observe("A", "positive-price"), "gt", literal("11.5", "positive-level"), "turns-true")
    first = EventStatementV2(
        semantic_id="first-event-statement",
        event=EventDefinitionV2(
            semantic_id="first-event", clock_id="daily-close", condition=true_condition,
            trigger="became_true",
        ),
        statements=(RememberValueStatementV2(
            semantic_id="first-memory-statement", memory_id="first-memory", value=observe("A", "first-value"),
        ),),
    )
    second = EventStatementV2(
        semantic_id="second-event-statement",
        event=EventDefinitionV2(
            semantic_id="second-event", clock_id="daily-close", condition=true_condition,
            trigger="became_true",
        ),
        statements=(RememberValueStatementV2(
            semantic_id="second-memory-statement", memory_id="second-memory", value=observe("B", "second-value"),
        ),),
    )
    arm = StateTransitionStatementV2(
        semantic_id="arm", transition=StateTransitionV2(
            semantic_id="arm-transition", state_key="phase", from_value="idle", to_value="armed", when=true_condition,
        ),
    )
    enter = StateTransitionStatementV2(
        semantic_id="enter", transition=StateTransitionV2(
            semantic_id="enter-transition", state_key="phase", from_value="armed", to_value="entered",
            when=StateConditionV2(semantic_id="is-armed", state_key="phase", expected="armed"),
        ),
    )
    result = execute_program_v2(program(first, second, arm, enter), snapshot(), cutoff_index=2)
    assert result.event_cutoffs == {"first-event": 2, "second-event": 2}
    assert result.remembered_values == {"first-memory": Decimal(12), "second-memory": Decimal(11)}
    assert result.state == {"phase": "entered"}
    assert result.state_entered_cutoffs == {"phase": 2}

    elapsed = BarsSinceEventValueV2(semantic_id="elapsed", event_id="first-event")
    elapsed_days = TimeSinceEventValueV2(semantic_id="elapsed-days", event_id="first-event")
    state_days = TimeSinceStateValueV2(semantic_id="state-days", state_key="phase")
    later_program = program(
        first,
        RememberValueStatementV2(
            semantic_id="remember-elapsed", memory_id="elapsed-memory", value=elapsed,
        ),
        RememberValueStatementV2(
            semantic_id="remember-elapsed-days", memory_id="elapsed-days-memory", value=elapsed_days,
        ),
        RememberValueStatementV2(
            semantic_id="remember-state-days", memory_id="state-days-memory", value=state_days,
        ),
    )
    later = execute_program_v2(
        later_program, snapshot(), cutoff_index=4, event_cutoffs=result.event_cutoffs,
        prior_event_truths={"first-event": "true"}, event_counts=result.event_counts,
        state_entered_cutoffs=result.state_entered_cutoffs, prior_state=result.state,
    )
    assert later.remembered_values["elapsed-memory"] == Decimal(2)
    assert later.remembered_values["elapsed-days-memory"] == Decimal(2)
    assert later.remembered_values["state-days-memory"] == Decimal(2)


def test_scheduled_first_ordinal_and_before_within_sequence_contract() -> None:
    scheduled = EventStatementV2(
        semantic_id="schedule-statement",
        event=EventDefinitionV2(
            semantic_id="session-event", clock_id="session-close", trigger="scheduled",
            occurrence="ordinal", ordinal=2,
        ),
        statements=(RememberValueStatementV2(
            semantic_id="scheduled-memory", memory_id="scheduled-level", value=observe("A", "scheduled-price"),
        ),),
    )
    core = program(scheduled, clocks=(ProgramClockV2(id="session-close", timeframe="session"),))
    first = execute_program_v2(core, snapshot(), cutoff_index=0)
    assert first.remembered_values == {}
    second = execute_program_v2(
        core, snapshot(), cutoff_index=1, event_counts=first.event_counts,
        event_cutoffs=first.event_cutoffs, prior_event_truths=first.event_truths,
    )
    assert second.remembered_values == {"scheduled-level": Decimal(11)}
    before = EventWindowConditionV2(semantic_id="before-event", event_id="session-event", relation="before")
    within = EventWindowConditionV2(
        semantic_id="within-event", event_id="session-event", relation="within", observations=2,
    )
    runtime = execute_program_v2(core, snapshot(), cutoff_index=3, event_counts=second.event_counts, event_cutoffs=second.event_cutoffs)
    assert runtime.event_cutoffs["session-event"] == 1
    # Event window semantics are evaluated without consulting future rows.
    from ruletrade.strategy.v2.program_execution import _Runtime
    probe = _Runtime(core, snapshot(), 3, event_cutoffs=second.event_cutoffs)
    assert probe.condition(before) == "false"
    assert probe.condition(within) == "true"


def test_all_zero_negative_scores_and_bounds_conflicts_do_not_mutate_targets() -> None:
    zero = ScoreValueV2(
        semantic_id="zero-score", condition_terms=(ConditionPointTermV2(
            semantic_id="negative-points",
            condition=compare(observe("A", "global-price"), "gt", literal("0", "global-zero"), "global-positive"),
            true_points=Decimal("-1"), false_points=Decimal("-1"), unknown_points=Decimal("-1"),
        ),),
    )
    core = program(selection_statement(zero), allocation("proportional_score"))
    with pytest.raises(ProgramExecutionError, match="allocation_scores_not_positive"):
        execute_program_v2(core, snapshot(), cutoff_index=4)
    with pytest.raises(ProgramExecutionError, match="allocation_floor_conflict"):
        execute_program_v2(
            program(selection_statement(candidate_return()), allocation(
                "proportional_score", minimum_weight=Decimal("0.6"),
            )), snapshot(), cutoff_index=4,
        )


def test_override_beats_fallback_and_unknown_guard_blocks_with_reason() -> None:
    unavailable_selection = selection_statement(candidate_return(), count=4)
    unavailable_selection = unavailable_selection.model_copy(update={
        "selection": unavailable_selection.selection.model_copy(update={"shortage_policy": "require_full"}),
    })
    selected_primary = allocation()
    fallback = AllocationStatementV2(
        semantic_id="fallback", method="fixed", legs=(AllocationLegV2(
            semantic_id="fallback-leg", target=AllocationTargetV2(semantic_id="fallback-target", kind="cash"), weight=Decimal(1),
        ),),
    )
    override_action = AllocationStatementV2(
        semantic_id="override-action", method="fixed", legs=(AllocationLegV2(
            semantic_id="override-leg", target=AllocationTargetV2(semantic_id="override-target", kind="asset", ref="A"), weight=Decimal(1),
        ),),
    )
    override = OverrideRuleV2(
        semantic_id="override", priority=10,
        when=compare(observe("A", "override-price"), "gt", literal("0", "override-zero"), "override-true"),
        action=override_action,
    )
    policy = GuardedAllocationStatementV2(
        semantic_id="policy", primary=selected_primary, overrides=(override,), fallback=fallback,
    )
    result = execute_program_v2(program(unavailable_selection, policy), snapshot(), cutoff_index=4)
    assert result.target_weights == {"A": Decimal(1)}
    assert any(item.kind == "policy_precedence" and item.outcome == "override" for item in result.evidence)

    missing_event = EventWindowConditionV2(
        semantic_id="missing-event-guard", event_id="declared-event", relation="after",
    )
    declared = EventStatementV2(
        semantic_id="declared-event-statement", event=EventDefinitionV2(
            semantic_id="declared-event", clock_id="daily-close",
            condition=compare(observe("A", "never-price"), "gt", literal("100", "never-level"), "never-condition"),
        ), statements=(fallback,),
    )
    blocked = execute_program_v2(
        program(declared, GuardedAllocationStatementV2(
            semantic_id="blocked-policy", guard=missing_event, primary=override_action,
        )), snapshot(), cutoff_index=4,
    )
    assert blocked.retained_holdings is True
    assert any(item.outcome == "guard_blocked" and item.detail == "unknown" for item in blocked.evidence)


def test_capability_ledger_keeps_program_core_reference_only_and_provider_honest() -> None:
    ledger = v2_capabilities()
    for key in (
        "program.cross_sectional_normalization@1", "program.condition_points@1",
        "program.scheduled_event@1", "program.remembered_value@1",
        "program.score_allocation@1", "program.allocation_bounds@1",
    ):
        assert ledger[key].reference_evaluable is True
        assert ledger[key].backend_lowerable is False
        assert ledger[key].authoring_reachable is False
        assert ledger[key].verified_profile is False
    assert ledger["daily.volume_raw_shares@1"].provider_available is False
