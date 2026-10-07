"""Typed daily Value expressions and a deterministic reference evaluator.

This is a bounded Profile A algebra. Structured nodes, not display strings, are
the source of truth. Provider and runtime parity remain separate capability gates.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, DivisionByZero, ROUND_HALF_EVEN
from enum import StrEnum
from functools import cached_property
from itertools import product
from typing import Literal

from pydantic import Field, model_validator

from ruletrade.strategy.v2.semantic_types import (
    Axis, Clock, FrozenModel, HistoryRequirement, Quantity, SemanticDType,
    SemanticType, aligned_axes, require_compatible_values, semantic_content_hash,
    Unit,
)


class SubjectKind(StrEnum):
    ASSET = "asset"
    CANDIDATE = "candidate"
    GROUP_MEMBERS = "group_members"


class MarketField(StrEnum):
    OPEN = "open"
    HIGH = "high"
    LOW = "low"
    CLOSE = "close"
    VOLUME = "volume"


class PriceBasis(StrEnum):
    RAW = "raw"
    ADJUSTED = "adjusted"
    RAW_SHARES = "raw_shares"


class ReductionAxis(StrEnum):
    ASSET = "asset"
    TIME = "time"


class ReductionOperation(StrEnum):
    MEAN = "mean"
    MEDIAN = "median"
    MIN = "min"
    MAX = "max"
    STD = "std"


class MissingPolicy(StrEnum):
    REQUIRE_ALL = "require_all"
    SKIP_WITH_COVERAGE = "skip_with_coverage"


class DailyValueError(ValueError):
    pass


class DailyValueNode(FrozenModel):
    """A finite structured expression node with explicit operator parameters."""

    semantic_id: str = Field(min_length=1)
    kind: Literal[
        "literal", "observe", "current", "history", "trailing_return",
        "sma", "ema", "rsi_wilder_lean_compat", "realized_volatility",
        "reduce", "arithmetic",
    ]
    operands: tuple["DailyValueNode", ...] = ()
    subject_kind: SubjectKind | None = None
    subject_id: str | None = None
    binding_id: str | None = None
    field: MarketField | None = None
    basis: PriceBasis | None = None
    quantity: Quantity | None = None
    unit: Unit | None = None
    refinement: str | None = None
    value: Decimal | None = None
    observations: int | None = None
    skip: int = 0
    axis: ReductionAxis | None = None
    reduction: ReductionOperation | None = None
    missing_policy: MissingPolicy = MissingPolicy.REQUIRE_ALL
    minimum_count: int = 1
    minimum_fraction: Decimal = Decimal("1")
    arithmetic: Literal["add", "subtract", "multiply", "divide"] | None = None

    @model_validator(mode="after")
    def validate_shape(self) -> "DailyValueNode":
        arity = {
            "literal": 0, "observe": 0, "current": 1, "history": 1,
            "trailing_return": 1, "sma": 1, "ema": 1,
            "rsi_wilder_lean_compat": 1, "realized_volatility": 1,
            "reduce": 1, "arithmetic": 2,
        }[self.kind]
        if len(self.operands) != arity:
            raise ValueError(f"{self.kind} requires {arity} operand(s)")
        if self.kind == "literal" and (self.value is None or self.quantity is None or self.unit is None):
            raise ValueError("literal requires value, quantity and unit")
        if self.kind == "observe":
            if self.subject_kind is None or self.field is None or self.basis is None:
                raise ValueError("observe requires subject_kind, field and basis")
            if self.subject_kind == SubjectKind.CANDIDATE:
                if not self.binding_id or self.subject_id is not None:
                    raise ValueError("candidate observe requires a lexical binding_id")
            elif not self.subject_id or self.binding_id is not None:
                raise ValueError("asset/group observe requires subject_id")
            if self.field == MarketField.VOLUME and self.basis != PriceBasis.RAW_SHARES:
                raise ValueError("volume requires raw_shares basis")
            if self.field != MarketField.VOLUME and self.basis == PriceBasis.RAW_SHARES:
                raise ValueError("price field cannot use raw_shares basis")
        if self.kind in {"history", "trailing_return", "sma", "ema", "rsi_wilder_lean_compat", "realized_volatility"}:
            if self.observations is None or not 1 <= self.observations <= 2000:
                raise ValueError("daily window must be 1..2000 observations")
            if self.skip < 0:
                raise ValueError("skip must be non-negative")
        if self.kind == "reduce" and (self.axis is None or self.reduction is None or self.minimum_count < 1 or not Decimal("0") < self.minimum_fraction <= Decimal("1")):
            raise ValueError("reduce requires explicit axis, operation and coverage")
        if self.kind == "arithmetic" and self.arithmetic is None:
            raise ValueError("arithmetic requires an operator")
        return self

    @cached_property
    def content_hash(self) -> str:
        payload = self.model_dump(mode="json")
        payload.pop("semantic_id", None)
        return semantic_content_hash(payload)


DailyValueNode.model_rebuild()


@dataclass(frozen=True)
class DailyCell:
    value: Decimal | None
    reason: str | None = None


@dataclass(frozen=True)
class DailyValueResult:
    semantic_type: SemanticType
    axes: tuple[Axis, ...]
    cells: dict[tuple[str, ...], DailyCell]
    observed_at: tuple[str, ...]

    def scalar(self) -> Decimal | None:
        if self.axes:
            raise DailyValueError("scalar_required")
        return self.cells[()].value


@dataclass(frozen=True)
class DailyMarketSnapshot:
    """Pinned in-memory source; no forward fill and explicit field/basis keys."""

    snapshot_id: str
    clock: Clock
    series: dict[str, dict[str, tuple[Decimal | None, ...]]]
    domains: dict[str, tuple[str, ...]]
    dates: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.dates:
            raise DailyValueError("empty_snapshot")
        for symbol, fields in self.series.items():
            for key, values in fields.items():
                if len(values) != len(self.dates):
                    raise DailyValueError(f"series_length_mismatch: {symbol}:{key}")
        for domain, members in self.domains.items():
            if not members or len(set(members)) != len(members):
                raise DailyValueError(f"invalid_domain: {domain}")

    def field_values(self, symbol: str, field: MarketField, basis: PriceBasis) -> tuple[Decimal | None, ...]:
        try:
            return self.series[symbol][f"{field.value}:{basis.value}"]
        except KeyError as exc:
            raise DailyValueError(f"provider_field_missing: {symbol}:{field.value}:{basis.value}") from exc


@dataclass(frozen=True)
class TypedValuePlan:
    expression_id: str
    expression_hash: str
    semantic_type: SemanticType
    fields: tuple[str, ...]
    history: HistoryRequirement
    operator_versions: tuple[str, ...]
    backend_lowerable: bool


def _observe_type(node: DailyValueNode, binding_id: str | None) -> SemanticType:
    if node.subject_kind == SubjectKind.CANDIDATE and node.binding_id != binding_id:
        raise DailyValueError("unbound_candidate")
    if node.field == MarketField.VOLUME:
        quantity, unit, refinement = Quantity.VOLUME, Unit.SHARES, "daily_trade_volume:raw_shares"
    else:
        quantity, unit = Quantity.PRICE, Unit.USD_PER_SHARE
        refinement = "raw_ohlc" if node.basis == PriceBasis.RAW else "adjusted_close"
    axes = (Axis(name="asset", domain_id=node.subject_id or ""),) if node.subject_kind == SubjectKind.GROUP_MEMBERS else ()
    return SemanticType(dtype=SemanticDType.DECIMAL, quantity=quantity, unit=unit, refinement=refinement, axes=axes, clock=Clock(id="daily-close"))


def infer_daily_type(node: DailyValueNode, *, binding_id: str | None = None) -> SemanticType:
    if node.kind == "literal":
        return SemanticType(dtype=SemanticDType.DECIMAL, quantity=node.quantity, unit=node.unit, refinement=node.refinement)
    if node.kind == "observe":
        return _observe_type(node, binding_id)
    left = infer_daily_type(node.operands[0], binding_id=binding_id)
    if node.kind == "current":
        return left
    if node.kind == "history":
        return left.model_copy(update={"axes": left.axes + (Axis(name="time", domain_id=f"daily-close:observations:{node.observations}:skip:{node.skip}", coordinate_policy="completed_observation"),)})
    if node.kind == "trailing_return":
        return left.model_copy(update={"quantity": Quantity.RETURN, "unit": Unit.RATIO, "refinement": f"trailing_return:{left.refinement}"})
    if node.kind in {"sma", "ema"}:
        if left.quantity != Quantity.PRICE:
            raise DailyValueError("indicator_input_requires_price")
        return left
    if node.kind == "rsi_wilder_lean_compat":
        if left.quantity != Quantity.PRICE:
            raise DailyValueError("indicator_input_requires_price")
        return left.model_copy(update={"quantity": Quantity.OSCILLATOR, "unit": Unit.POINTS, "refinement": "rsi_wilder_lean_compat@1"})
    if node.kind == "realized_volatility":
        if left.quantity != Quantity.PRICE:
            raise DailyValueError("indicator_input_requires_price")
        return left.model_copy(update={"quantity": Quantity.RETURN, "unit": Unit.RATIO, "refinement": "realized_volatility:simple_return:sample:annualized_252@1"})
    if node.kind == "reduce":
        axes = tuple(axis for axis in left.axes if axis.name != node.axis)
        if len(axes) == len(left.axes):
            raise DailyValueError("reduction_axis_absent")
        return left.model_copy(update={"axes": axes})
    if node.kind == "arithmetic":
        right = infer_daily_type(node.operands[1], binding_id=binding_id)
        if node.arithmetic in {"add", "subtract"}:
            require_compatible_values(left, right)
            return left.model_copy(update={"axes": aligned_axes(left, right)})
        if node.arithmetic == "multiply":
            if left.quantity == Quantity.SCORE and left.unit == Unit.RATIO:
                return right.model_copy(update={"axes": aligned_axes(left, right)})
            if right.quantity == Quantity.SCORE and right.unit == Unit.RATIO:
                return left.model_copy(update={"axes": aligned_axes(left, right)})
            raise DailyValueError("invalid_multiply_signature")
        if node.arithmetic == "divide" and left.quantity == right.quantity and left.unit == right.unit and left.refinement == right.refinement:
            return SemanticType(dtype=SemanticDType.DECIMAL, quantity=Quantity.SCORE, unit=Unit.RATIO, refinement="ratio", axes=aligned_axes(left, right), clock=left.clock or right.clock)
        raise DailyValueError("invalid_divide_signature")
    raise DailyValueError(f"unsupported_value_kind: {node.kind}")


def _transform(kind: str, period: int, series: tuple[Decimal | None, ...]) -> tuple[Decimal | None, ...]:
    result: list[Decimal | None] = []
    for end, current in enumerate(series):
        if kind == "trailing_return":
            start = end - period
            result.append(None if start < 0 or current is None or series[start] in {None, Decimal(0)} else current / series[start] - Decimal(1))
            continue
        window = series[end - period + 1:end + 1]
        if len(window) != period or any(value is None for value in window):
            result.append(None)
            continue
        values = [value for value in window if value is not None]
        if kind == "sma":
            result.append(sum(values, Decimal(0)) / Decimal(period))
        elif kind == "ema":
            previous = result[-1] if result else None
            alpha = Decimal(2) / Decimal(period + 1)
            result.append(sum(values, Decimal(0)) / Decimal(period) if end == period - 1 else (None if previous is None else alpha * values[-1] + (Decimal(1) - alpha) * previous))
        elif kind == "rsi_wilder_lean_compat":
            if end < period:
                result.append(None)
            else:
                changes = [series[index] - series[index - 1] for index in range(end - period + 1, end + 1)]
                gains = sum((max(change, Decimal(0)) for change in changes), Decimal(0)) / Decimal(period)
                losses = sum((max(-change, Decimal(0)) for change in changes), Decimal(0)) / Decimal(period)
                result.append(Decimal(100) if losses.quantize(Decimal("0.0000000001"), rounding=ROUND_HALF_EVEN) == 0 else Decimal(100) - Decimal(100) / (Decimal(1) + gains / losses))
        else:
            returns = [values[index] / values[index - 1] - Decimal(1) for index in range(1, len(values))]
            if len(returns) < 2:
                result.append(None)
            else:
                mean = sum(returns, Decimal(0)) / Decimal(len(returns))
                result.append((sum(((value - mean) ** 2 for value in returns), Decimal(0)) / Decimal(len(returns) - 1)).sqrt() * Decimal(252).sqrt())
    return tuple(result)


class DailyValueEvaluator:
    """Deterministic daily reference evaluator with memoization by free candidate binding."""

    def __init__(self, snapshot: DailyMarketSnapshot, *, cutoff_index: int | None = None) -> None:
        self.snapshot = snapshot
        self.cutoff_index = len(snapshot.dates) - 1 if cutoff_index is None else cutoff_index
        self._memo: dict[tuple[str, str | None], DailyValueResult] = {}
        self.evaluation_counts: dict[str, int] = {}

    def evaluate(self, node: DailyValueNode, *, candidate: str | None = None, binding_id: str | None = None) -> DailyValueResult:
        key = (node.content_hash, candidate if self._uses_candidate(node) else None)
        if key in self._memo:
            return self._memo[key]
        self.evaluation_counts[node.semantic_id] = self.evaluation_counts.get(node.semantic_id, 0) + 1
        result = self._evaluate(node, candidate, binding_id)
        self._memo[key] = result
        return result

    def _evaluate(self, node: DailyValueNode, candidate: str | None, binding_id: str | None) -> DailyValueResult:
        inferred = infer_daily_type(node, binding_id=binding_id)
        if node.kind == "literal":
            return DailyValueResult(inferred, (), {(): DailyCell(node.value)}, (self.snapshot.dates[self.cutoff_index],))
        if node.kind == "observe":
            return self._current_observe(node, inferred, candidate)
        if node.kind in {"trailing_return", "sma", "ema", "rsi_wilder_lean_compat", "realized_volatility"}:
            return self._current_indicator(node, inferred, candidate)
        if node.kind == "current":
            return self.evaluate(node.operands[0], candidate=candidate, binding_id=binding_id)
        if node.kind == "history":
            return self._history(node, inferred, candidate)
        if node.kind == "reduce":
            return self._reduce(node, inferred, candidate, binding_id)
        if node.kind == "arithmetic":
            return self._arithmetic(node, inferred, candidate, binding_id)
        raise DailyValueError("unsupported_evaluation")

    def _symbols(self, observe: DailyValueNode, candidate: str | None) -> tuple[str, ...]:
        if observe.subject_kind == SubjectKind.ASSET:
            return (observe.subject_id or "",)
        if observe.subject_kind == SubjectKind.CANDIDATE:
            if candidate is None:
                raise DailyValueError("candidate_context_required")
            return (candidate,)
        return self.snapshot.domains[observe.subject_id or ""]

    def _stream(self, node: DailyValueNode, symbol: str) -> tuple[Decimal | None, ...]:
        if node.kind == "observe":
            return self.snapshot.field_values(symbol, node.field or MarketField.CLOSE, node.basis or PriceBasis.ADJUSTED)[:self.cutoff_index + 1]
        if node.kind in {"trailing_return", "sma", "ema", "rsi_wilder_lean_compat", "realized_volatility"}:
            return _transform(node.kind, node.observations or 0, self._stream(node.operands[0], symbol))
        raise DailyValueError("expected_stream_expression")

    def _source_observe(self, node: DailyValueNode) -> DailyValueNode:
        current = node
        while current.kind in {"trailing_return", "sma", "ema", "rsi_wilder_lean_compat", "realized_volatility"}:
            current = current.operands[0]
        if current.kind != "observe":
            raise DailyValueError("stream_source_must_be_observe")
        return current

    def _current_observe(self, node: DailyValueNode, inferred: SemanticType, candidate: str | None) -> DailyValueResult:
        cells: dict[tuple[str, ...], DailyCell] = {}
        for symbol in self._symbols(node, candidate):
            value = self._stream(node, symbol)[-1]
            cells[(symbol,)] = DailyCell(value, None if value is not None else "observation_unavailable")
        if not inferred.axes:
            cells = {(): next(iter(cells.values()))}
        return DailyValueResult(inferred, inferred.axes, cells, (self.snapshot.dates[self.cutoff_index],))

    def _current_indicator(self, node: DailyValueNode, inferred: SemanticType, candidate: str | None) -> DailyValueResult:
        observe = self._source_observe(node)
        cells: dict[tuple[str, ...], DailyCell] = {}
        for symbol in self._symbols(observe, candidate):
            value = self._stream(node, symbol)[-1]
            cells[(symbol,)] = DailyCell(value, None if value is not None else "insufficient_history")
        if not inferred.axes:
            cells = {(): next(iter(cells.values()))}
        return DailyValueResult(inferred, inferred.axes, cells, (self.snapshot.dates[self.cutoff_index],))

    def _history(self, node: DailyValueNode, inferred: SemanticType, candidate: str | None) -> DailyValueResult:
        source = node.operands[0]
        observe = self._source_observe(source)
        end = self.cutoff_index - node.skip
        start = end - (node.observations or 0) + 1
        dates = self.snapshot.dates[max(0, start):end + 1]
        cells: dict[tuple[str, ...], DailyCell] = {}
        for symbol in self._symbols(observe, candidate):
            values = self._stream(source, symbol)
            for index, date in enumerate(dates, start=max(0, start)):
                value = values[index]
                coordinate = (symbol, date) if observe.subject_kind == SubjectKind.GROUP_MEMBERS else (date,)
                cells[coordinate] = DailyCell(value, None if value is not None else "insufficient_history")
        return DailyValueResult(inferred, inferred.axes, cells, dates)

    def _keys(self, axis: Axis) -> tuple[str, ...]:
        if axis.name == "asset":
            return self.snapshot.domains[axis.domain_id]
        marker = axis.domain_id.split(":")
        count = int(marker[-3]) if len(marker) >= 3 else len(self.snapshot.dates)
        skip = int(marker[-1]) if len(marker) >= 1 else 0
        end = self.cutoff_index - skip
        return self.snapshot.dates[max(0, end - count + 1):end + 1]

    def _reduce(self, node: DailyValueNode, inferred: SemanticType, candidate: str | None, binding_id: str | None) -> DailyValueResult:
        source = self.evaluate(node.operands[0], candidate=candidate, binding_id=binding_id)
        index = next((position for position, axis in enumerate(source.axes) if axis.name == node.axis), None)
        if index is None:
            raise DailyValueError("reduction_axis_absent")
        removed = source.axes[index]
        retained = tuple(axis for axis in source.axes if axis.name != node.axis)
        results: dict[tuple[str, ...], DailyCell] = {}
        for retained_coordinate in product(*(self._keys(axis) for axis in retained)):
            values: list[Decimal] = []
            missing = 0
            for removed_key in self._keys(removed):
                coordinate = list(retained_coordinate)
                coordinate.insert(index, removed_key)
                cell = source.cells[tuple(coordinate)]
                if cell.value is None:
                    missing += 1
                else:
                    values.append(cell.value)
            required = max(node.minimum_count, int((Decimal(len(self._keys(removed))) * node.minimum_fraction).to_integral_value(rounding="ROUND_CEILING")))
            if len(values) < required or (missing and node.missing_policy == MissingPolicy.REQUIRE_ALL):
                results[retained_coordinate] = DailyCell(None, "insufficient_coverage")
                continue
            ordered = sorted(values)
            if node.reduction == ReductionOperation.MEAN:
                result = sum(values, Decimal(0)) / Decimal(len(values))
            elif node.reduction == ReductionOperation.MEDIAN:
                middle = len(values) // 2
                result = ordered[middle] if len(values) % 2 else (ordered[middle - 1] + ordered[middle]) / Decimal(2)
            elif node.reduction == ReductionOperation.MIN:
                result = ordered[0]
            elif node.reduction == ReductionOperation.MAX:
                result = ordered[-1]
            else:
                if len(values) < 2:
                    results[retained_coordinate] = DailyCell(None, "insufficient_coverage")
                    continue
                mean = sum(values, Decimal(0)) / Decimal(len(values))
                result = (sum(((value - mean) ** 2 for value in values), Decimal(0)) / Decimal(len(values) - 1)).sqrt()
            results[retained_coordinate] = DailyCell(result)
        return DailyValueResult(inferred, retained, results, source.observed_at)

    def _arithmetic(self, node: DailyValueNode, inferred: SemanticType, candidate: str | None, binding_id: str | None) -> DailyValueResult:
        left = self.evaluate(node.operands[0], candidate=candidate, binding_id=binding_id)
        right = self.evaluate(node.operands[1], candidate=candidate, binding_id=binding_id)
        results: dict[tuple[str, ...], DailyCell] = {}
        for coordinate in product(*(self._keys(axis) for axis in inferred.axes)):
            left_coordinate = tuple(coordinate[next(index for index, axis in enumerate(inferred.axes) if axis.name == child_axis.name)] for child_axis in left.axes)
            right_coordinate = tuple(coordinate[next(index for index, axis in enumerate(inferred.axes) if axis.name == child_axis.name)] for child_axis in right.axes)
            left_cell = left.cells[left_coordinate] if left.axes else left.cells[()]
            right_cell = right.cells[right_coordinate] if right.axes else right.cells[()]
            if left_cell.value is None or right_cell.value is None:
                results[coordinate] = DailyCell(None, left_cell.reason or right_cell.reason)
                continue
            try:
                operation = {
                    "add": lambda: left_cell.value + right_cell.value,
                    "subtract": lambda: left_cell.value - right_cell.value,
                    "multiply": lambda: left_cell.value * right_cell.value,
                    "divide": lambda: left_cell.value / right_cell.value,
                }[node.arithmetic or ""]
                results[coordinate] = DailyCell(operation())
            except (DivisionByZero, ZeroDivisionError):
                results[coordinate] = DailyCell(None, "division_by_zero")
        return DailyValueResult(inferred, inferred.axes, results, left.observed_at or right.observed_at)

    @staticmethod
    def _uses_candidate(node: DailyValueNode) -> bool:
        return node.subject_kind == SubjectKind.CANDIDATE or any(DailyValueEvaluator._uses_candidate(child) for child in node.operands)


def plan_daily_value(node: DailyValueNode, *, binding_id: str | None = None) -> TypedValuePlan:
    semantic_type = infer_daily_type(node, binding_id=binding_id)
    fields: set[str] = set()
    versions: set[str] = set()
    minimum = 0
    seed_anchor = False

    def visit(value: DailyValueNode) -> None:
        nonlocal minimum, seed_anchor
        for child in value.operands:
            visit(child)
        if value.kind == "observe":
            fields.add(f"{value.field.value}:{value.basis.value}")
            minimum = max(minimum, 1)
        elif value.kind == "trailing_return":
            minimum = max(minimum, (value.observations or 0) + 1)
            versions.add("trailing_return@1")
        elif value.kind in {"sma", "ema", "rsi_wilder_lean_compat", "realized_volatility"}:
            minimum = max(minimum, (value.observations or 0) + 1)
            seed_anchor = seed_anchor or value.kind in {"ema", "rsi_wilder_lean_compat"}
            versions.add(f"{value.kind}@1")
        elif value.kind == "history":
            minimum += (value.observations or 0) + value.skip
        elif value.kind == "reduce":
            versions.add(f"reduce.{value.reduction.value}@1")
        elif value.kind == "arithmetic":
            versions.add(f"arithmetic.{value.arithmetic}@1")

    visit(node)
    return TypedValuePlan(node.semantic_id, node.content_hash, semantic_type, tuple(sorted(fields)), HistoryRequirement(minimum, seed_anchor_required=seed_anchor, checkpoint_identity_required=seed_anchor), tuple(sorted(versions)), False)


def format_daily_value(node: DailyValueNode) -> str:
    if node.kind == "literal":
        return f"{node.value} {node.unit.value}"
    if node.kind == "observe":
        subject = "Candidate" if node.subject_kind == SubjectKind.CANDIDATE else (node.subject_id or "Asset")
        field = "volume" if node.field == MarketField.VOLUME else f"{node.basis.value} {node.field.value}"
        return f"{subject}'s {field}"
    if node.kind == "current":
        return f"current {format_daily_value(node.operands[0])}"
    if node.kind == "history":
        return f"{node.observations}-observation history of {format_daily_value(node.operands[0])}"
    if node.kind in {"sma", "ema", "trailing_return", "rsi_wilder_lean_compat"}:
        label = "RSI" if node.kind == "rsi_wilder_lean_compat" else node.kind.upper()
        return f"{node.observations}-observation {label} of {format_daily_value(node.operands[0])}"
    if node.kind == "reduce":
        return f"{node.reduction.value} {node.axis.value} of {format_daily_value(node.operands[0])}"
    return node.kind


@dataclass(frozen=True)
class DailyTruthResult:
    axes: tuple[Axis, ...]
    values: dict[tuple[str, ...], str]
    reasons: dict[tuple[str, ...], str | None]


def compare_daily_values(left: DailyValueResult, right: DailyValueResult, operator: Literal["gt", "gte", "lt", "lte", "eq", "neq"]) -> DailyTruthResult:
    axes = require_compatible_values(left.semantic_type, right.semantic_type)
    coordinates = product(*(DailyValueEvaluator._keys_for_static(axis, left, right) for axis in axes))
    values: dict[tuple[str, ...], str] = {}
    reasons: dict[tuple[str, ...], str | None] = {}
    for coordinate in coordinates:
        left_coordinate = tuple(coordinate[next(index for index, axis in enumerate(axes) if axis.name == child.name)] for child in left.axes)
        right_coordinate = tuple(coordinate[next(index for index, axis in enumerate(axes) if axis.name == child.name)] for child in right.axes)
        a = left.cells[left_coordinate] if left.axes else left.cells[()]
        b = right.cells[right_coordinate] if right.axes else right.cells[()]
        if a.value is None or b.value is None:
            values[coordinate] = "unknown"
            reasons[coordinate] = a.reason or b.reason
            continue
        comparisons = {
            "gt": a.value > b.value, "gte": a.value >= b.value,
            "lt": a.value < b.value, "lte": a.value <= b.value,
            "eq": a.value == b.value, "neq": a.value != b.value,
        }
        values[coordinate] = "true" if comparisons[operator] else "false"
        reasons[coordinate] = None
    return DailyTruthResult(axes, values, reasons)


def combine_truth(operator: Literal["all", "any", "not"], *values: str) -> str:
    if operator == "not":
        if len(values) != 1:
            raise DailyValueError("not_requires_one_operand")
        return {"true": "false", "false": "true", "unknown": "unknown"}[values[0]]
    if not values:
        raise DailyValueError("explicit_empty_truth_policy_required")
    if operator == "all":
        return "false" if "false" in values else "unknown" if "unknown" in values else "true"
    if operator == "any":
        return "true" if "true" in values else "unknown" if "unknown" in values else "false"
    raise DailyValueError("unknown_truth_operator")


def _keys_for_static(axis: Axis, left: DailyValueResult, right: DailyValueResult) -> tuple[str, ...]:
    for result in (left, right):
        if axis.name == "time":
            return tuple(key[0] if len(result.axes) == 1 else key[-1] for key in result.cells)
        if axis.name == "asset":
            return tuple(key[0] for key in result.cells)
    return ()


DailyValueEvaluator._keys_for_static = staticmethod(_keys_for_static)
