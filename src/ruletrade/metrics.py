from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date
from typing import Iterable

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class CashFlow:
    flow_date: date
    amount: float


def max_drawdown(normalized_prices: pd.Series) -> float:
    series = normalized_prices.dropna().astype(float)
    if series.empty:
        return float("nan")
    running_max = series.cummax()
    drawdown = series / running_max - 1.0
    return float(drawdown.min())


def annualized_sharpe(normalized_prices: pd.Series, periods_per_year: int = 252) -> float | None:
    returns = normalized_prices.dropna().astype(float).pct_change().dropna()
    if len(returns) < 2:
        return None
    std = float(returns.std(ddof=1))
    if std == 0 or not math.isfinite(std):
        return None
    value = float(returns.mean()) / std * math.sqrt(periods_per_year)
    return value if math.isfinite(value) else None


def xnpv(rate: float, cashflows: Iterable[CashFlow]) -> float:
    flows = list(cashflows)
    if not flows:
        raise ValueError("cashflows cannot be empty")
    if rate <= -1:
        return math.inf
    origin = min(flow.flow_date for flow in flows)
    return sum(
        flow.amount / ((1.0 + rate) ** ((flow.flow_date - origin).days / 365.0))
        for flow in flows
    )


def xirr(cashflows: Iterable[CashFlow]) -> float | None:
    flows = list(cashflows)
    if not flows or not any(flow.amount < 0 for flow in flows) or not any(flow.amount > 0 for flow in flows):
        return None

    low = -0.999999
    high = 1.0
    f_low = xnpv(low, flows)
    f_high = xnpv(high, flows)

    for _ in range(20):
        if f_low == 0:
            return low
        if f_high == 0:
            return high
        if f_low * f_high < 0:
            break
        high *= 2.0
        f_high = xnpv(high, flows)
    else:
        return None

    for _ in range(200):
        mid = (low + high) / 2.0
        f_mid = xnpv(mid, flows)
        if abs(f_mid) < 1e-8:
            return mid
        if f_low * f_mid <= 0:
            high = mid
            f_high = f_mid
        else:
            low = mid
            f_low = f_mid

    return (low + high) / 2.0


def normalized_metrics(
    normalized_prices: pd.Series,
    portfolio_values: pd.Series,
    initial_capital: float,
    recurring_cashflows: list[CashFlow],
) -> dict[str, float | int | None]:
    prices = normalized_prices.dropna().astype(float)
    values = portfolio_values.dropna().astype(float)
    if prices.empty or values.empty:
        raise ValueError("empty result series")

    total_return = float(prices.iloc[-1] / prices.iloc[0] - 1.0)
    years = max((prices.index[-1] - prices.index[0]).days / 365.25, 1.0 / 365.25)
    cagr = float((prices.iloc[-1] / prices.iloc[0]) ** (1.0 / years) - 1.0)
    net_contributions = initial_capital + sum(flow.amount for flow in recurring_cashflows)
    final_value = float(values.iloc[-1])

    irr_flows = [CashFlow(prices.index[0].date(), -initial_capital)]
    irr_flows.extend(CashFlow(flow.flow_date, -flow.amount) for flow in recurring_cashflows)
    irr_flows.append(CashFlow(prices.index[-1].date(), final_value))

    return {
        "final_value": final_value,
        "net_contributions": float(net_contributions),
        "investment_profit": float(final_value - net_contributions),
        "twr": total_return,
        "cagr": cagr,
        "max_drawdown": max_drawdown(prices),
        "sharpe": annualized_sharpe(prices),
        "xirr": xirr(irr_flows),
        "observation_count": int(len(prices)),
    }
