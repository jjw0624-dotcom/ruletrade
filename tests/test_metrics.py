from datetime import date

import pandas as pd

from ruletrade.metrics import CashFlow, max_drawdown, xirr


def test_max_drawdown() -> None:
    series = pd.Series([100.0, 120.0, 90.0, 110.0])
    assert max_drawdown(series) == -0.25


def test_xirr_one_year_double() -> None:
    value = xirr([CashFlow(date(2024, 1, 1), -100.0), CashFlow(date(2025, 1, 1), 200.0)])
    assert value is not None
    assert abs(value - 1.0) < 0.01
