from __future__ import annotations

import argparse
import math
from datetime import date, timedelta
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

SYMBOLS = {
    "qqq": (4_000_000, 1_800),
    "vgt": (5_000_000, 1_950),
    "soxx": (5_500_000, 2_100),
    "schg": (800_000, 2_250),
    "tlt": (950_000, 2_400),
    "ief": (920_000, 2_550),
}
FILTER_PHASES = {"qqq": 0, "vgt": 30, "soxx": 60, "schg": 90}
FILTER_FIXTURE_SYMBOLS = (*FILTER_PHASES, "tlt", "ief")

# Full-day NASDAQ closures in the fixture period. Early closes remain
# trading days because a Daily TradeBar still exists for them.
US_EQUITY_HOLIDAYS = frozenset(
    {
        date(2023, 1, 2),
        date(2023, 1, 16),
        date(2023, 2, 20),
        date(2023, 4, 7),
        date(2023, 5, 29),
        date(2023, 6, 19),
        date(2023, 7, 4),
        date(2023, 9, 4),
        date(2023, 11, 23),
        date(2023, 12, 25),
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

MAP_START = date(1998, 1, 2)
LEAN_END_OF_TIME = date(2050, 12, 31)
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def trading_dates() -> tuple[date, ...]:
    current = date(2023, 1, 1)
    end = date(2024, 12, 31)
    result: list[date] = []
    while current <= end:
        if current.weekday() < 5 and current not in US_EQUITY_HOLIDAYS:
            result.append(current)
        current += timedelta(days=1)
    return tuple(result)


def daily_rows(symbol: str) -> str:
    initial_close, daily_step = SYMBOLS[symbol]
    rows = []
    dates = trading_dates()
    backtest_start_index = dates.index(date(2024, 1, 2))
    for index, trading_date in enumerate(dates):
        # Preserve the proven 2024 prices while supplying pre-start history.
        close = initial_close + daily_step * (index - backtest_start_index)
        rows.append(
            f"{trading_date:%Y%m%d} 00:00,"
            f"{close - 2_500},{close + 5_000},{close - 7_500},{close},"
            f"{1_000_000 + 1_000 * index}"
        )
    return "\n".join(rows) + "\n"


def filter_daily_rows(symbol: str) -> str:
    """Generate deterministic cycles that exercise positive-return screening."""

    if symbol not in FILTER_PHASES:
        # Defensive/fallback assets are subscribed but not scored. Give them
        # aligned deterministic Daily bars without adding a momentum phase.
        return daily_rows(symbol)
    phase = FILTER_PHASES[symbol]
    rows = []
    for index, trading_date in enumerate(trading_dates()):
        close = 4_000_000 + int(
            800_000 * math.sin(2 * math.pi * (index + phase) / 252)
        )
        rows.append(
            f"{trading_date:%Y%m%d} 00:00,"
            f"{close - 2_500},{close + 5_000},{close - 7_500},{close},"
            f"{1_000_000 + 1_000 * index}"
        )
    return "\n".join(rows) + "\n"


def _write_deterministic_zip(path: Path, entry_name: str, contents: str) -> None:
    info = ZipInfo(entry_name, date_time=ZIP_TIMESTAMP)
    info.compress_type = ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    with ZipFile(path, "w") as archive:
        archive.writestr(info, contents.encode("utf-8"))


def generate_fixture(output: Path, *, profile: str = "golden") -> None:
    daily = output / "equity" / "usa" / "daily"
    map_files = output / "equity" / "usa" / "map_files"
    factor_files = output / "equity" / "usa" / "factor_files"
    daily.mkdir(parents=True, exist_ok=True)
    map_files.mkdir(parents=True, exist_ok=True)
    factor_files.mkdir(parents=True, exist_ok=True)

    symbols = FILTER_FIXTURE_SYMBOLS if profile == "filter" else SYMBOLS
    row_factory = filter_daily_rows if profile == "filter" else daily_rows
    for symbol in symbols:
        _write_deterministic_zip(
            daily / f"{symbol}.zip",
            f"{symbol}.csv",
            row_factory(symbol),
        )
        (map_files / f"{symbol}.csv").write_text(
            f"{MAP_START:%Y%m%d},{symbol}\n{LEAN_END_OF_TIME:%Y%m%d},{symbol}\n",
            encoding="utf-8",
        )
        (factor_files / f"{symbol}.csv").write_text(
            f"{MAP_START:%Y%m%d},1,1,1\n{LEAN_END_OF_TIME:%Y%m%d},1,1,0\n",
            encoding="utf-8",
        )
    interest_rates = output / "alternative" / "interest-rate" / "usa"
    interest_rates.mkdir(parents=True, exist_ok=True)
    (interest_rates / "interest-rate.csv").write_text(
        "date,interest-rate\n1998-01-01,1.0\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate deterministic Golden LEAN data")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("tests/fixtures/lean-data"),
    )
    parser.add_argument("--profile", choices=("golden", "filter"), default="golden")
    args = parser.parse_args()
    generate_fixture(args.output, profile=args.profile)


if __name__ == "__main__":
    main()
