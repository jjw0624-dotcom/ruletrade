from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

_DATASET_ID = re.compile(r"^[A-Za-z0-9._-]+$")


class DatasetError(ValueError):
    pass


@dataclass(frozen=True)
class DatasetInfo:
    dataset_id: str
    path: Path


class DatasetRegistry:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir.resolve()

    def list(self) -> list[DatasetInfo]:
        if not self.data_dir.exists():
            return []
        return [DatasetInfo(path.stem, path) for path in sorted(self.data_dir.glob("*.csv"))]

    def resolve(self, dataset_id: str) -> Path:
        if not _DATASET_ID.fullmatch(dataset_id):
            raise DatasetError("invalid dataset id")
        path = (self.data_dir / f"{dataset_id}.csv").resolve()
        if path.parent != self.data_dir:
            raise DatasetError("dataset path escapes data directory")
        if not path.exists():
            raise DatasetError(f"dataset not found: {dataset_id}")
        return path

    def load_prices(self, dataset_id: str, symbols: list[str]) -> pd.DataFrame:
        path = self.resolve(dataset_id)
        frame = pd.read_csv(path)
        if "date" not in frame.columns:
            raise DatasetError("dataset must have a date column")

        frame["date"] = pd.to_datetime(frame["date"], errors="raise")
        if frame["date"].duplicated().any():
            raise DatasetError("dataset contains duplicate dates")
        frame = frame.set_index("date").sort_index()
        if not frame.index.is_monotonic_increasing:
            raise DatasetError("dataset dates must be increasing")

        missing = [symbol for symbol in symbols if symbol not in frame.columns]
        if missing:
            raise DatasetError(f"dataset is missing symbols: {', '.join(missing)}")

        prices = frame[symbols].apply(pd.to_numeric, errors="coerce")
        if prices.isna().any().any():
            raise DatasetError("dataset contains missing or non-numeric prices")
        if (prices <= 0).any().any():
            raise DatasetError("all prices must be positive")
        if len(prices.index) < 2:
            raise DatasetError("dataset must contain at least two rows")
        return prices.astype(float)
