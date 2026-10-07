from decimal import Decimal

import pytest

from ruletrade.strategy.v2.daily_values import (
    DailyMarketSnapshot,
    DailyValueError,
    DailyValueEvaluator,
    DailyValueNode,
    MarketField,
    MissingPolicy,
    PriceBasis,
    ReductionAxis,
    ReductionOperation,
    SubjectKind,
    format_daily_value,
    infer_daily_type,
    plan_daily_value,
)
from ruletrade.strategy.v2.semantic_types import Clock, Quantity, Unit


def observe(identifier: str, subject_kind: SubjectKind, subject_id: str | None = None, binding_id: str | None = None, field: MarketField = MarketField.CLOSE, basis: PriceBasis = PriceBasis.ADJUSTED) -> DailyValueNode:
    return DailyValueNode(
        semantic_id=identifier,
        kind="observe",
        subject_kind=subject_kind,
        subject_id=subject_id,
        binding_id=binding_id,
        field=field,
        basis=basis,
    )


def fixture_snapshot() -> DailyMarketSnapshot:
    dates = tuple(f"2026-01-{day:02d}" for day in range(1, 9))
    def row(values):
        return tuple(Decimal(str(value)) if value is not None else None for value in values)
    return DailyMarketSnapshot(
        snapshot_id="synthetic-daily-v2",
        clock=Clock(id="daily-close"),
        dates=dates,
        domains={"growth": ("AAA", "BBB", "CCC")},
        series={
            "AAA": {
                "close:adjusted": row([10, 11, 12, 13, 14, 15, 16, 17]),
                "close:raw": row([10, 11, 12, 13, 14, 15, 16, 17]),
                "volume:raw_shares": row([10, 10, 10, 10, 10, 10, 10, 30]),
            },
            "BBB": {
                "close:adjusted": row([10, 10, 10, 10, 10, 10, 10, 10]),
                "close:raw": row([10, 10, 10, 10, 10, 10, 10, 10]),
                "volume:raw_shares": row([5, 5, 5, 5, 5, 5, 5, 5]),
            },
            "CCC": {
                "close:adjusted": row([20, 19, 18, 17, 16, 15, 14, None]),
                "close:raw": row([20, 19, 18, 17, 16, 15, 14, None]),
                "volume:raw_shares": row([1, 1, 1, 1, 1, 1, 1, None]),
            },
        },
    )


def test_daily_value_types_keep_price_basis_volume_and_named_group_axis_separate() -> None:
    raw = observe("raw", SubjectKind.ASSET, "AAA", field=MarketField.CLOSE, basis=PriceBasis.RAW)
    adjusted = observe("adjusted", SubjectKind.ASSET, "AAA")
    volume = observe("volume", SubjectKind.GROUP_MEMBERS, "growth", field=MarketField.VOLUME, basis=PriceBasis.RAW_SHARES)
    assert infer_daily_type(raw).refinement == "raw_ohlc"
    assert infer_daily_type(adjusted).refinement == "adjusted_close"
    assert infer_daily_type(volume).quantity == Quantity.VOLUME
    assert infer_daily_type(volume).axes[0].domain_id == "growth"


def test_candidate_binding_is_lexical_and_group_current_keeps_asset_axis() -> None:
    candidate = observe("candidate-close", SubjectKind.CANDIDATE, binding_id="candidate")
    assert infer_daily_type(candidate, binding_id="candidate").axes == ()
    with pytest.raises(DailyValueError, match="unbound_candidate"):
        infer_daily_type(candidate, binding_id="other")
    group = observe("growth-close", SubjectKind.GROUP_MEMBERS, "growth")
    assert DailyValueEvaluator(fixture_snapshot()).evaluate(group).axes[0].name == "asset"


def test_return_sma_ema_rsi_and_volatility_have_deterministic_completed_daily_values() -> None:
    close = observe("aaa-close", SubjectKind.ASSET, "AAA")
    evaluator = DailyValueEvaluator(fixture_snapshot())
    trailing = DailyValueNode(semantic_id="return-3", kind="trailing_return", operands=(close,), observations=3)
    sma = DailyValueNode(semantic_id="sma-3", kind="sma", operands=(close,), observations=3)
    ema = DailyValueNode(semantic_id="ema-3", kind="ema", operands=(close,), observations=3)
    rsi = DailyValueNode(semantic_id="rsi-2", kind="rsi_wilder_lean_compat", operands=(close,), observations=2)
    volatility = DailyValueNode(semantic_id="vol-3", kind="realized_volatility", operands=(observe("flat-close", SubjectKind.ASSET, "BBB"),), observations=3)
    assert evaluator.evaluate(trailing).scalar() == Decimal("17") / Decimal("14") - 1
    assert evaluator.evaluate(sma).scalar() == Decimal(16)
    assert evaluator.evaluate(ema).scalar() == Decimal("16")
    assert evaluator.evaluate(rsi).scalar() == Decimal(100)
    assert evaluator.evaluate(volatility).scalar() == Decimal(0)


def test_history_reduction_is_explicit_and_missing_coverage_is_not_silently_dropped() -> None:
    close = observe("group-close", SubjectKind.GROUP_MEMBERS, "growth")
    history = DailyValueNode(semantic_id="history", kind="history", operands=(close,), observations=3)
    median = DailyValueNode(
        semantic_id="median-assets",
        kind="reduce",
        operands=(history,),
        axis=ReductionAxis.ASSET,
        reduction=ReductionOperation.MEDIAN,
        missing_policy=MissingPolicy.SKIP_WITH_COVERAGE,
        minimum_count=2,
        minimum_fraction=Decimal("0.66"),
    )
    result = DailyValueEvaluator(fixture_snapshot()).evaluate(median)
    assert result.axes[0].name == "time"
    assert result.cells[("2026-01-08",)].value == Decimal("13.5")
    require_all = median.model_copy(update={"semantic_id": "strict", "missing_policy": MissingPolicy.REQUIRE_ALL})
    assert DailyValueEvaluator(fixture_snapshot()).evaluate(require_all).cells[("2026-01-08",)].value is None


def test_scalar_broadcast_and_invalid_arithmetic_signatures_are_explicit() -> None:
    volume = observe("candidate-volume", SubjectKind.CANDIDATE, binding_id="candidate", field=MarketField.VOLUME, basis=PriceBasis.RAW_SHARES)
    scalar = DailyValueNode(semantic_id="two-point-five", kind="literal", value=Decimal("2.5"), quantity=Quantity.SCORE, unit=Unit.RATIO)
    scaled = DailyValueNode(semantic_id="scaled-volume", kind="arithmetic", operands=(scalar, volume), arithmetic="multiply")
    assert infer_daily_type(scaled, binding_id="candidate").quantity == Quantity.VOLUME
    invalid = DailyValueNode(
        semantic_id="bad",
        kind="arithmetic",
        operands=(observe("price", SubjectKind.ASSET, "AAA"), volume),
        arithmetic="add",
    )
    with pytest.raises(Exception, match="unit_mismatch"):
        infer_daily_type(invalid, binding_id="candidate")


def test_reference_evaluation_is_prefix_invariant_and_closed_group_expression_is_shared() -> None:
    close = observe("group-close", SubjectKind.GROUP_MEMBERS, "growth")
    returned = DailyValueNode(semantic_id="returns", kind="trailing_return", operands=(close,), observations=2)
    history = DailyValueNode(semantic_id="history", kind="history", operands=(returned,), observations=1)
    reference = DailyValueNode(
        semantic_id="reference",
        kind="reduce",
        operands=(history,),
        axis=ReductionAxis.ASSET,
        reduction=ReductionOperation.MEDIAN,
        missing_policy=MissingPolicy.SKIP_WITH_COVERAGE,
        minimum_count=2,
        minimum_fraction=Decimal("0.66"),
    )
    snapshot = fixture_snapshot()
    first = DailyValueEvaluator(snapshot, cutoff_index=6)
    second = DailyValueEvaluator(snapshot, cutoff_index=6)
    assert first.evaluate(reference).cells == second.evaluate(reference).cells
    first.evaluate(reference)
    assert first.evaluation_counts["reference"] == 1


def test_plan_preserves_fields_history_seed_requirement_and_human_summary() -> None:
    close = observe("candidate-close", SubjectKind.CANDIDATE, binding_id="candidate")
    rsi = DailyValueNode(semantic_id="rsi", kind="rsi_wilder_lean_compat", operands=(close,), observations=14)
    history = DailyValueNode(semantic_id="rsi-history", kind="history", operands=(rsi,), observations=63)
    plan = plan_daily_value(history, binding_id="candidate")
    assert plan.fields == ("close:adjusted",)
    assert plan.history.minimum_history_lower_bound >= 77
    assert plan.history.seed_anchor_required
    assert "63-observation" in format_daily_value(history)
