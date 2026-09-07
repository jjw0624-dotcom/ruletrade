from __future__ import annotations

import argparse
import json
from pathlib import Path

import yaml

from ruletrade.compile_plan import build_bt_plan
from ruletrade.datasets import DatasetRegistry
from ruletrade.domain import BacktestConfig, SimpleStrategySpec
from ruletrade.engines.bt_backend import run_backtest
from ruletrade.hashing import strategy_hash


def load_strategy(path: Path) -> SimpleStrategySpec:
    with path.open("r", encoding="utf-8") as handle:
        payload = yaml.safe_load(handle)
    return SimpleStrategySpec.model_validate(payload)


def command_validate(args: argparse.Namespace) -> int:
    spec = load_strategy(Path(args.strategy))
    output = {
        "valid": True,
        "strategy_hash": strategy_hash(spec),
        "bt_plan": build_bt_plan(spec).model_dump(mode="json"),
    }
    print(json.dumps(output, indent=2, ensure_ascii=False))
    return 0


def command_backtest(args: argparse.Namespace) -> int:
    spec = load_strategy(Path(args.strategy))
    registry = DatasetRegistry(Path(args.data_dir))
    prices = registry.load_prices(args.dataset, [asset.symbol for asset in spec.assets])
    result = run_backtest(
        spec,
        prices,
        BacktestConfig(
            commission_bps=args.commission_bps,
            allow_fractional_shares=not args.integer_shares,
        ),
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="ruletrade")
    commands = root.add_subparsers(dest="command", required=True)

    validate = commands.add_parser("validate")
    validate.add_argument("strategy")
    validate.set_defaults(func=command_validate)

    backtest = commands.add_parser("backtest")
    backtest.add_argument("strategy")
    backtest.add_argument("--dataset", default="synthetic_prices")
    backtest.add_argument("--data-dir", default="data")
    backtest.add_argument("--commission-bps", default="0")
    backtest.add_argument("--integer-shares", action="store_true")
    backtest.set_defaults(func=command_backtest)
    return root


def main() -> None:
    args = parser().parse_args()
    raise SystemExit(args.func(args))


if __name__ == "__main__":
    main()
