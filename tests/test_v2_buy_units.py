from decimal import Decimal

from ruletrade.strategy.v2.daily_values import (
    DailyMarketSnapshot,
    DailyValueNode,
    MarketField,
    PriceBasis,
    SubjectKind,
)
from ruletrade.strategy.v2.models import (
    BuyStatementV2,
    CandidateBinding,
    EventDefinitionV2,
    EventStatementV2,
    OrderTargetV2,
    ProgramClockV2,
    SelectionStatementV2,
    SelectionV2,
    SemanticProgramV2,
    UnitsEachAmountV2,
)
from ruletrade.strategy.v2.program_execution import execute_program_v2
from ruletrade.strategy.v2.program_validation import validate_program_v2
from ruletrade.strategy.v2.semantic_types import Clock


def snapshot() -> DailyMarketSnapshot:
    return DailyMarketSnapshot(
        snapshot_id="buy-units",
        clock=Clock(id="daily-close"),
        dates=("2026-01-01", "2026-01-02"),
        domains={"growth": ("QQQ", "VGT", "SOXX")},
        series={
            "QQQ": {"close:adjusted": (Decimal("100"), Decimal("110"))},
            "VGT": {"close:adjusted": (Decimal("100"), Decimal("105"))},
            "SOXX": {"close:adjusted": (Decimal("100"), Decimal("90"))},
        },
    )


def ranking() -> DailyValueNode:
    close = DailyValueNode(
        semantic_id="candidate-close",
        kind="observe",
        subject_kind=SubjectKind.CANDIDATE,
        binding_id="candidate",
        field=MarketField.CLOSE,
        basis=PriceBasis.ADJUSTED,
    )
    return DailyValueNode(
        semantic_id="candidate-return",
        kind="trailing_return",
        observations=1,
        operands=(close,),
    )


def test_scheduled_group_buy_emits_one_additive_order_per_member() -> None:
    buy = BuyStatementV2(
        semantic_id="buy-growth",
        target=OrderTargetV2(semantic_id="growth-target", kind="group", ref="growth"),
        amount=UnitsEachAmountV2(units=1),
    )
    program = SemanticProgramV2(
        semantic_id="group-accumulation",
        clocks=(ProgramClockV2(id="daily-close", timeframe="daily"),),
        statements=(
            EventStatementV2(
                semantic_id="daily-entry",
                event=EventDefinitionV2(
                    semantic_id="daily-event",
                    clock_id="daily-close",
                    trigger="scheduled",
                ),
                statements=(buy,),
            ),
        ),
    )

    assert validate_program_v2(program) == ()
    result = execute_program_v2(program, snapshot(), cutoff_index=1)

    assert [(item.symbol, item.quantity) for item in result.order_intents] == [
        ("QQQ", Decimal("1")),
        ("VGT", Decimal("1")),
        ("SOXX", Decimal("1")),
    ]
    assert result.target_weights == {}
    assert result.evidence[-1].kind == "buy"
    assert result.evidence[-1].outcome == "orders_created"


def test_choose_then_buy_uses_only_the_local_selection_output() -> None:
    choose = SelectionStatementV2(
        semantic_id="choose-top-two",
        selection=SelectionV2(
            semantic_id="top-two",
            universe_id="growth",
            binding=CandidateBinding(id="candidate", domain_id="growth"),
            ranking=ranking(),
            count=2,
            shortage_policy="choose_all",
        ),
        output_id="chosen",
    )
    buy = BuyStatementV2(
        semantic_id="buy-chosen",
        target=OrderTargetV2(semantic_id="chosen-target", kind="selection", ref="chosen"),
        amount=UnitsEachAmountV2(units=2),
    )
    program = SemanticProgramV2(
        semantic_id="selected-accumulation",
        clocks=(ProgramClockV2(id="daily-close", timeframe="daily"),),
        statements=(choose, buy),
    )

    assert validate_program_v2(program) == ()
    result = execute_program_v2(program, snapshot(), cutoff_index=1)

    assert result.selection_outputs["chosen"] == ("QQQ", "VGT")
    assert [(item.symbol, item.quantity) for item in result.order_intents] == [
        ("QQQ", Decimal("2")),
        ("VGT", Decimal("2")),
    ]


def test_buy_cannot_reference_a_later_or_missing_selection() -> None:
    program = SemanticProgramV2(
        semantic_id="invalid-buy",
        clocks=(ProgramClockV2(id="daily-close", timeframe="daily"),),
        statements=(
            BuyStatementV2(
                semantic_id="buy-missing",
                target=OrderTargetV2(
                    semantic_id="missing-target", kind="selection", ref="missing",
                ),
                amount=UnitsEachAmountV2(units=1),
            ),
        ),
    )

    assert [item.code for item in validate_program_v2(program)] == [
        "unknown_selection_output"
    ]
