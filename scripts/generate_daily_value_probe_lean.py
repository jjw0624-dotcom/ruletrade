from __future__ import annotations

import argparse
from pathlib import Path

from ruletrade.strategy.v2.daily_probe import lower_adjusted_close_probe
from ruletrade.strategy.v2.daily_values import DailyValueNode, MarketField, PriceBasis, SubjectKind


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the v2 adjusted-close LEAN probe")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("build/lean/daily-value-probe/Main.cs"),
    )
    args = parser.parse_args()
    source = lower_adjusted_close_probe(
        DailyValueNode(
            semantic_id="ci-adjusted-close-qqq",
            kind="observe",
            subject_kind=SubjectKind.ASSET,
            subject_id="QQQ",
            field=MarketField.CLOSE,
            basis=PriceBasis.ADJUSTED,
        )
    )
    if "RULETRADE_DAILY_VALUE" not in source:
        raise RuntimeError("daily value probe did not preserve the structured observation protocol")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(source, encoding="utf-8")


if __name__ == "__main__":
    main()
