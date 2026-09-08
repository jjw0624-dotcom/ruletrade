import json
import re
import subprocess
import sys
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from zipfile import ZipFile

import pytest

from ruletrade.compiler.lean import lower_to_lean_plan
from ruletrade.compiler.lean.e2e import INTEREST_RATE_WARNING, validate_golden_e2e
from ruletrade.core.selection import select_symbols
from ruletrade.strategy.models import RandomNSelection
from ruletrade.strategy.v1.fixtures import golden_portfolio_strategy
from ruletrade.strategy.v1.randomness import deterministic_random_seed

SYMBOLS = ("qqq", "vgt", "soxx", "schg", "tlt", "ief")
US_EQUITY_HOLIDAYS_2024 = frozenset(
    {
        date(2024, 1, 1),
        date(2024, 1, 15),
        date(2024, 2, 19),
        date(2024, 3, 29),
        date(2024, 5, 27),
        date(2024, 6, 19),
        date(2024, 7, 4),
        date(2024, 9, 2),
        date(2024, 11, 28),
        date(2024, 12, 25),
    }
)
EVENTS = (
    "2024-01-02",
    "2024-02-01",
    "2024-03-01",
    "2024-04-01",
    "2024-05-01",
    "2024-06-03",
    "2024-07-01",
    "2024-08-01",
    "2024-09-03",
    "2024-10-01",
    "2024-11-01",
    "2024-12-02",
)


def _trading_dates_2024() -> tuple[date, ...]:
    current = date(2024, 1, 1)
    result: list[date] = []
    while current <= date(2024, 12, 31):
        if current.weekday() < 5 and current not in US_EQUITY_HOLIDAYS_2024:
            result.append(current)
        current += timedelta(days=1)
    return tuple(result)


def test_tracked_lean_fixture_contains_golden_assets_and_interest_rate() -> None:
    fixture = Path(__file__).parent / "fixtures" / "lean-data"
    for symbol in ("qqq", "vgt", "soxx", "schg", "tlt", "ief"):
        archive_path = fixture / "equity" / "usa" / "daily" / f"{symbol}.zip"
        with ZipFile(archive_path) as archive:
            assert archive.namelist() == [f"{symbol}.csv"]
            assert len(archive.read(f"{symbol}.csv").splitlines()) > 12
        assert (fixture / "equity" / "usa" / "map_files" / f"{symbol}.csv").is_file()
        assert (fixture / "equity" / "usa" / "factor_files" / f"{symbol}.csv").is_file()
    assert (fixture / "alternative" / "interest-rate" / "usa" / "interest-rate.csv").is_file()


def test_tracked_daily_fixture_matches_lean_contract_and_exchange_calendar() -> None:
    fixture = Path(__file__).parent / "fixtures" / "lean-data" / "equity" / "usa"
    expected_dates = _trading_dates_2024()
    assert len(expected_dates) == 252
    assert expected_dates[0].isoformat() == "2024-01-02"
    assert not US_EQUITY_HOLIDAYS_2024.intersection(expected_dates)

    row_pattern = re.compile(r"^(\d{8}) 00:00,(\d+),(\d+),(\d+),(\d+),(\d+)$")
    for symbol in SYMBOLS:
        with ZipFile(fixture / "daily" / f"{symbol}.zip") as archive:
            rows = archive.read(f"{symbol}.csv").decode("utf-8").splitlines()
        matches = [row_pattern.fullmatch(row) for row in rows]
        assert all(match is not None for match in matches)
        observed_dates = tuple(
            datetime.strptime(match.group(1), "%Y%m%d").date()
            for match in matches
            if match is not None
        )
        assert observed_dates == expected_dates
        assert all(day.weekday() < 5 for day in observed_dates)

        assert (fixture / "map_files" / f"{symbol}.csv").read_text().splitlines() == [
            f"19980102,{symbol}",
            f"20501231,{symbol}",
        ]
        assert (
            fixture / "factor_files" / f"{symbol}.csv"
        ).read_text().splitlines() == [
            "19980102,1,1,1",
            "20501231,1,1,0",
        ]


def test_golden_daily_fixture_is_reproducibly_generated(tmp_path: Path) -> None:
    first = tmp_path / "first"
    second = tmp_path / "second"
    generator = Path(__file__).parents[1] / "scripts" / "generate_golden_lean_fixture.py"
    for output in (first, second):
        subprocess.run(
            [sys.executable, str(generator), "--output", str(output)],
            check=True,
        )

    tracked = Path(__file__).parent / "fixtures" / "lean-data"
    for symbol in SYMBOLS:
        relative_paths = (
            Path("equity/usa/daily") / f"{symbol}.zip",
            Path("equity/usa/map_files") / f"{symbol}.csv",
            Path("equity/usa/factor_files") / f"{symbol}.csv",
        )
        for relative_path in relative_paths:
            assert (first / relative_path).read_bytes() == (second / relative_path).read_bytes()
            assert (first / relative_path).read_bytes() == (tracked / relative_path).read_bytes()


def _target_line(event_identity: str) -> str:
    strategy = golden_portfolio_strategy()
    selection = lower_to_lean_plan(strategy).random_selections[0]
    seed = deterministic_random_seed(
        strategy,
        selection.component_id,
        event_identity=event_identity,
    )
    selected = select_symbols(
        list(selection.symbols),
        RandomNSelection(count=selection.count, resample=selection.resample),
        seed=seed,
    )
    weights = {
        **{symbol: Decimal("0.35") for symbol in selected},
        "IEF": Decimal("0.15"),
        "TLT": Decimal("0.15"),
    }
    weight_text = ",".join(f"{symbol}={weights[symbol]}" for symbol in sorted(weights))
    return (
        f"DEBUG:: RULETRADE_TARGETS|{event_identity}"
        f"|selected={','.join(selected)}|weights={weight_text}"
    )


def test_strict_e2e_validation_includes_v0_monthly_differential() -> None:
    log = "\n".join(
        [
            *(_target_line(event) for event in EVENTS),
            INTEREST_RATE_WARNING,
            "Algorithm Id:(RuleTradeGeneratedAlgorithm) completed in 1.0 seconds",
        ]
    )
    result = {"statistics": {"Total Orders": "46", "Net Profit": "36.652%"}}

    validation = validate_golden_e2e(log, result)

    assert validation.monthly_events == 12
    assert validation.total_orders == 46
    assert validation.interest_rate_fixture_warning is True


def test_e2e_validation_rejects_price_readiness_error() -> None:
    log = "\n".join(_target_line(event) for event in EVENTS)
    log += "\nThe security does not have an accurate price as it has not yet received a bar of data."
    log += "\nAlgorithm Id:(RuleTradeGeneratedAlgorithm) completed in 1.0 seconds"

    with pytest.raises(ValueError, match="fatal LEAN execution error"):
        validate_golden_e2e(log, {"statistics": {"Total Orders": "46"}})


def test_e2e_validation_rejects_any_lean_error_line() -> None:
    log = "\n".join(_target_line(event) for event in EVENTS)
    log += "\nERROR:: unexpected infrastructure failure"
    log += "\nAlgorithm Id:(RuleTradeGeneratedAlgorithm) completed in 1.0 seconds"

    with pytest.raises(ValueError, match="fatal LEAN execution error"):
        validate_golden_e2e(log, {"statistics": {"Total Orders": "46"}})


def test_e2e_validation_rejects_zero_orders(tmp_path) -> None:
    log = "\n".join(_target_line(event) for event in EVENTS)
    log += "\nAlgorithm Id:(RuleTradeGeneratedAlgorithm) completed in 1.0 seconds"
    result_file = tmp_path / "result.json"
    result_file.write_text(json.dumps({"statistics": {"Total Orders": "0"}}))

    with pytest.raises(ValueError, match="submitted no orders"):
        validate_golden_e2e(log, json.loads(result_file.read_text()))
