from __future__ import annotations

import importlib
import importlib.metadata
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import numpy as np
import pandas as pd

from ruletrade.compile_plan import build_bt_plan
from ruletrade.domain import BacktestConfig, SimpleStrategySpec
from ruletrade.metrics import CashFlow, normalized_metrics


class BackendUnavailableError(RuntimeError):
    pass


@dataclass(frozen=True)
class BtBackendStatus:
    available: bool
    version: str | None
    detail: str


def backend_status() -> BtBackendStatus:
    try:
        importlib.import_module("bt")
        version = importlib.metadata.version("bt")
    except (ModuleNotFoundError, importlib.metadata.PackageNotFoundError):
        return BtBackendStatus(
            available=False,
            version=None,
            detail="Install the bt extra: pip install -e '.[bt]'",
        )
    return BtBackendStatus(available=True, version=version, detail="ready")


def _load_bt() -> Any:
    try:
        return importlib.import_module("bt")
    except ModuleNotFoundError as exc:
        raise BackendUnavailableError("bt is not installed; install the project with the bt extra") from exc


def _schedule_algo(bt: Any, recurring_amount: float, monthly: bool) -> Any:
    class RuleTradeSchedule(bt.core.Algo):
        def __init__(self) -> None:
            super().__init__()

        def __call__(self, target: Any) -> bool:
            if target.now is None or target.now not in target.data.index:
                return False
            index = target.data.index.get_loc(target.now)
            if not isinstance(index, (int, np.integer)) or index == 0:
                return False
            if index == 1:
                return True
            if not monthly:
                return False

            now = pd.Timestamp(target.now)
            previous = pd.Timestamp(target.data.index[index - 1])
            is_new_month = now.year != previous.year or now.month != previous.month
            if not is_new_month:
                return False

            if recurring_amount > 0:
                target.adjust(recurring_amount)
                target.perm.setdefault("ruletrade_cashflows", []).append(
                    {"date": now.date().isoformat(), "amount": recurring_amount}
                )
            return True

    return RuleTradeSchedule()


def _commission_model(config: BacktestConfig):
    bps = float(config.commission_bps)
    if bps == 0:
        return None

    def commission(quantity: float, price: float) -> float:
        return abs(quantity) * price * bps / 10_000.0

    return commission


def _records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    if frame.empty:
        return []
    reset = frame.reset_index()
    return [
        {
            key: (value.isoformat() if isinstance(value, (pd.Timestamp, pd.Timedelta)) else value)
            for key, value in row.items()
        }
        for row in reset.to_dict(orient="records")
    ]


def run_backtest(
    spec: SimpleStrategySpec,
    prices: pd.DataFrame,
    config: BacktestConfig,
) -> dict[str, Any]:
    bt = _load_bt()
    plan = build_bt_plan(spec)
    monthly = plan.schedule == "initial_then_monthly"
    recurring_amount = float(plan.recurring_amount)

    algos = [
        _schedule_algo(bt, recurring_amount=recurring_amount, monthly=monthly),
        bt.algos.SelectAll(),
        bt.algos.WeighSpecified(**{symbol: float(weight) for symbol, weight in plan.weights.items()}),
        bt.algos.Rebalance(),
    ]
    strategy = bt.Strategy(spec.name, algos)
    backtest = bt.Backtest(
        strategy,
        prices,
        initial_capital=float(spec.initial_capital),
        commissions=_commission_model(config),
        integer_positions=not config.allow_fractional_shares,
        progress_bar=False,
    )
    result = bt.run(backtest, progress_bar=False)

    tested = result.backtests[spec.name]
    # bt prepends a synthetic t0-1 row. Public RuleTrade results only expose
    # dates from the supplied dataset, so cash-flow dates and metrics stay intuitive.
    normalized_prices = tested.strategy.prices.reindex(prices.index).dropna()
    portfolio_values = tested.strategy.values.reindex(prices.index).dropna()
    raw_flows = tested.strategy.perm.get("ruletrade_cashflows", [])
    cashflows = [
        CashFlow(pd.Timestamp(item["date"]).date(), float(item["amount"]))
        for item in raw_flows
    ]

    transactions = result.get_transactions(spec.name)
    transaction_records = _records(transactions) if transactions is not None else []
    weights = tested.security_weights.fillna(0.0)

    return {
        "backend": "bt",
        "backend_version": importlib.metadata.version("bt"),
        "metrics": normalized_metrics(
            normalized_prices=normalized_prices,
            portfolio_values=portfolio_values,
            initial_capital=float(spec.initial_capital),
            recurring_cashflows=cashflows,
        ),
        "cashflows": [
            {"date": flow.flow_date.isoformat(), "amount": flow.amount} for flow in cashflows
        ],
        "equity": [
            {"date": pd.Timestamp(index).date().isoformat(), "value": float(value)}
            for index, value in portfolio_values.items()
        ],
        "normalized_price": [
            {"date": pd.Timestamp(index).date().isoformat(), "value": float(value)}
            for index, value in normalized_prices.items()
        ],
        "weights": _records(weights),
        "transactions": transaction_records,
        "warnings": [
            "MVP uses adjusted close-style input and fractional shares by default.",
            "MVP recurring contribution starts on the first trading day of the month after the dataset begins.",
        ],
    }
