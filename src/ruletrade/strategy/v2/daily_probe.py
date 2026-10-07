"""Narrow validation-only LEAN probe for v2 DailyValue observations."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from decimal import Decimal

from ruletrade.strategy.v2.daily_values import DailyValueNode, MarketField, PriceBasis, SubjectKind


_PREFIX = "RULETRADE_DAILY_VALUE|"
_PATTERN = re.compile(r"^RULETRADE_DAILY_VALUE\|(?P<payload>{.*})$", re.MULTILINE)


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
    identity = json.dumps(value.semantic_id)
    ticker = json.dumps(value.subject_id)
    return f"""using System;
using System.Globalization;
using QuantConnect;
using QuantConnect.Algorithm;
using QuantConnect.Data;

public class RuleTradeDailyValueProbe : QCAlgorithm
{{
    private Symbol _symbol;

    public override void Initialize()
    {{
        SetStartDate(2024, 1, 1);
        SetEndDate(2024, 12, 31);
        _symbol = AddEquity({ticker}, Resolution.Daily).Symbol;
    }}

    public override void OnData(Slice data)
    {{
        if (!data.Bars.TryGetValue(_symbol, out var bar))
        {{
            Debug("RULETRADE_DAILY_VALUE|{{\"semantic_id\":" + {identity}
                + ",\"operator_id\":\"adjusted_close\",\"operator_version\":\"1\""
                + ",\"observed_at\":\"" + Time.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
                + "\",\"status\":\"unavailable\",\"value\":null,\"reason\":\"missing_bar\"}}");
            return;
        }}
        Debug("RULETRADE_DAILY_VALUE|{{\"semantic_id\":" + {identity}
            + ",\"operator_id\":\"adjusted_close\",\"operator_version\":\"1\""
            + ",\"observed_at\":\"" + Time.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            + "\",\"status\":\"available\",\"value\":\"" + bar.Close.ToString("G29", CultureInfo.InvariantCulture)
            + "\",\"reason\":null}}");
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
