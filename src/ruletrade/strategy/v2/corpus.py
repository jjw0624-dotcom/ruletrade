"""Repository-native semantic strategy corpus.

The corpus is deliberately independent of the Builder.  The JSON manifest records
provenance, formalization state, capability dimensions, and a stable fixture key.
This module resolves fully formalized fixture keys to ordinary ``SemanticProgramV2``
documents and evaluates them with the production reference runtime.
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator

from ruletrade.strategy.v1.models import GroupDefinition, StrategyMetadata
from ruletrade.strategy.v2.daily_values import (
    DailyMarketSnapshot,
    DailyValueNode,
    MarketField,
    PriceBasis,
    SubjectKind,
)
from ruletrade.strategy.v2.models import (
    AssetSetDefinitionV2,
    AllocationLegV2,
    AllocationStatementV2,
    AllocationTargetV2,
    BarsSinceEventValueV2,
    BooleanGroupV2,
    CandidateBinding,
    CanonicalStrategyV2,
    ClockedValueV2,
    ComparisonV2,
    CrossSectionalAggregateValueV2,
    CrossSectionalValueV2,
    EventDefinitionV2,
    EventStatementV2,
    EventWindowConditionV2,
    GuardedAllocationStatementV2,
    LiteralValue,
    NOfMConditionV2,
    OverrideRuleV2,
    ProgramClockV2,
    RememberedValueV2,
    RememberValueStatementV2,
    ScoreTermV2,
    ScoreValueV2,
    SelectionStatementV2,
    SelectionV2,
    SemanticProgramV2,
    StateConditionV2,
    StateTransitionStatementV2,
    StateTransitionV2,
    StrategyDefinitionsV2,
)
from ruletrade.strategy.v2.program_execution import ProgramExecutionResult, execute_program_v2
from ruletrade.strategy.v2.semantic_types import Axis, Clock, FrozenModel, Quantity, Unit


class CorpusCapabilities(FrozenModel):
    representable: bool
    reference_evaluable: bool
    backend_lowerable: bool
    docker_verified: bool
    provider_supported: bool
    ui_authorable: bool

    @model_validator(mode="after")
    def validate_implications(self) -> "CorpusCapabilities":
        if self.docker_verified and not self.backend_lowerable:
            raise ValueError("Docker verification requires backend lowering")
        if self.backend_lowerable and not self.reference_evaluable:
            raise ValueError("backend lowering requires a reference oracle")
        if self.reference_evaluable and not self.representable:
            raise ValueError("reference evaluation requires representation")
        return self


class CorpusProvenance(FrozenModel):
    source_kind: Literal["product_example", "architecture_stress", "counterexample", "research_pattern"]
    source_reference: str
    source_phrase: str
    interpretation: str | None = None


class CorpusEntry(FrozenModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]+$")
    family: str
    title: str
    provenance: CorpusProvenance
    formalization_status: Literal["formalized", "partial", "ambiguous", "unsupported"]
    fixture: str | None = None
    dependencies: tuple[str, ...] = ()
    expected_behavior: dict[str, object] = Field(default_factory=dict)
    capabilities: CorpusCapabilities
    limitation: str | None = None

    @model_validator(mode="after")
    def validate_fixture(self) -> "CorpusEntry":
        if self.formalization_status == "formalized" and self.fixture is None:
            raise ValueError("formalized corpus entries require a canonical fixture")
        if self.fixture is not None and not self.capabilities.representable:
            raise ValueError("canonical fixtures require representable semantics")
        if self.formalization_status in {"ambiguous", "unsupported"} and not self.limitation:
            raise ValueError("ambiguous/unsupported entries require a limitation")
        return self


class CorpusManifest(FrozenModel):
    schema_version: Literal["ruletrade.dev/semantic-corpus/v1"]
    corpus_id: str
    entries: tuple[CorpusEntry, ...]

    @model_validator(mode="after")
    def validate_identity(self) -> "CorpusManifest":
        ids = [entry.id for entry in self.entries]
        if len(ids) != len(set(ids)):
            raise ValueError("corpus entry ids must be unique")
        fixtures = {entry.fixture for entry in self.entries if entry.fixture is not None}
        unknown = fixtures - set(PROGRAM_FIXTURES)
        if unknown:
            raise ValueError(f"unknown corpus fixtures: {', '.join(sorted(unknown))}")
        return self


def load_corpus(path: Path) -> CorpusManifest:
    return CorpusManifest.model_validate(json.loads(path.read_text(encoding="utf-8")))


def reference_snapshot() -> DailyMarketSnapshot:
    dates: list[str] = []
    current = date(2026, 1, 5)
    while len(dates) < 130:
        if current.weekday() < 5:
            dates.append(current.isoformat())
        current += timedelta(days=1)
    first_a = tuple(map(Decimal, ("10", "11", "12", "13", "14", "15")))
    first_b = tuple(map(Decimal, ("10", "10", "11", "11", "12", "12")))
    first_c = tuple(map(Decimal, ("10", "9", "8", "9", "8", "7")))
    tail = range(6, 130)
    return DailyMarketSnapshot(
        snapshot_id="semantic-corpus-synthetic-v1",
        clock=Clock(id="daily-close"),
        dates=tuple(dates),
        domains={"growth": ("A", "B", "C")},
        series={
            "A": {"close:adjusted": first_a + tuple(Decimal(10 + index) for index in tail)},
            "B": {"close:adjusted": first_b + tuple(Decimal(20 + 2 * index) for index in tail)},
            "C": {"close:adjusted": first_c + tuple(max(Decimal(1), Decimal(13 - index)) for index in tail)},
            "TLT": {"close:adjusted": (Decimal(20),) * 130},
            "CASH": {"close:adjusted": (Decimal(1),) * 130},
        },
    )


def temporal_reference_snapshot() -> DailyMarketSnapshot:
    return DailyMarketSnapshot(
        snapshot_id="lean-temporal-data@1", clock=Clock(id="daily-close"),
        dates=("2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08", "2024-01-09", "2024-01-10"),
        domains={"temporal-group": ("QQQ",)},
        series={"QQQ": {"close:adjusted": tuple(map(Decimal, ("10", "11", "13", "12", "14", "14", "14")))}},
    )


def temporal_multiclock_reference_snapshot() -> DailyMarketSnapshot:
    return DailyMarketSnapshot(
        snapshot_id="lean-multiclock-data@1", clock=Clock(id="daily-close"),
        dates=("2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05",
               "2024-01-08", "2024-01-09", "2024-01-10"),
        domains={"temporal-group": ("QQQ",)},
        series={"QQQ": {"close:adjusted": tuple(map(
            Decimal, ("10", "11", "13", "14", "13", "12", "15"),
        ))}},
    )


def _asset(symbol: str, semantic_id: str) -> DailyValueNode:
    return DailyValueNode(
        semantic_id=semantic_id,
        kind="observe",
        subject_kind=SubjectKind.ASSET,
        subject_id=symbol,
        field=MarketField.CLOSE,
        basis=PriceBasis.ADJUSTED,
    )


def _candidate_return(semantic_id: str, observations: int = 1) -> DailyValueNode:
    return DailyValueNode(
        semantic_id=semantic_id,
        kind="trailing_return",
        observations=observations,
        operands=(DailyValueNode(
            semantic_id=f"{semantic_id}-source",
            kind="observe",
            subject_kind=SubjectKind.CANDIDATE,
            binding_id="candidate",
            field=MarketField.CLOSE,
            basis=PriceBasis.ADJUSTED,
        ),),
    )


def _price_literal(value: str, semantic_id: str) -> LiteralValue:
    return LiteralValue(
        semantic_id=semantic_id,
        value=Decimal(value),
        quantity=Quantity.PRICE,
        unit=Unit.USD_PER_SHARE,
        refinement="adjusted_close",
    )


def _return_literal(value: str, semantic_id: str) -> DailyValueNode:
    return DailyValueNode(
        semantic_id=semantic_id,
        kind="literal",
        value=Decimal(value),
        quantity=Quantity.RETURN,
        unit=Unit.RATIO,
        refinement="trailing_return:adjusted_close",
    )


def _comparison(semantic_id: str, left, operator: str, right) -> ComparisonV2:
    return ComparisonV2(semantic_id=semantic_id, left=left, operator=operator, right=right)


def _program(*statements, clocks: tuple[ProgramClockV2, ...] | None = None, initial_state=None) -> SemanticProgramV2:
    return SemanticProgramV2(
        semantic_id="program",
        clocks=clocks or (ProgramClockV2(id="daily-close", timeframe="daily"),),
        initial_state=initial_state or {},
        statements=statements,
    )


def _selection(
    ranking, *, eligibility=None, count: int = 2, fallback: str | None = None,
    clock_id: str | None = None,
) -> SelectionStatementV2:
    return SelectionStatementV2(
        semantic_id="select-growth",
        output_id="selected-growth",
        clock_id=clock_id,
        selection=SelectionV2(
            semantic_id="growth-selection",
            universe_id="growth",
            binding=CandidateBinding(id="candidate", domain_id="growth"),
            eligibility=eligibility,
            ranking=ranking,
            direction="descending",
            count=count,
            shortage_policy="require_full" if fallback else "choose_all",
            fallback_asset=fallback,
        ),
    )


def _equal_allocation(clock_id: str | None = None) -> AllocationStatementV2:
    return AllocationStatementV2(
        semantic_id="allocate-selection",
        method="equal",
        clock_id=clock_id,
        legs=(AllocationLegV2(
            semantic_id="selection-leg",
            target=AllocationTargetV2(
                semantic_id="selection-target", kind="selection", ref="selected-growth",
            ),
        ),),
    )


def strongest_etfs_program(*, timeframe: Literal["daily", "monthly"] = "daily") -> SemanticProgramV2:
    clock_id = f"{timeframe}-close"
    eligibility = _comparison(
        "positive-return", _candidate_return("eligibility-return", 126), "gt",
        _return_literal("0", "zero-return"),
    )
    return _program(
        _selection(
            _candidate_return("ranking-return", 126), eligibility=eligibility,
            fallback="TLT", clock_id=clock_id,
        ),
        _equal_allocation(clock_id),
        clocks=(ProgramClockV2(id=clock_id, timeframe=timeframe),),
    )


def strongest_etfs_strategy(*, timeframe: Literal["daily", "monthly"] = "monthly") -> CanonicalStrategyV2:
    """The maintained V2 executable profile used by compile and Docker proof."""
    return CanonicalStrategyV2(
        semantic_profile="profile-a/daily-compositional-core@1",
        metadata=StrategyMetadata(name="Strongest ETFs corpus profile"),
        definitions=StrategyDefinitionsV2(
            asset_sets=(AssetSetDefinitionV2(
                id="growth-assets", assets=["QQQ", "VGT", "SOXX", "SCHG"],
            ),),
            groups=(GroupDefinition(
                id="growth", name="Investment", asset_set_ref="growth-assets",
            ),),
            asset_axis=Axis(name="asset", domain_id="growth"),
        ),
        operator_lock={"compare": "1", "daily.trailing_return": "1"},
        program=strongest_etfs_program(timeframe=timeframe),
    )


def weighted_momentum_allocation_program(
    *,
    short_observations: int = 1,
    long_observations: int = 3,
    timeframe: Literal["daily", "monthly"] = "daily",
) -> SemanticProgramV2:
    """Weighted multi-horizon momentum with score-proportional targets."""

    clock_id = f"{timeframe}-close"
    score = ScoreValueV2(
        semantic_id="weighted-momentum-score",
        terms=(
            ScoreTermV2(
                semantic_id="short-return-term",
                value=_candidate_return("short-return", short_observations),
                weight=Decimal("0.6"),
            ),
            ScoreTermV2(
                semantic_id="long-return-term",
                value=_candidate_return("long-return", long_observations),
                weight=Decimal("0.4"),
            ),
        ),
        normalization="sum_abs",
        clamp_min=Decimal("0.000001"),
    )
    allocation = AllocationStatementV2(
        semantic_id="allocate-by-score",
        method="proportional_score",
        clock_id=clock_id,
        legs=(AllocationLegV2(
            semantic_id="score-selection-leg",
            target=AllocationTargetV2(
                semantic_id="score-selection-target",
                kind="selection",
                ref="selected-growth",
            ),
        ),),
    )
    return _program(
        _selection(score, count=2, clock_id=clock_id),
        allocation,
        clocks=(ProgramClockV2(id=clock_id, timeframe=timeframe),),
    )


def weighted_momentum_allocation_strategy(
    *, timeframe: Literal["daily", "monthly"] = "daily",
) -> CanonicalStrategyV2:
    return CanonicalStrategyV2(
        semantic_profile="profile-a/daily-compositional-core@1",
        metadata=StrategyMetadata(name="Weighted momentum score allocation corpus profile"),
        definitions=StrategyDefinitionsV2(
            asset_sets=(AssetSetDefinitionV2(
                id="growth-assets", assets=["QQQ", "VGT", "SOXX", "SCHG"],
            ),),
            groups=(GroupDefinition(
                id="growth", name="Investment", asset_set_ref="growth-assets",
            ),),
            asset_axis=Axis(name="asset", domain_id="growth"),
        ),
        operator_lock={"compare": "1", "daily.trailing_return": "1", "program.score": "1"},
        program=weighted_momentum_allocation_program(
            short_observations=21,
            long_observations=63,
            timeframe=timeframe,
        ),
    )


def price_over_sma_program() -> SemanticProgramV2:
    price = _asset("A", "asset-a-price")
    sma = DailyValueNode(semantic_id="asset-a-sma", kind="sma", observations=3, operands=(price,))
    return _program(EventStatementV2(
        semantic_id="price-event-statement",
        event=EventDefinitionV2(
            semantic_id="price-over-sma-event", clock_id="daily-close",
            condition=_comparison("price-over-sma", price, "gt", sma), trigger="while_true",
        ),
        statements=(RememberValueStatementV2(
            semantic_id="remember-price", memory_id="observed-price", value=price,
        ),),
    ))


def group_median_program() -> SemanticProgramV2:
    median = CrossSectionalAggregateValueV2(
        semantic_id="group-median-return", source=_candidate_return("median-source"),
        domain_id="growth", reduction="median",
    )
    eligibility = _comparison(
        "above-group-median", _candidate_return("candidate-return"), "gt", median,
    )
    return _program(_selection(_candidate_return("ranking-return"), eligibility=eligibility), _equal_allocation())


def composite_score_program() -> SemanticProgramV2:
    rank = CrossSectionalValueV2(
        semantic_id="return-rank", source=_candidate_return("rank-source"),
        domain_id="growth", transform="rank",
    )
    percentile = CrossSectionalValueV2(
        semantic_id="return-percentile", source=_candidate_return("percentile-source"),
        domain_id="growth", transform="percentile",
    )
    score = ScoreValueV2(
        semantic_id="composite-score",
        terms=(
            ScoreTermV2(semantic_id="rank-term", value=rank, weight=Decimal("1")),
            ScoreTermV2(semantic_id="percentile-term", value=percentile, weight=Decimal("1")),
        ),
        normalization="sum_abs",
    )
    selected = _selection(score)
    selected = selected.model_copy(update={
        "selection": selected.selection.model_copy(update={"direction": "ascending"}),
    })
    return _program(selected, _equal_allocation())


def n_of_m_program() -> SemanticProgramV2:
    condition = NOfMConditionV2(
        semantic_id="two-of-three", minimum_true=2,
        children=(
            _comparison("a-positive", _asset("A", "a-price"), "gt", _price_literal("0", "zero-a")),
            _comparison("b-positive", _asset("B", "b-price"), "gt", _price_literal("0", "zero-b")),
            _comparison("c-high", _asset("C", "c-price"), "gt", _price_literal("100", "hundred")),
        ),
    )
    return _program(EventStatementV2(
        semantic_id="threshold-event-statement",
        event=EventDefinitionV2(
            semantic_id="threshold-event", clock_id="daily-close", condition=condition,
            trigger="while_true",
        ),
        statements=(RememberValueStatementV2(
            semantic_id="remember-threshold", memory_id="threshold-price", value=_asset("A", "threshold-price"),
        ),),
    ))


def breakout_retest_program() -> SemanticProgramV2:
    positive = _comparison("positive-price", _asset("A", "sequence-price"), "gt", _price_literal("11", "sequence-level"))
    arm = StateTransitionStatementV2(
        semantic_id="arm-statement",
        transition=StateTransitionV2(
            semantic_id="arm-transition", state_key="phase", from_value="idle", to_value="armed", when=positive,
        ),
    )
    enter = StateTransitionStatementV2(
        semantic_id="enter-statement",
        transition=StateTransitionV2(
            semantic_id="enter-transition", state_key="phase", from_value="armed", to_value="entered",
            when=StateConditionV2(semantic_id="is-armed", state_key="phase", expected="armed"),
        ),
    )
    return _program(arm, enter, initial_state={"phase": "idle"})


def higher_timeframe_program() -> SemanticProgramV2:
    weekly = ClockedValueV2(
        semantic_id="weekly-close-value", source=_asset("A", "weekly-close-source"), clock_id="weekly-close",
    )
    return _program(
        EventStatementV2(
            semantic_id="weekly-context-event-statement",
            event=EventDefinitionV2(
                semantic_id="weekly-context-event", clock_id="daily-close",
                condition=_comparison("weekly-above-level", weekly, "gt", _price_literal("13", "weekly-level")),
                trigger="while_true",
            ),
            statements=(RememberValueStatementV2(
                semantic_id="remember-weekly-context", memory_id="weekly-context", value=weekly,
            ),),
        ),
        clocks=(
            ProgramClockV2(id="daily-close", timeframe="daily"),
            ProgramClockV2(id="weekly-close", timeframe="weekly"),
        ),
    )


def policy_override_program() -> SemanticProgramV2:
    primary = AllocationStatementV2(
        semantic_id="primary-allocation", method="fixed",
        legs=(AllocationLegV2(
            semantic_id="primary-leg",
            target=AllocationTargetV2(semantic_id="primary-target", kind="asset", ref="A"),
            weight=Decimal(1),
        ),),
    )
    cash = AllocationStatementV2(
        semantic_id="cash-allocation", method="fixed",
        legs=(AllocationLegV2(
            semantic_id="cash-leg",
            target=AllocationTargetV2(semantic_id="cash-target", kind="cash"),
            weight=Decimal(1),
        ),),
    )
    return _program(GuardedAllocationStatementV2(
        semantic_id="risk-policy", primary=primary,
        overrides=(OverrideRuleV2(
            semantic_id="cash-override", priority=100,
            when=_comparison("risk-trigger", _asset("A", "risk-price"), "gt", _price_literal("0", "risk-zero")),
            action=cash,
        ),),
    ))


def temporal_breakout_program() -> SemanticProgramV2:
    """Synthetic, fully specified daily breakout/retest/confirmation profile.

    Assumptions are deliberately fixture-local: QQQ breaks above 12, the
    completed breakout close is remembered, a retest is strictly below that
    remembered close, and confirmation must close back above it within two
    completed observations.  This is not attributed to a research fragment.
    """

    price = _asset("QQQ", "temporal-price")
    remembered = RememberedValueV2(
        semantic_id="remembered-breakout-level", memory_id="breakout-level",
        quantity=Quantity.PRICE, unit=Unit.USD_PER_SHARE,
        refinement="adjusted_close",
    )

    def transition(statement_id: str, before: str, after: str) -> StateTransitionStatementV2:
        return StateTransitionStatementV2(
            semantic_id=statement_id,
            transition=StateTransitionV2(
                semantic_id=f"{statement_id}-transition", state_key="phase",
                from_value=before, to_value=after,
                when=StateConditionV2(
                    semantic_id=f"{statement_id}-guard", state_key="phase", expected=before,
                ),
            ),
        )

    breakout = EventStatementV2(
        semantic_id="breakout-event-statement",
        event=EventDefinitionV2(
            semantic_id="breakout-event", clock_id="daily-close",
            condition=_comparison(
                "breakout-condition", price, "gt", _price_literal("12", "breakout-threshold"),
            ),
            trigger="crosses_above", occurrence="first",
        ),
        statements=(
            RememberValueStatementV2(
                semantic_id="remember-breakout", memory_id="breakout-level", value=price,
            ),
            transition("arm-breakout", "idle", "broken"),
        ),
    )
    retest = EventStatementV2(
        semantic_id="retest-event-statement",
        event=EventDefinitionV2(
            semantic_id="retest-event", clock_id="daily-close",
            condition=BooleanGroupV2(
                kind="all", semantic_id="retest-condition", children=(
                    StateConditionV2(
                        semantic_id="retest-state", state_key="phase", expected="broken",
                    ),
                    _comparison("retest-level", price, "lt", remembered),
                    EventWindowConditionV2(
                        semantic_id="retest-window", event_id="breakout-event",
                        relation="within", observations=3,
                    ),
                ),
            ),
            trigger="while_true",
        ),
        statements=(transition("accept-retest", "broken", "retested"),),
    )
    confirmation = EventStatementV2(
        semantic_id="confirmation-event-statement",
        event=EventDefinitionV2(
            semantic_id="confirmation-event", clock_id="daily-close",
            condition=BooleanGroupV2(
                kind="all", semantic_id="confirmation-condition", children=(
                    StateConditionV2(
                        semantic_id="confirmation-state", state_key="phase", expected="retested",
                    ),
                    _comparison("confirmation-level", price, "gt", remembered),
                    EventWindowConditionV2(
                        semantic_id="confirmation-window", event_id="retest-event",
                        relation="within", observations=2,
                    ),
                ),
            ),
            trigger="while_true",
        ),
        statements=(transition("confirm-entry", "retested", "confirmed"),),
    )
    expire = EventStatementV2(
        semantic_id="expiry-event-statement",
        event=EventDefinitionV2(
            semantic_id="expiry-event", clock_id="daily-close",
            condition=BooleanGroupV2(
                kind="all", semantic_id="expiry-condition", children=(
                    StateConditionV2(
                        semantic_id="expiry-state", state_key="phase", expected="retested",
                    ),
                    _comparison(
                        "expiry-window-elapsed",
                        BarsSinceEventValueV2(
                            semantic_id="bars-since-retest", event_id="retest-event",
                        ),
                        "gt",
                        LiteralValue(
                            semantic_id="confirmation-window-size", value=Decimal(2),
                            quantity=Quantity.COUNT, unit=Unit.COUNT,
                            refinement="elapsed_observations@1",
                        ),
                    ),
                ),
            ),
            trigger="while_true",
        ),
        statements=(transition("expire-entry", "retested", "expired"),),
    )

    cash = AllocationStatementV2(
        semantic_id="temporal-cash", method="fixed",
        legs=(AllocationLegV2(
            semantic_id="temporal-cash-leg",
            target=AllocationTargetV2(semantic_id="temporal-cash-target", kind="cash"),
            weight=Decimal(1),
        ),),
    )
    invested = AllocationStatementV2(
        semantic_id="temporal-invested", method="fixed",
        legs=(AllocationLegV2(
            semantic_id="temporal-invested-leg",
            target=AllocationTargetV2(
                semantic_id="temporal-invested-target", kind="asset", ref="QQQ",
            ),
            weight=Decimal(1),
        ),),
    )
    policy = GuardedAllocationStatementV2(
        semantic_id="temporal-policy", primary=cash,
        overrides=(OverrideRuleV2(
            semantic_id="confirmed-override", priority=100,
            when=StateConditionV2(
                semantic_id="confirmed-state", state_key="phase", expected="confirmed",
            ),
            action=invested,
        ),),
    )
    return _program(
        breakout, retest, confirmation, expire, policy,
        initial_state={"phase": "idle"},
    )


def temporal_breakout_strategy() -> CanonicalStrategyV2:
    return CanonicalStrategyV2(
        semantic_profile="profile-a/daily-compositional-core@1",
        metadata=StrategyMetadata(name="Synthetic temporal breakout state machine"),
        definitions=StrategyDefinitionsV2(
            asset_sets=(AssetSetDefinitionV2(id="temporal-assets", assets=["QQQ"]),),
            groups=(GroupDefinition(
                id="temporal-group", name="Temporal investment",
                asset_set_ref="temporal-assets",
            ),),
            asset_axis=Axis(name="asset", domain_id="temporal-group"),
        ),
        operator_lock={
            "compare": "1", "program.event": "1", "program.state": "1",
            "program.memory": "1", "program.policy": "1",
        },
        program=temporal_breakout_program(),
    )


def temporal_multiclock_program() -> SemanticProgramV2:
    """Bounded weekly-context → daily Event/State composition profile."""

    base = temporal_breakout_program()
    breakout = base.statements[0]
    assert isinstance(breakout, EventStatementV2)
    condition = breakout.event.condition
    assert isinstance(condition, ComparisonV2)
    assert isinstance(condition.left, DailyValueNode)
    weekly_value = ClockedValueV2(
        semantic_id="completed-weekly-close",
        source=condition.left,
        clock_id="weekly-close",
    )
    weekly_condition = condition.model_copy(update={"left": weekly_value})
    weekly_breakout = breakout.model_copy(update={
        "event": breakout.event.model_copy(update={"condition": weekly_condition}),
    })
    return base.model_copy(update={
        "clocks": (
            ProgramClockV2(
                id="daily-close", timeframe="daily", timezone="America/New_York",
            ),
            ProgramClockV2(
                id="weekly-close", timeframe="weekly", timezone="America/New_York",
            ),
        ),
        "statements": (weekly_breakout, *base.statements[1:]),
    })


def temporal_multiclock_strategy() -> CanonicalStrategyV2:
    base = temporal_breakout_strategy()
    return base.model_copy(update={
        "metadata": StrategyMetadata(name="Synthetic weekly context and daily state machine"),
        "operator_lock": {
            **base.operator_lock,
            "program.clocked_value": "1",
        },
        "program": temporal_multiclock_program(),
    })


PROGRAM_FIXTURES = {
    "strongest-etfs": strongest_etfs_program,
    "price-over-sma": price_over_sma_program,
    "group-median": group_median_program,
    "composite-score": composite_score_program,
    "n-of-m": n_of_m_program,
    "breakout-retest": breakout_retest_program,
    "higher-timeframe": higher_timeframe_program,
    "policy-override": policy_override_program,
    "weighted-momentum-allocation": weighted_momentum_allocation_program,
    "temporal-breakout-state-machine": temporal_breakout_program,
    "temporal-multiclock-state-machine": temporal_multiclock_program,
}


def corpus_program(entry: CorpusEntry) -> SemanticProgramV2:
    if entry.fixture is None:
        raise ValueError(f"corpus entry {entry.id!r} has no canonical fixture")
    return PROGRAM_FIXTURES[entry.fixture]()


def evaluate_corpus_entry(
    entry: CorpusEntry,
    snapshot: DailyMarketSnapshot | None = None,
    *,
    cutoff_index: int | None = None,
) -> ProgramExecutionResult:
    if not entry.capabilities.reference_evaluable:
        raise ValueError(f"corpus entry {entry.id!r} is not reference-evaluable")
    temporal_fixtures = {
        "temporal-breakout-state-machine", "temporal-multiclock-state-machine",
    }
    resolved_snapshot = snapshot or (
        temporal_reference_snapshot()
        if entry.fixture == "temporal-breakout-state-machine"
        else temporal_multiclock_reference_snapshot()
        if entry.fixture == "temporal-multiclock-state-machine"
        else reference_snapshot()
    )
    if entry.fixture in temporal_fixtures:
        prior = None
        final = None
        last = cutoff_index if cutoff_index is not None else len(resolved_snapshot.dates) - 1
        for index in range(last + 1):
            final = execute_program_v2(
                corpus_program(entry), resolved_snapshot, cutoff_index=index,
                prior_state=None if prior is None else prior.state,
                event_cutoffs=None if prior is None else prior.event_cutoffs,
                prior_event_truths=None if prior is None else prior.event_truths,
                event_counts=None if prior is None else prior.event_counts,
                state_entered_cutoffs=None if prior is None else prior.state_entered_cutoffs,
                remembered_values=None if prior is None else prior.remembered_values,
            )
            prior = final
        assert final is not None
        return final
    return execute_program_v2(corpus_program(entry), resolved_snapshot, cutoff_index=cutoff_index)
