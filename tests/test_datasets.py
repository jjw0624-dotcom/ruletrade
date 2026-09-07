from pathlib import Path

import pandas as pd
import pytest

from ruletrade.datasets import DatasetError, DatasetRegistry


def test_loads_valid_dataset(tmp_path: Path) -> None:
    pd.DataFrame(
        {
            "date": ["2025-01-02", "2025-01-03"],
            "QQQ": [100, 101],
            "VOO": [200, 202],
        }
    ).to_csv(tmp_path / "demo.csv", index=False)
    registry = DatasetRegistry(tmp_path)
    frame = registry.load_prices("demo", ["QQQ", "VOO"])
    assert list(frame.columns) == ["QQQ", "VOO"]
    assert len(frame) == 2


def test_rejects_missing_symbol(tmp_path: Path) -> None:
    pd.DataFrame({"date": ["2025-01-02", "2025-01-03"], "QQQ": [100, 101]}).to_csv(
        tmp_path / "demo.csv", index=False
    )
    with pytest.raises(DatasetError, match="VOO"):
        DatasetRegistry(tmp_path).load_prices("demo", ["QQQ", "VOO"])
