"""Deterministic reference execution for the representation-neutral Program Core."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, ROUND_CEILING
from statistics import pstdev
from typing import Iterable

from ruletrade.strategy.v2.daily_values import DailyMarketSnapshot, DailyValueEvaluator, DailyValueNode
from ruletrade.strategy.v2.models import (
    AllocationStatementV2,
    BooleanGroupV2,
    ComparisonV2,
    ClockedValueV2,
    ConditionalStatementV2,
    CrossSectionalValueV2,
    CrossSectionalAggregateValueV2,
    EventRelativeValueV2,
    EventWindowConditionV2,
    EventStatementV2,
    GuardedAllocationStatementV2,
    NotConditionV2,
    NOfMConditionV2,
    ProgramStatementV2,
    ScoreValueV2,
    RememberedValueV2,
    RememberValueStatementV2,
    BarsSinceEventValueV2,
    BarsSinceStateValueV2,
    TimeSinceEventValueV2,
    TimeSinceStateValueV2,
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


def _bounded_normalize(
    raw: dict[str, Decimal],
    minimum: Decimal | None,
    maximum: Decimal | None,
    cash_asset: str | None,
) -> dict[str, Decimal]:
    if not raw or sum(raw.values(), Decimal(0)) <= 0:
        raise ProgramExecutionError("allocation_scores_not_positive")
    count = Decimal(len(raw))
    floor = minimum or Decimal(0)
    cap = maximum or Decimal(1)
    if floor * count > 1:
        raise ProgramExecutionError("allocation_floor_conflict")
    if cap * count < 1 and cash_asset is None:
        raise ProgramExecutionError("allocation_cap_requires_cash_remainder")
    weights = {asset: value / sum(raw.values(), Decimal(0)) for asset, value in raw.items()}
    fixed: dict[str, Decimal] = {}
    free = set(weights)
    for _iteration in range(len(weights) + 1):
        changed = False
        remaining = Decimal(1) - sum(fixed.values(), Decimal(0))
        free_total = sum((raw[item] for item in free), Decimal(0))
        if free and free_total > 0:
            weights.update({item: remaining * raw[item] / free_total for item in free})
        for item in sorted(tuple(free)):
            if weights[item] < floor:
                fixed[item] = floor
                free.remove(item)
                changed = True
            elif weights[item] > cap:
                fixed[item] = cap
                free.remove(item)
                changed = True
        if not changed:
            break
    weights.update(fixed)
    assigned = sum(weights.values(), Decimal(0))
    if assigned > 1:
        raise ProgramExecutionError("allocation_bounds_conflict")
    if assigned < 1:
        if cash_asset is None:
            raise ProgramExecutionError("allocation_remainder_without_cash")
        weights[cash_asset] = weights.get(cash_asset, Decimal(0)) + (Decimal(1) - assigned)
    return weights


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
    requested_members: tuple[str, ...] = ()
    available_members: tuple[str, ...] = ()
    missing_members: tuple[str, ...] = ()


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
    event_counts: dict[str, int]
    state_entered_cutoffs: dict[str, int]
    remembered_values: dict[str, Decimal]
    selection_outputs: dict[str, tuple[str, ...]]
    selection_scores: dict[str, dict[str, Decimal]]
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
        event_counts: dict[str, int] | None = None,
        state_entered_cutoffs: dict[str, int] | None = None,
        remembered_values: dict[str, Decimal] | None = None,
    ) -> None:
        self.program = program
        self.snapshot = snapshot
        self.cutoff = cutoff
        self.prior_state = dict(program.initial_state if prior_state is None else prior_state)
        self.state = dict(self.prior_state)
        self.selections: dict[str, tuple[str, ...]] = {}
        self.selection_scores: dict[str, dict[str, Decimal]] = {}
        self.target_weights: dict[str, Decimal] = {}
        self.retained = False
        self.evidence: list[ProgramDecisionEvidence] = []
        self.observations: list[ProgramValueObservation] = []
        self.event_cutoffs: dict[str, int] = dict(event_cutoffs or {})
        self.prior_event_truths: dict[str, str] = dict(prior_event_truths or {})
        self.event_truths: dict[str, str] = {}
        self.event_counts: dict[str, int] = dict(event_counts or {})
        self.state_entered_cutoffs: dict[str, int] = dict(state_entered_cutoffs or {})
        self.remembered_values: dict[str, Decimal] = dict(remembered_values or {})

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
        if isinstance(value, ClockedValueV2):
            boundary = self.last_completed_clock_cutoff(value.clock_id)
            if boundary is None:
                observation = ProgramValueObservation(
                    value.semantic_id, candidate, None, "completed_clock_observation_unavailable",
                    self.observed_at, _value_content_hash(value),
                )
            else:
                source = self._daily(value.source, candidate, binding_id, boundary)
                observation = ProgramValueObservation(
                    value.semantic_id, candidate, source.value, source.reason,
                    source.observed_at, _value_content_hash(value),
                )
            self.observations.append(observation)
            return observation
        if isinstance(value, RememberedValueV2):
            result = self.remembered_values.get(value.memory_id)
            observation = ProgramValueObservation(
                value.semantic_id, candidate, result,
                None if result is not None else "remembered_value_unavailable",
                self.observed_at, _value_content_hash(value),
            )
            self.observations.append(observation)
            return observation
        if isinstance(value, BarsSinceEventValueV2):
            anchor = self.event_cutoffs.get(value.event_id)
            result = None if anchor is None else Decimal(self.cutoff - anchor)
            observation = ProgramValueObservation(
                value.semantic_id, candidate, result,
                None if result is not None else "event_not_observed",
                self.observed_at, _value_content_hash(value),
            )
            self.observations.append(observation)
            return observation
        if isinstance(value, BarsSinceStateValueV2):
            anchor = self.state_entered_cutoffs.get(value.state_key)
            result = None if anchor is None else Decimal(self.cutoff - anchor)
            observation = ProgramValueObservation(
                value.semantic_id, candidate, result,
                None if result is not None else "state_entry_not_observed",
                self.observed_at, _value_content_hash(value),
            )
            self.observations.append(observation)
            return observation
        if isinstance(value, (TimeSinceEventValueV2, TimeSinceStateValueV2)):
            anchor = (
                self.event_cutoffs.get(value.event_id)
                if isinstance(value, TimeSinceEventValueV2)
                else self.state_entered_cutoffs.get(value.state_key)
            )
            result = None if anchor is None else Decimal(
                (date.fromisoformat(self.snapshot.dates[self.cutoff])
                 - date.fromisoformat(self.snapshot.dates[anchor])).days
            )
            observation = ProgramValueObservation(
                value.semantic_id, candidate, result,
                None if result is not None else "temporal_anchor_unavailable",
                self.observed_at, _value_content_hash(value),
            )
            self.observations.append(observation)
            return observation
        if isinstance(value, CrossSectionalValueV2):
            if candidate is None:
                raise ProgramExecutionError("cross_section_requires_candidate")
            available: list[tuple[Decimal, str]] = []
            missing_members: list[str] = []
            for member in members:
                item = self.value(
                    value.source, candidate=member, binding_id=binding_id, members=members,
                )
                if item.value is not None:
                    available.append((item.value, member))
                else:
                    missing_members.append(member)
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
                elif value.transform in {"min_max", "zscore"}:
                    raw = next(number for number, member in available if member == candidate)
                    numbers = [number for number, _member in available]
                    if value.transform == "min_max":
                        spread = max(numbers) - min(numbers)
                        result = Decimal(0) if spread == 0 else (raw - min(numbers)) / spread
                    else:
                        deviation = pstdev(numbers)
                        result = Decimal(0) if deviation == 0 else (raw - sum(numbers) / Decimal(len(numbers))) / deviation
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
                tuple(members), tuple(member for _number, member in available), tuple(missing_members),
            )
            self.observations.append(observation)
            return observation
        if isinstance(value, CrossSectionalAggregateValueV2):
            available: list[Decimal] = []
            available_members: list[str] = []
            missing_members: list[str] = []
            for member in members:
                item = self.value(
                    value.source, candidate=member, binding_id=binding_id, members=members,
                )
                if item.value is None:
                    missing_members.append(member)
                else:
                    available.append(item.value)
                    available_members.append(member)
            if not available or (missing_members and value.coverage == "require_all"):
                result, reason = None, "cross_section_coverage_incomplete"
            elif value.reduction == "mean":
                result, reason = sum(available, Decimal(0)) / Decimal(len(available)), None
            elif value.reduction == "median":
                ordered = sorted(available)
                middle = len(ordered) // 2
                result = ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / Decimal(2)
                reason = None
            elif value.reduction == "min":
                result, reason = min(available), None
            else:
                result, reason = max(available), None
            observation = ProgramValueObservation(
                value.semantic_id, candidate, result, reason, self.observed_at,
                _value_content_hash(value), tuple(members), tuple(available_members), tuple(missing_members),
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
            for term in value.condition_terms:
                outcome = self.condition(
                    term.condition, candidate=candidate, binding_id=binding_id, members=members,
                )
                if outcome == "unknown" and term.unknown_points is None:
                    missing = True
                    continue
                total += (
                    term.true_points if outcome == "true"
                    else term.false_points if outcome == "false"
                    else term.unknown_points or Decimal(0)
                )
            if missing and value.missing_policy == "require_all":
                result, reason = None, "score_term_unavailable"
            elif available_weight == 0 and value.terms:
                result, reason = None, "score_weight_zero"
            else:
                result = total
                if (value.missing_policy == "renormalize_available" or value.normalization == "sum_abs") and available_weight:
                    result /= available_weight
                if value.clamp_min is not None:
                    result = max(value.clamp_min, result)
                if value.clamp_max is not None:
                    result = min(value.clamp_max, result)
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
        if isinstance(condition, EventWindowConditionV2):
            anchor = self.event_cutoffs.get(condition.event_id)
            if condition.relation == "before":
                return "true" if anchor is None else "false"
            if anchor is None:
                return "unknown"
            elapsed = self.cutoff - anchor
            if condition.relation == "after":
                return "true" if elapsed >= 0 else "false"
            return "true" if 0 <= elapsed <= (condition.observations or 0) else "false"
        if isinstance(condition, NotConditionV2):
            return {"true": "false", "false": "true", "unknown": "unknown"}[
                self.condition(condition.child, candidate=candidate, binding_id=binding_id, members=members)
            ]
        values = [
            self.condition(child, candidate=candidate, binding_id=binding_id, members=members)
            for child in condition.children
        ]
        if isinstance(condition, NOfMConditionV2):
            true_count = values.count("true")
            unknown_count = values.count("unknown")
            if true_count >= condition.minimum_true:
                return "true"
            if true_count + unknown_count < condition.minimum_true:
                return "false"
            return "unknown"
        if isinstance(condition, BooleanGroupV2) and condition.kind == "all":
            if "false" in values:
                return "false"
            return "unknown" if "unknown" in values else "true"
        if "true" in values:
            return "true"
        return "unknown" if "unknown" in values else "false"

    def _clock_due_at(self, clock_id: str, index: int, *, allow_terminal: bool) -> bool:
        clock = next(item for item in self.program.clocks if item.id == clock_id)
        if clock.timeframe in {"session", "daily"}:
            return True
        current = date.fromisoformat(self.snapshot.dates[index])
        if clock.timeframe == "weekly":
            return current.weekday() == 4 or (
                allow_terminal and clock.terminal_boundary_policy == "fixture_end_is_boundary"
            )
        following = current + timedelta(days=1)
        while following.weekday() >= 5:
            following += timedelta(days=1)
        return (current.year, current.month) != (following.year, following.month) or (
            allow_terminal and clock.terminal_boundary_policy == "fixture_end_is_boundary"
        )

    def last_completed_clock_cutoff(self, clock_id: str) -> int | None:
        for index in range(self.cutoff, -1, -1):
            if self._clock_due_at(clock_id, index, allow_terminal=index == self.cutoff):
                return index
        return None

    def clock_due(self, clock_id: str | None) -> bool:
        if clock_id is None:
            return True
        return self._clock_due_at(clock_id, self.cutoff, allow_terminal=True)

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
        self.selection_scores[statement.output_id] = {
            member: score for score, member in ranked if member in selected
        }
        self.evidence.append(ProgramDecisionEvidence(
            statement.semantic_id,
            "selection",
            outcome,
            f"eligible={','.join(eligible)}; selected={','.join(selected)}",
        ))

    def allocation_resolvable(self, statement: AllocationStatementV2) -> bool:
        targets_exist = all(
            leg.target.kind != "selection" or bool(self.selections.get(leg.target.ref or ""))
            for leg in statement.legs
        )
        if not targets_exist:
            return False
        if statement.method in {"proportional_score", "inverse_volatility"}:
            output_id = statement.legs[0].target.ref or ""
            scores = self.selection_scores.get(output_id, {})
            if not scores:
                return False
            return any(value > 0 for value in scores.values())
        return True

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
        elif statement.method == "fixed":
            weights = {}
            for asset, weight in expanded:
                weights[asset] = weights.get(asset, Decimal(0)) + (weight or Decimal(0))
            self.target_weights = weights
        else:
            output_id = statement.legs[0].target.ref or ""
            selected = self.selections.get(output_id, ())
            scores = self.selection_scores.get(output_id, {})
            if statement.method == "proportional_score":
                raw = {asset: max(Decimal(0), scores.get(asset, Decimal(0))) for asset in selected}
            else:
                if any(scores.get(asset, Decimal(0)) <= 0 for asset in selected):
                    raise ProgramExecutionError("inverse_volatility_requires_positive_values")
                raw = {asset: Decimal(1) / scores[asset] for asset in selected}
            self.target_weights = _bounded_normalize(
                raw, statement.minimum_weight, statement.maximum_weight,
                statement.cash_remainder_asset,
            )
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
                current = "true" if statement.event.trigger == "scheduled" else self.condition(statement.event.condition)
                previous = self.prior_event_truths.get(statement.event.semantic_id, "false")
                if statement.event.trigger != "scheduled" and statement.event.semantic_id not in self.prior_event_truths and self.cutoff > 0:
                    prior = _Runtime(
                        self.program, self.snapshot, self.cutoff - 1,
                        prior_state=self.prior_state,
                        event_cutoffs=self.event_cutoffs,
                        event_counts=self.event_counts,
                        state_entered_cutoffs=self.state_entered_cutoffs,
                        remembered_values=self.remembered_values,
                    )
                    previous = prior.condition(statement.event.condition)
                self.event_truths[statement.event.semantic_id] = current
                rising = statement.event.trigger in {"rising_edge", "became_true", "crosses_above"}
                falling = statement.event.trigger in {"falling_edge", "became_false", "crosses_below"}
                triggered = (
                    statement.event.trigger in {"while_true", "scheduled"} and current == "true"
                    or rising and current == "true" and previous != "true"
                    or falling and current == "false" and previous == "true"
                )
                if triggered:
                    count = self.event_counts.get(statement.event.semantic_id, 0) + 1
                    self.event_counts[statement.event.semantic_id] = count
                    triggered = (
                        statement.event.occurrence == "every"
                        or statement.event.occurrence == "first" and count == 1
                        or statement.event.occurrence == "ordinal" and count == statement.event.ordinal
                    )
                self.evidence.append(ProgramDecisionEvidence(
                    statement.semantic_id, "event", "triggered" if triggered else "not_triggered",
                    f"previous={previous}; current={current}; occurrence={self.event_counts.get(statement.event.semantic_id, 0)}",
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
                    changed = self.state.get(transition.state_key) != transition.to_value
                    self.state[transition.state_key] = transition.to_value
                    if changed:
                        self.state_entered_cutoffs[transition.state_key] = self.cutoff
                self.evidence.append(ProgramDecisionEvidence(
                    statement.semantic_id, "transition", outcome,
                    f"{transition.state_key}={self.state.get(transition.state_key)}",
                ))
            elif isinstance(statement, RememberValueStatementV2):
                if not self.clock_due(statement.clock_id):
                    continue
                observed = self.value(statement.value, candidate=None, binding_id=None)
                if observed.value is None:
                    self.evidence.append(ProgramDecisionEvidence(
                        statement.semantic_id, "remember", "unavailable", observed.reason or "unknown",
                    ))
                else:
                    self.remembered_values[statement.memory_id] = observed.value
                    self.evidence.append(ProgramDecisionEvidence(
                        statement.semantic_id, "remember", "stored",
                        f"{statement.memory_id}={observed.value}; source={observed.expression_hash}",
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
                    self.evidence.append(ProgramDecisionEvidence(
                        statement.semantic_id, "policy_precedence", "override",
                        f"rule={selected_override.semantic_id}; priority={selected_override.priority}",
                    ))
                elif self.allocation_resolvable(statement.primary):
                    self.allocation(statement.primary, "primary")
                    self.evidence.append(ProgramDecisionEvidence(
                        statement.semantic_id, "policy_precedence", "primary",
                        f"rule={statement.primary.semantic_id}",
                    ))
                elif statement.fallback is not None:
                    self.allocation(statement.fallback, "fallback")
                    self.evidence.append(ProgramDecisionEvidence(
                        statement.semantic_id, "policy_precedence", "fallback",
                        f"rule={statement.fallback.semantic_id}; primary_unavailable=true",
                    ))
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
    event_counts: dict[str, int] | None = None,
    state_entered_cutoffs: dict[str, int] | None = None,
    remembered_values: dict[str, Decimal] | None = None,
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
        event_counts=event_counts,
        state_entered_cutoffs=state_entered_cutoffs,
        remembered_values=remembered_values,
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
        event_counts=runtime.event_counts,
        state_entered_cutoffs=runtime.state_entered_cutoffs,
        remembered_values=runtime.remembered_values,
        selection_outputs=runtime.selections,
        selection_scores=runtime.selection_scores,
        target_weights=runtime.target_weights,
        retained_holdings=runtime.retained,
        evidence=tuple(runtime.evidence),
        value_observations=tuple(runtime.observations),
    )
