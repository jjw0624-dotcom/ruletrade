from pathlib import Path

import pytest

from ruletrade.datasets import DatasetRegistry
from ruletrade.domain import BacktestConfig, SimpleStrategySpec
from ruletrade.engines.bt_backend import backend_status, run_backtest


pytestmark = pytest.mark.skipif(not backend_status().available, reason="bt extra is not installed")


def test_bt_monthly_dca_end_to_end() -> None:
    root = Path(__file__).resolve().parents[1]
    spec = SimpleStrategySpec.model_validate(
        {
            "name": "integration-dca",
            "initial_capital": "10000",
            "recurring_contribution": {"amount": "500"},
            "assets": [
                {"symbol": "QQQ", "weight": "0.4"},
                {"symbol": "VOO", "weight": "0.6"},
            ],
        }
    )
    prices = DatasetRegistry(root / "data").load_prices("synthetic_prices", ["QQQ", "VOO"])
    result = run_backtest(spec, prices, BacktestConfig())
    assert result["backend"] == "bt"
    assert result["metrics"]["final_value"] > 0
    assert len(result["cashflows"]) >= 12
    assert len(result["equity"]) > 100
