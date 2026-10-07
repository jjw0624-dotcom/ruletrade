"""Narrow validation-only LEAN probe for v2 DailyValue observations."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from decimal import Decimal

from ruletrade.strategy.v2.daily_values import DailyValueNode, MarketField, PriceBasis, SubjectKind


_PREFIX = "RULETRADE_DAILY_VALUE|"
_PATTERN = re.compile(re.escape(_PREFIX) + r"(?P<payload>\{.*?\})(?:\r?$)", re.MULTILINE)


class DailyProbeLoweringError(ValueError):
    pass


@dataclass(frozen=True)
class DailyProbeObservation:
    semantic_id: str
    operator_id: str
    operator_version: str
    observed_at: str
    status: str
    value: Decimal | None
    reason: str | None = None


def _csharp_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\\"').replace("\n", "\\n").replace("\r", "\\r") + '"'


def _asset_adjusted_close_operand(value: DailyValueNode) -> DailyValueNode:
    current = value
    while current.kind == "trailing_return":
        current = current.operands[0]
    if not (
        current.kind == "observe"
        and current.subject_kind == SubjectKind.ASSET
        and current.field == MarketField.CLOSE
        and current.basis == PriceBasis.ADJUSTED
        and current.subject_id
    ):
        raise DailyProbeLoweringError("only asset adjusted-close DailyValue expressions are lowerable")
    return current


def lower_daily_value_probe(value: DailyValueNode) -> str:
    """Lower the verified adjusted-close subset to the maintained LEAN runtime."""
    observe = _asset_adjusted_close_operand(value)
    semantic_id = _csharp_string(value.semantic_id)
    ticker = _csharp_string(observe.subject_id or "")
    if value.kind == "observe":
        operator_id, operator_version = "adjusted_close", "1"
        state = ""
        evaluate = """
        if (!data.Bars.TryGetValue(_symbol, out var bar))
        {
            Emit(observedAt, "unavailable", null, "missing_bar");
            return;
        }
        Emit(observedAt, "available", bar.Close, null);"""
    elif value.kind == "trailing_return":
        period = value.observations or 0
        if period < 1:
            raise DailyProbeLoweringError("trailing_return requires a positive observation period")
        operator_id, operator_version = "trailing_return", "1"
        state = f"    private readonly RollingWindow<decimal> _closes = new RollingWindow<decimal>({period + 1});"
        evaluate = f"""
        if (!data.Bars.TryGetValue(_symbol, out var bar))
        {{
            Emit(observedAt, "unavailable", null, "missing_bar");
            return;
        }}
        _closes.Add(bar.Close);
        if (!_closes.IsReady)
        {{
            Emit(observedAt, "not_ready", null, "insufficient_history");
            return;
        }}
        Emit(observedAt, "available", bar.Close / _closes[{period}] - 1m, null);"""
    else:
        raise DailyProbeLoweringError(f"unsupported DailyValue lowering: {value.kind}")

    return f"""using System;
using System.Globalization;
using QuantConnect;
using QuantConnect.Algorithm;
using QuantConnect.Data;
using QuantConnect.Indicators;

public class RuleTradeGeneratedAlgorithm : QCAlgorithm
{{
    private Symbol _symbol;
    private const char Quote = (char)34;
{state}

    public override void Initialize()
    {{
        SetStartDate(2024, 1, 1);
        SetEndDate(2024, 12, 31);
        _symbol = AddEquity({ticker}, Resolution.Daily).Symbol;
    }}

    private void Emit(string observedAt, string status, decimal? value, string reason)
    {{
        var valueJson = value.HasValue
            ? Quote + value.Value.ToString("G29", CultureInfo.InvariantCulture) + Quote
            : "null";
        var reasonJson = reason == null ? "null" : Quote + reason + Quote;
        Debug("RULETRADE_DAILY_VALUE|{{"
            + Quote + "semantic_id" + Quote + ":" + Quote + {semantic_id} + Quote
            + "," + Quote + "operator_id" + Quote + ":" + Quote + "{operator_id}" + Quote
            + "," + Quote + "operator_version" + Quote + ":" + Quote + "{operator_version}" + Quote
            + "," + Quote + "observed_at" + Quote + ":" + Quote + observedAt + Quote
            + "," + Quote + "status" + Quote + ":" + Quote + status + Quote
            + "," + Quote + "value" + Quote + ":" + valueJson
            + "," + Quote + "reason" + Quote + ":" + reasonJson + "}}");
    }}

    public override void OnData(Slice data)
    {{
        var observedAt = Time.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
{evaluate}
    }}
}}
"""


def lower_adjusted_close_probe(value: DailyValueNode) -> str:
    """Compatibility entry point for the first verified current-value probe."""
    if value.kind != "observe":
        raise DailyProbeLoweringError("only asset adjusted-close observe@1 is lowerable")
    return lower_daily_value_probe(value)


def parse_daily_probe_observations(log_text: str) -> tuple[DailyProbeObservation, ...]:
    observations: list[DailyProbeObservation] = []
    for match in _PATTERN.finditer(log_text):
        payload = json.loads(match.group("payload"))
        if payload["status"] not in {"available", "unavailable", "not_ready"}:
            raise ValueError("invalid daily probe status")
        parsed_value = payload.get("value")
        observations.append(DailyProbeObservation(
            semantic_id=payload["semantic_id"],
            operator_id=payload["operator_id"],
            operator_version=payload["operator_version"],
            observed_at=payload["observed_at"],
            status=payload["status"],
            value=Decimal(parsed_value) if parsed_value is not None else None,
            reason=payload.get("reason"),
        ))
    return tuple(observations)
