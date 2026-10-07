"""Narrow validation-only LEAN probe for v2 DailyValue observations."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from decimal import Decimal

from ruletrade.strategy.v2.daily_values import (
    DailyValueNode,
    MarketField,
    PriceBasis,
    SubjectKind,
    plan_daily_value,
)


_PREFIX = "RULETRADE_DAILY_VALUE|"
_PATTERN = re.compile(re.escape(_PREFIX) + r"(?P<payload>\{.*?\})(?:\r?$)", re.MULTILINE)
_OPERATOR_ABSOLUTE_TOLERANCES = {
    ("adjusted_close", "1"): Decimal(0),
    # LEAN decimal calculations are serialized through G29, while the reference
    # uses arbitrary-precision Decimal division. This is serialization precision,
    # not a return-definition difference.
    ("trailing_return", "1"): Decimal("1e-27"),
    ("sma", "1"): Decimal("1e-27"),
    ("ema", "1"): Decimal("1e-18"),
    ("rsi_wilder_lean_compat", "1"): Decimal("1e-12"),
    ("realized_volatility", "1"): Decimal("1e-12"),
}


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


@dataclass(frozen=True)
class DailyValueDifferential:
    semantic_id: str
    reference: DailyProbeObservation
    lean: DailyProbeObservation
    absolute_tolerance: Decimal
    numeric_delta: Decimal | None
    status_match: bool
    timestamp_match: bool
    value_match: bool
    passed: bool
    reason: str | None


def compare_daily_observations(
    reference: DailyProbeObservation,
    lean: DailyProbeObservation,
) -> DailyValueDifferential:
    if (reference.operator_id, reference.operator_version) != (
        lean.operator_id, lean.operator_version
    ):
        return DailyValueDifferential(
            reference.semantic_id, reference, lean, Decimal(0), None, False, False, False, False,
            "operator_identity_mismatch",
        )
    tolerance = _OPERATOR_ABSOLUTE_TOLERANCES.get(
        (reference.operator_id, reference.operator_version)
    )
    if tolerance is None:
        raise ValueError("unregistered_operator_tolerance")
    status_match = reference.status == lean.status
    timestamp_match = reference.observed_at == lean.observed_at
    if reference.value is None or lean.value is None:
        numeric_delta = None
        value_match = reference.value is None and lean.value is None
    else:
        numeric_delta = abs(reference.value - lean.value)
        value_match = numeric_delta <= tolerance
    identity_match = reference.semantic_id == lean.semantic_id
    passed = identity_match and status_match and timestamp_match and value_match
    reason = None if passed else (
        "semantic_identity_mismatch" if not identity_match else
        "status_mismatch" if not status_match else
        "timestamp_mismatch" if not timestamp_match else
        "value_mismatch"
    )
    return DailyValueDifferential(
        reference.semantic_id, reference, lean, tolerance, numeric_delta,
        status_match, timestamp_match, value_match, passed, reason,
    )


def _csharp_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\\"').replace("\n", "\\n").replace("\r", "\\r") + '"'


def _asset_adjusted_close_operand(value: DailyValueNode) -> DailyValueNode:
    current = value
    while current.kind in {"trailing_return", "sma", "ema", "rsi_wilder_lean_compat", "realized_volatility"}:
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


def lower_daily_value_probe(
    value: DailyValueNode,
    *,
    requested_date: str | None = None,
) -> str:
    """Lower the verified adjusted-close subset to the maintained LEAN runtime.

    A requested date emits exactly one record. A missing completed bar is
    explicit instead of being inferred from an absent log line.
    """
    plan = plan_daily_value(value)
    if not plan.backend_lowerable:
        raise DailyProbeLoweringError(
            "typed DailyValue plan is not supported by the LEAN probe backend"
        )
    observe = _asset_adjusted_close_operand(value)
    semantic_id = _csharp_string(plan.expression_id)
    ticker = _csharp_string(observe.subject_id or "")
    requested = "null" if requested_date is None else _csharp_string(requested_date)
    if value.kind == "observe":
        operator_id, operator_version = "adjusted_close", "1"
        state = ""
        setup = ""
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
        setup = ""
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
    elif value.kind == "sma":
        period = value.observations or 0
        if period < 1:
            raise DailyProbeLoweringError("sma requires a positive observation period")
        operator_id, operator_version = "sma", "1"
        state = "    private SimpleMovingAverage _indicator;"
        setup = f"        _indicator = new SimpleMovingAverage({period});"
        evaluate = """
        if (!data.Bars.TryGetValue(_symbol, out var bar))
        {
            Emit(observedAt, "unavailable", null, "missing_bar");
            return;
        }
        _indicator.Update(Time, bar.Close);
        if (!_indicator.IsReady)
        {
            Emit(observedAt, "not_ready", null, "insufficient_history");
            return;
        }
        Emit(observedAt, "available", _indicator.Current.Value, null);"""
    elif value.kind == "ema":
        period = value.observations or 0
        if period < 1:
            raise DailyProbeLoweringError("ema requires a positive observation period")
        operator_id, operator_version = "ema", "1"
        state = "    private ExponentialMovingAverage _indicator;"
        setup = f"        _indicator = new ExponentialMovingAverage({period});"
        evaluate = """
        if (!data.Bars.TryGetValue(_symbol, out var bar))
        {
            Emit(observedAt, "unavailable", null, "missing_bar");
            return;
        }
        _indicator.Update(Time, bar.Close);
        if (!_indicator.IsReady)
        {
            Emit(observedAt, "not_ready", null, "insufficient_history");
            return;
        }
        Emit(observedAt, "available", _indicator.Current.Value, null);"""
    elif value.kind == "rsi_wilder_lean_compat":
        period = value.observations or 0
        if period < 1:
            raise DailyProbeLoweringError("rsi requires a positive observation period")
        operator_id, operator_version = "rsi_wilder_lean_compat", "1"
        state = "    private RelativeStrengthIndex _indicator;"
        setup = f"        _indicator = new RelativeStrengthIndex({period}, MovingAverageType.Wilders);"
        evaluate = """
        if (!data.Bars.TryGetValue(_symbol, out var bar))
        {
            Emit(observedAt, "unavailable", null, "missing_bar");
            return;
        }
        _indicator.Update(Time, bar.Close);
        if (!_indicator.IsReady)
        {
            Emit(observedAt, "not_ready", null, "insufficient_history");
            return;
        }
        Emit(observedAt, "available", _indicator.Current.Value, null);"""
    elif value.kind == "realized_volatility":
        period = value.observations or 0
        if period < 3:
            raise DailyProbeLoweringError("realized_volatility requires at least three price observations")
        operator_id, operator_version = "realized_volatility", "1"
        state = f"    private readonly RollingWindow<decimal> _closes = new RollingWindow<decimal>({period});"
        setup = ""
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
        decimal sum = 0m;
        var returns = new decimal[{period - 1}];
        for (var index = 0; index < returns.Length; index++)
        {{
            returns[index] = _closes[index] / _closes[index + 1] - 1m;
            sum += returns[index];
        }}
        var mean = sum / returns.Length;
        decimal squared = 0m;
        foreach (var item in returns)
        {{
            var difference = item - mean;
            squared += difference * difference;
        }}
        var sampleVariance = squared / (returns.Length - 1);
        var annualized = (decimal)(Math.Sqrt((double)sampleVariance) * Math.Sqrt(252d));
        Emit(observedAt, "available", annualized, null);"""
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
    private bool _emitted;
    private const char Quote = (char)34;
    private const string RequestedDate = {requested};
{state}

    public override void Initialize()
    {{
        SetStartDate(2024, 1, 1);
        SetEndDate(2024, 12, 31);
        _symbol = AddEquity({ticker}, Resolution.Daily).Symbol;
{setup}
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
        if (RequestedDate != null && observedAt != RequestedDate)
        {{
            return;
        }}
        _emitted = true;
{evaluate}
    }}

    public override void OnEndOfAlgorithm()
    {{
        if (RequestedDate != null && !_emitted)
        {{
            Emit(RequestedDate, "unavailable", null, "missing_completed_bar");
        }}
    }}
}}
"""


def lower_adjusted_close_probe(
    value: DailyValueNode,
    *,
    requested_date: str | None = None,
) -> str:
    if value.kind != "observe":
        raise DailyProbeLoweringError("only asset adjusted-close observe@1 is lowerable")
    return lower_daily_value_probe(value, requested_date=requested_date)


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
