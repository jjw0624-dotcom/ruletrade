from __future__ import annotations

import argparse

from ruletrade.market_data.service import MarketDataService


def _yes(value: bool) -> str:
    return "yes" if value else "no"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Inspect structural completeness of local LEAN US Equity daily data."
    )
    parser.add_argument("symbols", nargs="+", help="Ticker symbols to inspect.")
    args = parser.parse_args()

    inspection = MarketDataService().inspect_local_cache(args.symbols)
    print("SYMBOL  DAILY  MAP  FACTOR  COVERAGE                 STATUS")
    for item in inspection.symbols:
        coverage = (
            f"{item.available_from}..{item.available_to}"
            if item.available_from and item.available_to
            else "-"
        )
        print(
            f"{item.symbol:<7} {_yes(item.daily_present):<6} "
            f"{_yes(item.map_present):<4} {_yes(item.factor_present):<7} "
            f"{coverage:<24} {item.reason}"
        )


if __name__ == "__main__":
    main()
