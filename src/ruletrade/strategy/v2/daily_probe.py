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
    """Return one ordinary C# string literal without relying on JSON escaping."""
    return '"' + (
        value.replace("\\", "\\\\")
        .replace('"', '\\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
    ) + '"'


def lower_adjusted_close_probe(value: DailyValueNode) -> str:
    """Generate a maintained-QCAlgorithm probe for one adjusted-close Value.

    This deliberately proves the first observation path only. Other DailyValue
    operators are rejected until their typed lowering is implemented.
    """
    if not (
        value.kind == "observe"
        and value.subject_kind == SubjectKind.ASSET
        and value.field == MarketField.CLOSE
        and value.basis == PriceBasis.ADJUSTED
        and value.subject_id
    ):
        raise DailyProbeLoweringError("only asset adjusted-close observe@1 is lowerable")
    semantic_id = _csharp_string(value.semantic_id)
    ticker = _csharp_string(value.subject_id)
    return f"""using System;
using System.Globalization;
using QuantConnect;
using QuantConnect.Algorithm;
using QuantConnect.Data;

public class RuleTradeGeneratedAlgorithm : QCAlgorithm
{{
    private Symbol _symbol;
    private const char Quote = (char)34;

    public override void Initialize()
    {{
        SetStartDate(2024, 1, 1);
        SetEndDate(2024, 12, 31);
        _symbol = AddEquity({ticker}, Resolution.Daily).Symbol;
    }}

    public override void OnData(Slice data)
    {{
        var observedAt = Time.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        if (!data.Bars.TryGetValue(_symbol, out var bar))
        {{
            Debug("RULETRADE_DAILY_VALUE|{{"
                + Quote + "semantic_id" + Quote + ":" + Quote + {semantic_id} + Quote
                + "," + Quote + "operator_id" + Quote + ":" + Quote + "adjusted_close" + Quote
                + "," + Quote + "operator_version" + Quote + ":" + Quote + "1" + Quote
                + "," + Quote + "observed_at" + Quote + ":" + Quote + observedAt + Quote
                + "," + Quote + "status" + Quote + ":" + Quote + "unavailable" + Quote
                + "," + Quote + "value" + Quote + ":null"
                + "," + Quote + "reason" + Quote + ":" + Quote + "missing_bar" + Quote + "}}");
            return;
        }}
        Debug("RULETRADE_DAILY_VALUE|{{"
            + Quote + "semantic_id" + Quote + ":" + Quote + {semantic_id} + Quote
            + "," + Quote + "operator_id" + Quote + ":" + Quote + "adjusted_close" + Quote
            + "," + Quote + "operator_version" + Quote + ":" + Quote + "1" + Quote
            + "," + Quote + "observed_at" + Quote + ":" + Quote + observedAt + Quote
            + "," + Quote + "status" + Quote + ":" + Quote + "available" + Quote
            + "," + Quote + "value" + Quote + ":" + Quote + bar.Close.ToString("G29", CultureInfo.InvariantCulture) + Quote
            + "," + Quote + "reason" + Quote + ":null}}");
    }}
}}
"""


def parse_daily_probe_observations(log_text: str) -> tuple[DailyProbeObservation, ...]:
    observations: list[DailyProbeObservation] = []
    for match in _PATTERN.finditer(log_text):
        payload = json.loads(match.group("payload"))
        if payload["status"] not in {"available", "unavailable", "not_ready"}:
            raise ValueError("invalid daily probe status")
        value = payload.get("value")
        observations.append(DailyProbeObservation(
            semantic_id=payload["semantic_id"],
            operator_id=payload["operator_id"],
            operator_version=payload["operator_version"],
            observed_at=payload["observed_at"],
            status=payload["status"],
            value=Decimal(value) if value is not None else None,
            reason=payload.get("reason"),
        ))
    return tuple(observations)
