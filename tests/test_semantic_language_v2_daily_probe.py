from decimal import Decimal

import pytest

from ruletrade.strategy.v2.daily_probe import (
    DailyProbeLoweringError,
    lower_adjusted_close_probe,
    lower_daily_value_probe,
    parse_daily_probe_observations,
)
from ruletrade.strategy.v2.daily_values import DailyValueNode, MarketField, PriceBasis, SubjectKind


def adjusted_close() -> DailyValueNode:
    return DailyValueNode(
        semantic_id="qqq-close",
        kind="observe",
        subject_kind=SubjectKind.ASSET,
        subject_id="QQQ",
        field=MarketField.CLOSE,
        basis=PriceBasis.ADJUSTED,
    )


def test_adjusted_close_probe_preserves_semantic_identity() -> None:
    source = lower_adjusted_close_probe(adjusted_close())
    assert "RuleTradeGeneratedAlgorithm" in source
    assert "qqq-close" in source
    assert "RULETRADE_DAILY_VALUE" in source


def test_probe_parser_is_machine_readable_and_preserves_unavailable() -> None:
    records = parse_daily_probe_observations(
        'RULETRADE_DAILY_VALUE|{"semantic_id":"qqq-close","operator_id":"adjusted_close","operator_version":"1","observed_at":"2024-01-02","status":"available","value":"123.45","reason":null}\n'
        'RULETRADE_DAILY_VALUE|{"semantic_id":"qqq-close","operator_id":"adjusted_close","operator_version":"1","observed_at":"2024-01-03","status":"unavailable","value":null,"reason":"missing_bar"}'
    )
    assert records[0].value == Decimal("123.45")
    assert records[1].value is None
    assert records[1].reason == "missing_bar"


def test_probe_rejects_unimplemented_daily_operator() -> None:
    trailing = DailyValueNode(
        semantic_id="return",
        kind="trailing_return",
        operands=(adjusted_close(),),
        observations=2,
    )
    with pytest.raises(DailyProbeLoweringError, match="only asset adjusted-close"):
        lower_adjusted_close_probe(trailing)


def test_sma_probe_uses_maintained_lean_indicator_and_semantic_identity() -> None:
    sma = DailyValueNode(
        semantic_id="qqq-sma-5",
        kind="sma",
        operands=(adjusted_close(),),
        observations=5,
    )
    source = lower_daily_value_probe(sma)
    assert "SimpleMovingAverage(5)" in source
    assert "qqq-sma-5" in source
    assert '"sma"' in source


def test_requested_date_probe_has_explicit_missing_bar_fallback() -> None:
    source = lower_daily_value_probe(
        adjusted_close(), requested_date="2024-06-30"
    )
    assert 'RequestedDate = "2024-06-30"' in source
    assert "missing_completed_bar" in source
    assert "OnEndOfAlgorithm" in source
