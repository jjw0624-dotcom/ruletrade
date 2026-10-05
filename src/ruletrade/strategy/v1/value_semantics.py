from __future__ import annotations

from datetime import date
from decimal import Decimal, DivisionByZero
from typing import Literal

from ruletrade.datasets import DatasetRegistry
from ruletrade.strategy.v1.models import (
    ArithmeticExpression,
    CandidateExpression,
    CurrentExpression,
    Expression,
    FrozenModel,
    GroupRefExpression,
    IndicatorExpression,
    LiteralExpression,
    MarketSeriesExpression,
    PriceExpression,
    RollingAggregateExpression,
)

MAX_EXPRESSION_DEPTH = 8
MAX_WINDOW_OBSERVATIONS = 1000


class ValueCapability(FrozenModel):
    id: str
    label: str
    input_types: tuple[str, ...]
    output_type: str
    parameters: tuple[str, ...] = ()
    canonical_supported: bool = True
    dataset_evaluation_supported: bool
    strategy_compiler_supported: bool
    capability_level: Literal[
        "executable", "research_only", "semantic_only", "unavailable_in_current_dataset"
    ]
    provider_requirement: str
    limitation: str | None = None


def value_capabilities() -> tuple[ValueCapability, ...]:
    """Typed discovery shared by authoring surfaces and future AI/Flow clients."""

    return (
        ValueCapability(
            id="market.price.current",
            label="Current adjusted price",
            input_types=("asset", "candidate"),
            output_type="money_per_share",
            dataset_evaluation_supported=True,
            strategy_compiler_supported=True,
            capability_level="executable",
            provider_requirement="point-in-time adjusted close",
        ),
        ValueCapability(
            id="market.volume.current",
            label="Current volume",
            input_types=("asset", "candidate"),
            output_type="decimal",
            dataset_evaluation_supported=False,
            strategy_compiler_supported=False,
            capability_level="unavailable_in_current_dataset",
            provider_requirement="point-in-time daily trade-bar volume",
            limitation="Canonical typing exists, but price-only CSV fixtures cannot evaluate volume.",
        ),
        ValueCapability(
            id="market.trailing_return",
            label="Trailing return",
            input_types=("asset", "candidate"),
            output_type="percentage",
            parameters=("lookback_bars",),
            dataset_evaluation_supported=True,
            strategy_compiler_supported=True,
            capability_level="executable",
            provider_requirement="lookback + 1 completed adjusted closes",
        ),
        ValueCapability(
            id="aggregate.rolling",
            label="Rolling aggregate",
            input_types=("price_series", "volume_series", "numeric_series"),
            output_type="scalar matching the series unit",
            parameters=("operator", "window_observations"),
            dataset_evaluation_supported=True,
            strategy_compiler_supported=True,
            capability_level="executable",
            provider_requirement="completed point-in-time observations",
            limitation="Executable for adjusted-price series; Volume remains unavailable.",
        ),
        ValueCapability(
            id="arithmetic.scale",
            label="Multiply by constant",
            input_types=("decimal", "percentage", "money_per_share"),
            output_type="same scalar type",
            parameters=("factor",),
            dataset_evaluation_supported=True,
            strategy_compiler_supported=True,
            capability_level="executable",
            provider_requirement="the operand's provider requirement",
        ),
        ValueCapability(
            id="indicator.rsi",
            label="RSI",
            input_types=("asset", "candidate"),
            output_type="decimal",
            canonical_supported=False,
            dataset_evaluation_supported=False,
            strategy_compiler_supported=False,
            capability_level="semantic_only",
            provider_requirement="completed adjusted closes and a fixed Wilder smoothing contract",
            limitation="Deferred until evaluator and LEAN numerical equivalence are specified and tested.",
        ),
        ValueCapability(
            id="indicator.volatility",
            label="Volatility",
            input_types=("asset", "candidate"),
            output_type="percentage",
            canonical_supported=False,
            dataset_evaluation_supported=False,
            strategy_compiler_supported=False,
            capability_level="semantic_only",
            provider_requirement="completed adjusted closes and an explicit return/annualization convention",
            limitation="Deferred until return, sampling, and annualization semantics are fixed.",
        ),
    )


class StrategyValueProvenance(FrozenModel):
    component_id: str
    field_path: Literal["condition", "value_expression"]


class ValueEvaluationRequest(FrozenModel):
    dataset_id: str
    expression: Expression
    as_of: date
    context: Literal["research", "historical"]
    candidate_asset: str | None = None
    provenance: StrategyValueProvenance | None = None


class SemanticValueEvidence(FrozenModel):
    subject_kind: Literal["asset", "candidate"]
    subject_id: str
    value_definition: dict[str, object]
    value_type: str
    observed: Decimal
    as_of: date
    observed_at: date
    context: Literal["research", "historical"]
    provider_id: str
    provenance: StrategyValueProvenance | None = None


class ValueEvaluationError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


class DatasetValueEvaluator:
    """Bounded point-in-time evaluator for the repository price datasets.

    It intentionally does not pretend the legacy CSV files contain volume or
    provider membership history. Every slice is capped at ``as_of`` before an
    observation or aggregate is computed.
    """

    def __init__(self, datasets: DatasetRegistry) -> None:
        self.datasets = datasets

    def evaluate(self, request: ValueEvaluationRequest) -> SemanticValueEvidence:
        self._require_depth(request.expression)
        subject_kind, subject_id = self._subject(request.expression, request.candidate_asset)
        observed, observed_at, value_type = self._scalar(
            request.expression, request.dataset_id, request.as_of, request.candidate_asset
        )
        return SemanticValueEvidence(
            subject_kind=subject_kind,
            subject_id=subject_id,
            value_definition=request.expression.model_dump(mode="json"),
            value_type=value_type,
            observed=observed,
            as_of=request.as_of,
            observed_at=observed_at,
            context=request.context,
            provider_id="ruletrade-price-csv",
            provenance=request.provenance,
        )

    def _scalar(
        self,
        expression: Expression,
        dataset_id: str,
        as_of: date,
        candidate_asset: str | None,
    ) -> tuple[Decimal, date, str]:
        if isinstance(expression, PriceExpression):
            symbol = self._asset(expression.asset, candidate_asset)
            values = self._prices(dataset_id, symbol, as_of, 1)
            return values[-1][1], values[-1][0], "money_per_share"
        if isinstance(expression, CurrentExpression):
            values, value_type = self._series(
                expression.series, dataset_id, as_of, candidate_asset, 1
            )
            return values[-1][1], values[-1][0], value_type
        if isinstance(expression, RollingAggregateExpression):
            values, value_type = self._series(
                expression.series,
                dataset_id,
                as_of,
                candidate_asset,
                expression.window_observations,
            )
            numbers = sorted(item[1] for item in values)
            if expression.operator == "mean":
                observed = sum(numbers, Decimal(0)) / Decimal(len(numbers))
            elif expression.operator == "median":
                midpoint = len(numbers) // 2
                observed = (
                    numbers[midpoint]
                    if len(numbers) % 2
                    else (numbers[midpoint - 1] + numbers[midpoint]) / Decimal(2)
                )
            elif expression.operator == "min":
                observed = numbers[0]
            else:
                observed = numbers[-1]
            return observed, values[-1][0], value_type
        if isinstance(expression, IndicatorExpression):
            if expression.indicator_id != "trailing_return_indicator@1":
                raise ValueEvaluationError(
                    "unsupported_measure", "This evaluator supports trailing return only."
                )
            lookback = int(expression.parameters.get("lookback_bars", 0))
            if not 1 <= lookback <= MAX_WINDOW_OBSERVATIONS:
                raise ValueEvaluationError("invalid_window", "lookback_bars must be between 1 and 1000.")
            symbol = self._asset(expression.asset, candidate_asset)
            values = self._prices(dataset_id, symbol, as_of, lookback + 1)
            return values[-1][1] / values[0][1] - Decimal(1), values[-1][0], "percentage"
        if isinstance(expression, ArithmeticExpression):
            left, left_at, left_type = self._scalar(expression.left, dataset_id, as_of, candidate_asset)
            right, right_at, right_type = self._scalar(expression.right, dataset_id, as_of, candidate_asset)
            try:
                observed = {
                    "add": lambda: left + right,
                    "subtract": lambda: left - right,
                    "multiply": lambda: left * right,
                    "divide": lambda: left / right,
                }[expression.operator]()
            except (DivisionByZero, ZeroDivisionError) as exc:
                raise ValueEvaluationError("division_by_zero", "Value expression divides by zero.") from exc
            result_type = "decimal"
            if expression.operator == "multiply":
                if left_type == "decimal":
                    result_type = right_type
                elif right_type == "decimal":
                    result_type = left_type
            elif expression.operator in {"add", "subtract"} and left_type == right_type:
                result_type = left_type
            elif expression.operator == "divide" and right_type == "decimal":
                result_type = left_type
            return observed, max(left_at, right_at), result_type
        if isinstance(expression, LiteralExpression) and expression.value_type.value in {
            "decimal", "percentage", "money", "money_per_share"
        }:
            return Decimal(str(expression.value)), as_of, expression.value_type.value
        if isinstance(expression, GroupRefExpression):
            raise ValueEvaluationError(
                "undefined_group_observation",
                "A Group has membership identity only; NAV and across-member aggregation are deferred.",
            )
        raise ValueEvaluationError("unsupported_expression", "Expression is not dataset-evaluable.")

    def _series(self, expression, dataset_id, as_of, candidate_asset, count):
        if not isinstance(expression, MarketSeriesExpression):
            raise ValueEvaluationError("expected_series", "Current and rolling aggregates require a series.")
        if expression.field == "volume":
            raise ValueEvaluationError(
                "provider_field_unavailable",
                "The repository CSV provider contains adjusted prices but no volume.",
            )
        symbol = self._asset(expression.subject, candidate_asset)
        return self._prices(dataset_id, symbol, as_of, count), "money_per_share"

    def _prices(self, dataset_id: str, symbol: str, as_of: date, count: int):
        if not 1 <= count <= MAX_WINDOW_OBSERVATIONS + 1:
            raise ValueEvaluationError("invalid_window", "Requested observation window is out of bounds.")
        frame = self.datasets.load_prices(dataset_id, [symbol])
        historical = frame.loc[frame.index.date <= as_of, symbol].tail(count)
        if len(historical) < count:
            raise ValueEvaluationError(
                "insufficient_history",
                f"{symbol} has {len(historical)} completed observations; {count} are required.",
            )
        return tuple(
            (index.date(), Decimal(str(value)))
            for index, value in historical.items()
        )

    @classmethod
    def _subject(cls, expression: Expression, candidate_asset: str | None):
        subject = expression
        if isinstance(expression, (PriceExpression, IndicatorExpression)):
            subject = expression.asset
        elif isinstance(expression, (CurrentExpression, RollingAggregateExpression)):
            subject = expression.series
        if isinstance(subject, MarketSeriesExpression):
            subject = subject.subject
        if isinstance(subject, CandidateExpression):
            if not candidate_asset:
                raise ValueEvaluationError(
                    "candidate_context_required", "Candidate requires a Selection context."
                )
            return "candidate", candidate_asset.strip().upper()
        if isinstance(subject, LiteralExpression) and subject.value_type.value == "asset":
            return "asset", str(subject.value).strip().upper()
        if isinstance(subject, ArithmeticExpression):
            for operand in (subject.left, subject.right):
                try:
                    return cls._subject(operand, candidate_asset)
                except ValueEvaluationError as exc:
                    if exc.code not in {"unsupported_subject"}:
                        raise
        raise ValueEvaluationError(
            "unsupported_subject", "Value requires an explicit Asset or current Candidate."
        )

    @classmethod
    def _asset(cls, expression: Expression, candidate_asset: str | None) -> str:
        return cls._subject(expression, candidate_asset)[1]

    @classmethod
    def _require_depth(cls, expression: Expression, depth: int = 1) -> None:
        if depth > MAX_EXPRESSION_DEPTH:
            raise ValueEvaluationError("expression_too_deep", "Value expression exceeds depth 8.")
        children: tuple[Expression, ...] = ()
        if isinstance(expression, (PriceExpression, IndicatorExpression)):
            children = (expression.asset,)
        elif isinstance(expression, MarketSeriesExpression):
            children = (expression.subject,)
        elif isinstance(expression, (CurrentExpression, RollingAggregateExpression)):
            children = (expression.series,)
        elif isinstance(expression, ArithmeticExpression):
            children = (expression.left, expression.right)
        for child in children:
            cls._require_depth(child, depth + 1)
