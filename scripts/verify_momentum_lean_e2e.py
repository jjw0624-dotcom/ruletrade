from __future__ import annotations

import argparse
import json
import re
from decimal import Decimal
from pathlib import Path
from zipfile import ZipFile

from ruletrade.backtests.normalization import normalize_lean_result
from ruletrade.compiler.lean.e2e import COMPLETION_PATTERN, FATAL_PATTERNS, parse_target_records
from ruletrade.strategy.v1.momentum import evaluate_trailing_return_top_n

MOMENTUM_PATTERN = re.compile(
    r"RULETRADE_MOMENTUM\|(?P<event>\d{4}-\d{2}-\d{2})"
    r"\|scores=(?P<scores>[A-Z0-9.,_=:+-]+)"
    r"\|ranked=(?P<ranked>[A-Z0-9,]+)"
    r"\|selected=(?P<selected>[A-Z0-9,]+)"
)
SYMBOLS = ("QQQ", "VGT", "SOXX", "SCHG")


def _fixture_closes(fixture: Path) -> tuple[list[str], dict[str, list[Decimal]]]:
    closes: dict[str, list[Decimal]] = {}
    dates: list[str] = []
    for symbol in SYMBOLS:
        lower = symbol.lower()
        with ZipFile(fixture / "equity" / "usa" / "daily" / f"{lower}.zip") as archive:
            rows = [row.split(",") for row in archive.read(f"{lower}.csv").decode().splitlines()]
        observed_dates = [row[0][:8] for row in rows]
        if dates and observed_dates != dates:
            raise ValueError("Momentum fixture assets must have aligned Daily bars")
        dates = observed_dates
        closes[symbol] = [Decimal(row[4]) for row in rows]
    return dates, closes


def verify(log_text: str, result_payload: object, fixture: Path) -> tuple[int, int]:
    lowered = log_text.lower()
    fatal = next((pattern for pattern in FATAL_PATTERNS if pattern in lowered), None)
    if fatal or COMPLETION_PATTERN.search(log_text) is None:
        raise ValueError(f"LEAN did not complete cleanly: {fatal or 'completion marker missing'}")
    traces = {match.group("event"): match for match in MOMENTUM_PATTERN.finditer(log_text)}
    targets = parse_target_records(log_text)
    if len(traces) != 12 or len(targets) != 12:
        raise ValueError(f"expected 12 Momentum events, got traces={len(traces)}, targets={len(targets)}")
    dates, closes = _fixture_closes(fixture)
    for target in targets:
        compact_date = target.event_identity.replace("-", "")
        index = dates.index(compact_date)
        reference = evaluate_trailing_return_top_n(
            {symbol: values[: index + 1] for symbol, values in closes.items()},
            lookback_bars=126,
            count=2,
        )
        trace = traces[target.event_identity]
        if tuple(trace.group("ranked").split(",")) != reference.ranked:
            raise ValueError(f"ranking mismatch for {target.event_identity}")
        if tuple(trace.group("selected").split(",")) != reference.selected:
            raise ValueError(f"selection mismatch for {target.event_identity}")
        if target.selected != tuple(sorted(reference.selected)):
            raise ValueError(f"target selection mismatch for {target.event_identity}")
        if target.weights != dict(reference.targets):
            raise ValueError(f"target weights mismatch for {target.event_identity}")
        actual_scores = {
            symbol: Decimal(value)
            for symbol, value in (item.split("=", 1) for item in trace.group("scores").split(","))
        }
        for symbol, expected in reference.scores:
            if abs(actual_scores[symbol] - expected) > Decimal("1e-24"):
                raise ValueError(f"score mismatch for {target.event_identity} {symbol}")
    normalized = normalize_lean_result(result_payload)
    if normalized.total_orders <= 0:
        raise ValueError("Momentum backtest submitted no orders")
    return len(targets), normalized.total_orders


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify Momentum TopN LEAN differential E2E")
    parser.add_argument("--log", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--fixture", type=Path, default=Path("tests/fixtures/lean-data"))
    args = parser.parse_args()
    events, orders = verify(
        args.log.read_text(encoding="utf-8"),
        json.loads(args.result.read_text(encoding="utf-8")),
        args.fixture,
    )
    print(f"validated {events} Momentum events; Total Orders={orders}")


if __name__ == "__main__":
    main()
