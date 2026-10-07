from decimal import Decimal, localcontext

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
    compare_daily_values,
    combine_truth,
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


def test_typed_comparison_and_three_valued_boolean_short_circuit() -> None:
    close = observe("close", SubjectKind.ASSET, "AAA")
    current = DailyValueEvaluator(fixture_snapshot()).evaluate(close)
    threshold = DailyValueNode(
        semantic_id="threshold",
        kind="literal",
        value=Decimal("10"),
        quantity=Quantity.PRICE,
        unit=Unit.USD_PER_SHARE,
        refinement="adjusted_close",
    )
    comparison = compare_daily_values(current, DailyValueEvaluator(fixture_snapshot()).evaluate(threshold), "gt")
    assert comparison.values[()] == "true"
    assert combine_truth("all", "false", "unknown") == "false"
    assert combine_truth("any", "true", "unknown") == "true"
    assert combine_truth("not", "unknown") == "unknown"


def test_history_planner_preserves_nested_readiness_and_distinct_seed_checkpoint() -> None:
    close = observe("close", SubjectKind.CANDIDATE, binding_id="candidate")
    rsi = DailyValueNode(
        semantic_id="rsi-14",
        kind="rsi_wilder_lean_compat",
        operands=(close,),
        observations=14,
    )
    plan = plan_daily_value(
        DailyValueNode(
            semantic_id="rsi-history",
            kind="history",
            operands=(rsi,),
            observations=63,
        ),
        binding_id="candidate",
    )
    assert plan.history.minimum_history_lower_bound == 77
    assert plan.history.seed_anchor_required
    assert plan.history.checkpoint_identity_required

    ema = DailyValueNode(
        semantic_id="ema-50",
        kind="ema",
        operands=(close,),
        observations=50,
    )
    ema_history = plan_daily_value(
        DailyValueNode(
            semantic_id="ema-history",
            kind="history",
            operands=(ema,),
            observations=63,
        ),
        binding_id="candidate",
    )
    assert ema_history.history.minimum_history_lower_bound == 112
    assert ema_history.history.seed_anchor_required


@pytest.mark.parametrize(
    ("prices", "expected"),
    [
        ([10, 11, 12, 13, 14, 15], Decimal("100")),
        ([15, 14, 13, 12, 11, 10], Decimal("0")),
        ([10, 10, 10, 10, 10, 10], Decimal("50")),
    ],
)
def test_rsi_wilder_profile_golden_monotonic_and_flat(
    prices: list[int],
    expected: Decimal,
) -> None:
    dates = tuple(f"2026-02-{day:02d}" for day in range(1, len(prices) + 1))
    snapshot = DailyMarketSnapshot(
        snapshot_id="rsi-golden",
        clock=Clock(id="daily-close"),
        dates=dates,
        domains={},
        series={
            "AAA": {
                "close:adjusted": tuple(Decimal(value) for value in prices),
            }
        },
    )
    close = observe("rsi-close", SubjectKind.ASSET, "AAA")
    rsi = DailyValueNode(
        semantic_id="rsi-3",
        kind="rsi_wilder_lean_compat",
        operands=(close,),
        observations=3,
    )
    assert DailyValueEvaluator(snapshot).evaluate(rsi).scalar() == expected


def test_rsi_wilder_profile_preserves_continuing_state_not_rolling_mean() -> None:
    prices = [10, 9, 10, 11, 12, 13, 14, 15]
    dates = tuple(f"2026-03-{day:02d}" for day in range(1, len(prices) + 1))
    snapshot = DailyMarketSnapshot(
        snapshot_id="rsi-continuing",
        clock=Clock(id="daily-close"),
        dates=dates,
        domains={},
        series={
            "AAA": {
                "close:adjusted": tuple(Decimal(value) for value in prices),
            }
        },
    )
    close = observe("rsi-close", SubjectKind.ASSET, "AAA")
    rsi = DailyValueNode(
        semantic_id="rsi-3",
        kind="rsi_wilder_lean_compat",
        operands=(close,),
        observations=3,
    )
    value = DailyValueEvaluator(snapshot).evaluate(rsi).scalar()
    assert value is not None
    assert value < Decimal("100")
    assert value > Decimal("90")


def test_typed_plan_reports_only_verified_probe_roots_as_backend_lowerable() -> None:
    asset_close = observe("asset-close", SubjectKind.ASSET, "AAA")
    sma = DailyValueNode(
        semantic_id="asset-sma",
        kind="sma",
        operands=(asset_close,),
        observations=3,
    )
    assert plan_daily_value(asset_close).backend_lowerable
    assert plan_daily_value(sma).backend_lowerable

    history = DailyValueNode(
        semantic_id="asset-history",
        kind="history",
        operands=(sma,),
        observations=2,
    )
    assert not plan_daily_value(history).backend_lowerable
    assert not plan_daily_value(
        observe("candidate-close", SubjectKind.CANDIDATE, binding_id="candidate"),
        binding_id="candidate",
    ).backend_lowerable


def test_k07_interpretation_a_value_stress_case_is_reference_executable() -> None:
    parameters = {
        "A": ("10", ".002", ".00204", "400"),
        "B": ("20", ".003", ".00306", "300"),
        "C": ("4", ".002", ".00204", "300"),
        "D": ("50", ".001", ".01", "100"),
    }
    series: dict[str, dict[str, tuple[Decimal | None, ...]]] = {}
    with localcontext() as context:
        context.prec = 28
        for asset, (close, past, current_return, current_volume) in parameters.items():
            current = Decimal(close)
            previous = current / (Decimal(1) + Decimal(current_return))
            prices = tuple(
                previous / (Decimal(1) + Decimal(past)) ** (252 - index)
                for index in range(253)
            ) + (current,)
            series[asset] = {
                "close:adjusted": prices,
                "close:raw": prices,
                "volume:raw_shares": (
                    (Decimal(100),) * 253 + (Decimal(current_volume),)
                ),
            }
    snapshot = DailyMarketSnapshot(
        snapshot_id="k07-interpretation-a",
        clock=Clock(id="daily-close"),
        dates=tuple(f"observation-{index:03d}" for index in range(254)),
        domains={"k07": tuple(parameters)},
        series=series,
    )

    price = observe(
        "k07-price",
        SubjectKind.CANDIDATE,
        binding_id="candidate",
        basis=PriceBasis.RAW,
    )
    volume = observe(
        "k07-volume",
        SubjectKind.CANDIDATE,
        binding_id="candidate",
        field=MarketField.VOLUME,
        basis=PriceBasis.RAW_SHARES,
    )
    adjusted = observe(
        "k07-adjusted",
        SubjectKind.CANDIDATE,
        binding_id="candidate",
    )
    price_floor = DailyValueNode(
        semantic_id="k07-price-floor",
        kind="literal",
        value=Decimal(5),
        quantity=Quantity.PRICE,
        unit=Unit.USD_PER_SHARE,
        refinement="raw_ohlc",
    )
    volume_history = DailyValueNode(
        semantic_id="k07-prior-volume",
        kind="history",
        operands=(volume,),
        observations=252,
        skip=1,
    )
    volume_mean = DailyValueNode(
        semantic_id="k07-volume-mean",
        kind="reduce",
        operands=(volume_history,),
        axis=ReductionAxis.TIME,
        reduction=ReductionOperation.MEAN,
    )
    multiplier = DailyValueNode(
        semantic_id="k07-volume-multiplier",
        kind="literal",
        value=Decimal("2.5"),
        quantity=Quantity.SCORE,
        unit=Unit.RATIO,
    )
    volume_bound = DailyValueNode(
        semantic_id="k07-volume-bound",
        kind="arithmetic",
        operands=(multiplier, volume_mean),
        arithmetic="multiply",
    )
    daily_return = DailyValueNode(
        semantic_id="k07-daily-return",
        kind="trailing_return",
        operands=(adjusted,),
        observations=1,
    )
    movement = DailyValueNode(
        semantic_id="k07-absolute-daily-return",
        kind="absolute",
        operands=(daily_return,),
    )
    movement_history = DailyValueNode(
        semantic_id="k07-prior-movement",
        kind="history",
        operands=(movement,),
        observations=252,
        skip=1,
    )
    movement_mean = DailyValueNode(
        semantic_id="k07-movement-mean",
        kind="reduce",
        operands=(movement_history,),
        axis=ReductionAxis.TIME,
        reduction=ReductionOperation.MEAN,
    )
    movement_relative = DailyValueNode(
        semantic_id="k07-movement-relative",
        kind="arithmetic",
        operands=(movement, movement_mean),
        arithmetic="divide",
    )
    one = DailyValueNode(
        semantic_id="k07-one",
        kind="literal",
        value=Decimal(1),
        quantity=Quantity.SCORE,
        unit=Unit.RATIO,
        refinement="ratio",
    )
    movement_delta = DailyValueNode(
        semantic_id="k07-movement-delta",
        kind="arithmetic",
        operands=(movement_relative, one),
        arithmetic="subtract",
    )
    movement_abs_delta = DailyValueNode(
        semantic_id="k07-movement-abs-delta",
        kind="absolute",
        operands=(movement_delta,),
    )
    tolerance = DailyValueNode(
        semantic_id="k07-movement-tolerance",
        kind="literal",
        value=Decimal(".05"),
        quantity=Quantity.SCORE,
        unit=Unit.RATIO,
        refinement="ratio",
    )
    ranking = DailyValueNode(
        semantic_id="k07-ranking-return",
        kind="trailing_return",
        operands=(adjusted,),
        observations=126,
    )

    evaluator = DailyValueEvaluator(snapshot)
    eligible: list[tuple[str, Decimal]] = []
    for candidate in parameters:
        kwargs = {"candidate": candidate, "binding_id": "candidate"}
        price_truth = compare_daily_values(
            evaluator.evaluate(price, **kwargs),
            evaluator.evaluate(price_floor, **kwargs),
            "gte",
        ).values[()]
        volume_truth = compare_daily_values(
            evaluator.evaluate(volume, **kwargs),
            evaluator.evaluate(volume_bound, **kwargs),
            "gte",
        ).values[()]
        movement_truth = compare_daily_values(
            evaluator.evaluate(movement_abs_delta, **kwargs),
            evaluator.evaluate(tolerance, **kwargs),
            "lte",
        ).values[()]
        if combine_truth("all", price_truth, volume_truth, movement_truth) == "true":
            score = evaluator.evaluate(ranking, **kwargs).scalar()
            assert score is not None
            eligible.append((candidate, score))

    assert [asset for asset, _ in sorted(
        eligible, key=lambda item: item[1], reverse=True
    )] == ["B", "A"]


def test_provenance_records_domain_coverage_and_shared_semantic_addresses() -> None:
    group = observe("growth-close", SubjectKind.GROUP_MEMBERS, "growth")
    returned = DailyValueNode(
        semantic_id="growth-return",
        kind="trailing_return",
        operands=(group,),
        observations=2,
    )
    reduced = DailyValueNode(
        semantic_id="growth-median-a",
        kind="reduce",
        operands=(returned,),
        axis=ReductionAxis.ASSET,
        reduction=ReductionOperation.MEDIAN,
        missing_policy=MissingPolicy.SKIP_WITH_COVERAGE,
        minimum_count=2,
        minimum_fraction=Decimal(".66"),
    )
    evaluator = DailyValueEvaluator(fixture_snapshot())
    first = evaluator.evaluate(reduced)
    assert first.provenance is not None
    assert first.provenance.snapshot_id == "synthetic-daily-v2"
    assert first.provenance.reduction_axis == "asset"
    assert first.provenance.requested_members == ("AAA", "BBB", "CCC")
    assert first.provenance.available_members == ("AAA", "BBB")
    assert first.provenance.missing_members == ("CCC",)

    alias = reduced.model_copy(update={"semantic_id": "growth-median-b"})
    second = evaluator.evaluate(alias)
    assert second.cells == first.cells
    assert second.provenance is not None
    assert second.provenance.semantic_ids[0] == "growth-median-a"
    assert "growth-median-b" in second.provenance.semantic_ids
    assert evaluator.evaluation_counts["growth-median-a"] == 1
    assert "growth-median-b" not in evaluator.evaluation_counts
