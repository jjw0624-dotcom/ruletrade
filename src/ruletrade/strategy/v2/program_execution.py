"""Deterministic reference execution for the representation-neutral Program Core."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal, ROUND_CEILING
from typing import Iterable

from ruletrade.strategy.v2.daily_values import DailyMarketSnapshot, DailyValueEvaluator, DailyValueNode
from ruletrade.strategy.v2.models import (
    AllocationStatementV2,
    BooleanGroupV2,
    ComparisonV2,
    ConditionalStatementV2,
    CrossSectionalValueV2,
    EventRelativeValueV2,
    EventStatementV2,
    GuardedAllocationStatementV2,
    NotConditionV2,
    ProgramStatementV2,
    ScoreValueV2,
    SelectionStatementV2,
    SemanticProgramV2,
    StateTransitionStatementV2,
    StateConditionV2,
    ValueExpressionV2,
)
from ruletrade.strategy.v2.program_validation import validate_program_v2
from ruletrade.strategy.v2.semantic_types import semantic_content_hash


class ProgramExecutionError(ValueError):
    pass


def _value_content_hash(value: ValueExpressionV2) -> str:
    def without_addresses(payload: object) -> object:
        if isinstance(payload, dict):
            return {
                key: without_addresses(item)
                for key, item in payload.items()
                if key != "semantic_id"
            }
        if isinstance(payload, list):
            return [without_addresses(item) for item in payload]
        return payload

    return semantic_content_hash(without_addresses(value.model_dump(mode="json")))


@dataclass(frozen=True)
class ProgramValueObservation:
    semantic_id: str
    candidate: str | None
    value: Decimal | None
    reason: str | None
    observed_at: str
    expression_hash: str


@dataclass(frozen=True)
class ProgramDecisionEvidence:
    semantic_id: str
    kind: str
    outcome: str
    detail: str


@dataclass(frozen=True)
class ProgramExecutionResult:
    revision_id: str | None
    program_semantic_id: str
    snapshot_id: str
    cutoff: str
    state: dict[str, str]
    event_cutoffs: dict[str, int]
    event_truths: dict[str, str]
    selection_outputs: dict[str, tuple[str, ...]]
    target_weights: dict[str, Decimal]
    retained_holdings: bool
    evidence: tuple[ProgramDecisionEvidence, ...]
    value_observations: tuple[ProgramValueObservation, ...]


class _Runtime:
    def __init__(
        self,
        program: SemanticProgramV2,
        snapshot: DailyMarketSnapshot,
        cutoff: int,
        *,
        prior_state: dict[str, str] | None = None,
        event_cutoffs: dict[str, int] | None = None,
        prior_event_truths: dict[str, str] | None = None,
    ) -> None:
        self.program = program
        self.snapshot = snapshot
        self.cutoff = cutoff
        self.prior_state = dict(program.initial_state if prior_state is None else prior_state)
        self.state = dict(self.prior_state)
        self.selections: dict[str, tuple[str, ...]] = {}
        self.target_weights: dict[str, Decimal] = {}
        self.retained = False
        self.evidence: list[ProgramDecisionEvidence] = []
        self.observations: list[ProgramValueObservation] = []
        self.event_cutoffs: dict[str, int] = dict(event_cutoffs or {})
        self.prior_event_truths: dict[str, str] = dict(prior_event_truths or {})
        self.event_truths: dict[str, str] = {}

    @property
    def observed_at(self) -> str:
        return self.snapshot.dates[self.cutoff]

    def _daily(
        self,
        node: DailyValueNode,
        candidate: str | None,
        binding_id: str | None,
        cutoff: int | None = None,
    ) -> ProgramValueObservation:
        index = self.cutoff if cutoff is None else cutoff
        if index < 0 or index >= len(self.snapshot.dates):
            return ProgramValueObservation(
                node.semantic_id, candidate, None, "event_relative_out_of_range",
                self.observed_at, node.content_hash,
            )
        result = DailyValueEvaluator(self.snapshot, cutoff_index=index).evaluate(
            node, candidate=candidate, binding_id=binding_id,
        )
        if result.axes:
            raise ProgramExecutionError("program_value_must_be_scalar")
        cell = result.cells[()]
        provenance = result.provenance
        observation = ProgramValueObservation(
            node.semantic_id,
            candidate,
            cell.value,
            cell.reason,
            result.observed_at[-1],
            provenance.expression_hash if provenance else node.content_hash,
        )
        self.observations.append(observation)
        return observation

    def value(
        self,
        value: ValueExpressionV2,
        *,
        candidate: str | None,
        binding_id: str | None,
        members: tuple[str, ...] = (),
    ) -> ProgramValueObservation:
        if isinstance(value, DailyValueNode):
            return self._daily(value, candidate, binding_id)
        if isinstance(value, EventRelativeValueV2):
            anchor = self.event_cutoffs.get(value.event_id)
            if anchor is None:
                return ProgramValueObservation(
                    value.semantic_id, candidate, None, "event_not_observed",
                    self.observed_at, _value_content_hash(value),
                )
            observation = self._daily(
                value.source, candidate, binding_id,
                anchor + value.offset_observations,
            )
            relative = ProgramValueObservation(
                value.semantic_id, candidate, observation.value, observation.reason,
                observation.observed_at, _value_content_hash(value),
            )
            self.observations.append(relative)
            return relative
        if isinstance(value, CrossSectionalValueV2):
            if candidate is None:
                raise ProgramExecutionError("cross_section_requires_candidate")
            available: list[tuple[Decimal, str]] = []
            for member in members:
                item = self._daily(value.source, member, binding_id)
                if item.value is not None:
                    available.append((item.value, member))
            available.sort(key=lambda item: item[1])
            available.sort(
                key=lambda item: item[0],
                reverse=value.direction == "descending",
            )
            ordered = [member for _number, member in available]
            if candidate not in ordered:
                result = None
                reason = "candidate_value_unavailable"
            else:
                position = ordered.index(candidate)
                rank = Decimal(position + 1)
                if value.transform == "rank":
                    result = rank
                else:
                    percentile = (
                        Decimal(1)
                        if len(ordered) == 1
                        else Decimal(len(ordered) - 1 - position) / Decimal(len(ordered) - 1)
                    )
                    if value.transform == "percentile":
                        result = percentile
                    else:
                        bins = Decimal(value.bins or 1)
                        result = max(
                            Decimal(1),
                            min(bins, (percentile * bins).to_integral_value(rounding=ROUND_CEILING)),
                        )
                reason = None
            observation = ProgramValueObservation(
                value.semantic_id, candidate, result, reason, self.observed_at,
                _value_content_hash(value),
            )
            self.observations.append(observation)
            return observation
        if isinstance(value, ScoreValueV2):
            total = Decimal(0)
            available_weight = Decimal(0)
            missing = False
            for term in value.terms:
                item = self.value(
                    term.value, candidate=candidate, binding_id=binding_id, members=members,
                )
                if item.value is None:
                    missing = True
                    continue
                total += item.value * term.weight
                available_weight += abs(term.weight)
            if missing and value.missing_policy == "require_all":
                result, reason = None, "score_term_unavailable"
            elif available_weight == 0:
                result, reason = None, "score_weight_zero"
            else:
                result = total if value.missing_policy == "require_all" else total / available_weight
                reason = None
            observation = ProgramValueObservation(
                value.semantic_id, candidate, result, reason, self.observed_at,
                _value_content_hash(value),
            )
            self.observations.append(observation)
            return observation
        semantic_type = getattr(value, "semantic_type", None)
        literal = getattr(value, "value", None)
        if semantic_type is not None and literal is not None:
            return ProgramValueObservation(
                value.semantic_id, candidate, Decimal(literal), None,
                self.observed_at, _value_content_hash(value),
            )
        raise ProgramExecutionError(f"unsupported_program_value: {type(value).__name__}")

    def condition(
        self,
        condition,
        *,
        candidate: str | None = None,
        binding_id: str | None = None,
        members: tuple[str, ...] = (),
    ) -> str:
        if isinstance(condition, ComparisonV2):
            left = self.value(
                condition.left, candidate=candidate, binding_id=binding_id, members=members,
            )
            right = self.value(
                condition.right, candidate=candidate, binding_id=binding_id, members=members,
            )
            if left.value is None or right.value is None:
                return "unknown"
            operations = {
                "lt": left.value < right.value,
                "lte": left.value <= right.value,
                "eq": left.value == right.value,
                "neq": left.value != right.value,
                "gte": left.value >= right.value,
                "gt": left.value > right.value,
            }
            return "true" if operations[condition.operator] else "false"
        if isinstance(condition, StateConditionV2):
            return "true" if self.state.get(condition.state_key) == condition.expected else "false"
        if isinstance(condition, NotConditionV2):
            return {"true": "false", "false": "true", "unknown": "unknown"}[
                self.condition(condition.child, candidate=candidate, binding_id=binding_id, members=members)
            ]
        values = [
            self.condition(child, candidate=candidate, binding_id=binding_id, members=members)
            for child in condition.children
        ]
        if isinstance(condition, BooleanGroupV2) and condition.kind == "all":
            if "false" in values:
                return "false"
            return "unknown" if "unknown" in values else "true"
        if "true" in values:
            return "true"
        return "unknown" if "unknown" in values else "false"

    def clock_due(self, clock_id: str | None) -> bool:
        if clock_id is None:
            return True
        clock = next(item for item in self.program.clocks if item.id == clock_id)
        if clock.timeframe == "daily":
            return True
        current = date.fromisoformat(self.snapshot.dates[self.cutoff])
        if self.cutoff == len(self.snapshot.dates) - 1:
            return clock.terminal_boundary_policy == "fixture_end_is_boundary"
        following = date.fromisoformat(self.snapshot.dates[self.cutoff + 1])
        if clock.timeframe == "weekly":
            return current.isocalendar()[:2] != following.isocalendar()[:2]
        return (current.year, current.month) != (following.year, following.month)

    def members(self, universe_id: str) -> tuple[str, ...]:
        try:
            return self.snapshot.domains[universe_id]
        except KeyError as exc:
            raise ProgramExecutionError(f"program_universe_unavailable: {universe_id}") from exc

    def selection(self, statement: SelectionStatementV2) -> None:
        if not self.clock_due(statement.clock_id):
            self.evidence.append(ProgramDecisionEvidence(
                statement.semantic_id, "selection", "not_due", statement.clock_id or "",
            ))
            return
        selection = statement.selection
        members = self.members(selection.universe_id)
        eligible: list[str] = []
        ranked: list[tuple[Decimal, str]] = []
        for member in members:
            outcome = "true" if selection.eligibility is None else self.condition(
                selection.eligibility,
                candidate=member,
                binding_id=selection.binding.id,
                members=members,
            )
            if outcome != "true":
                continue
            score = self.value(
                selection.ranking,
                candidate=member,
                binding_id=selection.binding.id,
                members=members,
            )
            if score.value is not None:
                eligible.append(member)
                ranked.append((score.value, member))
        ranked.sort(key=lambda item: item[1])
        ranked.sort(
            key=lambda item: item[0],
            reverse=selection.direction == "descending",
        )
        ordered = tuple(member for _score, member in ranked)
        complete = len(ordered) >= selection.count
        if complete or selection.shortage_policy == "choose_all":
            selected = ordered[:selection.count]
            outcome = "selected"
        elif selection.fallback_asset:
            selected = (selection.fallback_asset,)
            outcome = "selection_fallback"
        else:
            selected = ()
            outcome = "incomplete"
        self.selections[statement.output_id] = selected
        self.evidence.append(ProgramDecisionEvidence(
            statement.semantic_id,
            "selection",
            outcome,
            f"eligible={','.join(eligible)}; selected={','.join(selected)}",
        ))

    def allocation_resolvable(self, statement: AllocationStatementV2) -> bool:
        return all(
            leg.target.kind != "selection" or bool(self.selections.get(leg.target.ref or ""))
            for leg in statement.legs
        )

    def allocation(self, statement: AllocationStatementV2, outcome: str = "allocated") -> None:
        if not self.clock_due(statement.clock_id):
            self.evidence.append(ProgramDecisionEvidence(
                statement.semantic_id, "allocation", "not_due", statement.clock_id or "",
            ))
            return
        expanded: list[tuple[str, Decimal | None]] = []
        for leg in statement.legs:
            target = leg.target
            if target.kind == "retain":
                self.retained = True
                self.evidence.append(ProgramDecisionEvidence(
                    statement.semantic_id, "allocation", "retain", "retain current holdings",
                ))
                return
            if target.kind == "selection":
                assets = self.selections.get(target.ref or "", ())
            elif target.kind == "group":
                assets = self.members(target.ref or "")
            elif target.kind in {"asset", "cash"}:
                assets = (target.ref or target.kind.upper(),)
            else:
                assets = ()
            if not assets:
                continue
            per_asset = None if leg.weight is None else leg.weight / Decimal(len(assets))
            expanded.extend((asset, per_asset) for asset in assets)
        if not expanded:
            raise ProgramExecutionError("allocation_has_no_resolved_targets")
        if statement.method == "equal":
            weight = Decimal(1) / Decimal(len(expanded))
            weights: dict[str, Decimal] = {}
            for asset, _stored in expanded:
                weights[asset] = weights.get(asset, Decimal(0)) + weight
            self.target_weights = weights
        else:
            weights = {}
            for asset, weight in expanded:
                weights[asset] = weights.get(asset, Decimal(0)) + (weight or Decimal(0))
            self.target_weights = weights
        self.retained = False
        self.evidence.append(ProgramDecisionEvidence(
            statement.semantic_id,
            "allocation",
            outcome,
            "; ".join(f"{asset}={weight}" for asset, weight in self.target_weights.items()),
        ))

    def statements(self, statements: Iterable[ProgramStatementV2]) -> None:
        for statement in statements:
            if isinstance(statement, SelectionStatementV2):
                self.selection(statement)
            elif isinstance(statement, AllocationStatementV2):
                self.allocation(statement)
            elif isinstance(statement, ConditionalStatementV2):
                if not self.clock_due(statement.clock_id):
                    continue
                outcome = self.condition(statement.condition)
                self.evidence.append(ProgramDecisionEvidence(
                    statement.semantic_id, "control", outcome,
                    "then" if outcome == "true" else "otherwise" if outcome == "false" else statement.unknown_policy,
                ))
                if outcome == "true":
                    self.statements(statement.then_statements)
                elif outcome == "false" or statement.unknown_policy == "otherwise":
                    self.statements(statement.otherwise_statements)
                else:
                    self.retained = True
            elif isinstance(statement, EventStatementV2):
                if not self.clock_due(statement.event.clock_id):
                    continue
                current = self.condition(statement.event.condition)
                previous = self.prior_event_truths.get(statement.event.semantic_id, "false")
                if statement.event.semantic_id not in self.prior_event_truths and self.cutoff > 0:
                    prior = _Runtime(
                        self.program, self.snapshot, self.cutoff - 1,
                        prior_state=self.prior_state,
                        event_cutoffs=self.event_cutoffs,
                    )
                    previous = prior.condition(statement.event.condition)
                self.event_truths[statement.event.semantic_id] = current
                triggered = (
                    statement.event.trigger == "while_true" and current == "true"
                    or statement.event.trigger == "rising_edge" and current == "true" and previous != "true"
                    or statement.event.trigger == "falling_edge" and current == "false" and previous == "true"
                )
                self.evidence.append(ProgramDecisionEvidence(
                    statement.semantic_id, "event", "triggered" if triggered else "not_triggered",
                    f"previous={previous}; current={current}",
                ))
                if triggered:
                    self.event_cutoffs[statement.event.semantic_id] = self.cutoff
                    self.statements(statement.statements)
            elif isinstance(statement, StateTransitionStatementV2):
                transition = statement.transition
                if not self.clock_due(transition.clock_id):
                    continue
                from_matches = (
                    transition.from_value is None
                    or self.state.get(transition.state_key) == transition.from_value
                )
                outcome = self.condition(transition.when) if from_matches else "false"
                if outcome == "true":
                    self.state[transition.state_key] = transition.to_value
                self.evidence.append(ProgramDecisionEvidence(
                    statement.semantic_id, "transition", outcome,
                    f"{transition.state_key}={self.state.get(transition.state_key)}",
                ))
            elif isinstance(statement, GuardedAllocationStatementV2):
                guard = "true" if statement.guard is None else self.condition(statement.guard)
                if guard == "false" or (
                    guard == "unknown" and statement.unknown_guard_policy == "block"
                ):
                    self.retained = True
                    self.evidence.append(ProgramDecisionEvidence(
                        statement.semantic_id, "guarded_allocation", "guard_blocked", guard,
                    ))
                    continue
                selected_override = None
                for override in sorted(statement.overrides, key=lambda item: item.priority, reverse=True):
                    if self.condition(override.when) == "true":
                        selected_override = override
                        break
                if selected_override is not None:
                    self.allocation(selected_override.action, "override")
                elif self.allocation_resolvable(statement.primary):
                    self.allocation(statement.primary, "primary")
                elif statement.fallback is not None:
                    self.allocation(statement.fallback, "fallback")
                else:
                    self.retained = True
                    self.evidence.append(ProgramDecisionEvidence(
                        statement.semantic_id, "guarded_allocation", "unresolved_retain",
                        "primary unavailable and no fallback",
                    ))
            else:
                raise ProgramExecutionError("unresolved_statement_cannot_execute")


def execute_program_v2(
    program: SemanticProgramV2,
    snapshot: DailyMarketSnapshot,
    *,
    cutoff_index: int | None = None,
    revision_id: str | None = None,
    prior_state: dict[str, str] | None = None,
    event_cutoffs: dict[str, int] | None = None,
    prior_event_truths: dict[str, str] | None = None,
) -> ProgramExecutionResult:
    issues = validate_program_v2(program)
    if issues:
        raise ProgramExecutionError("; ".join(f"{item.path}: {item.code}" for item in issues))
    cutoff = len(snapshot.dates) - 1 if cutoff_index is None else cutoff_index
    if cutoff < 0 or cutoff >= len(snapshot.dates):
        raise ProgramExecutionError("program_cutoff_out_of_range")
    runtime = _Runtime(
        program, snapshot, cutoff,
        prior_state=prior_state,
        event_cutoffs=event_cutoffs,
        prior_event_truths=prior_event_truths,
    )
    runtime.statements(program.statements)
    return ProgramExecutionResult(
        revision_id=revision_id,
        program_semantic_id=program.semantic_id,
        snapshot_id=snapshot.snapshot_id,
        cutoff=snapshot.dates[cutoff],
        state=runtime.state,
        event_cutoffs=runtime.event_cutoffs,
        event_truths=runtime.event_truths,
        selection_outputs=runtime.selections,
        target_weights=runtime.target_weights,
        retained_holdings=runtime.retained,
        evidence=tuple(runtime.evidence),
        value_observations=tuple(runtime.observations),
    )
