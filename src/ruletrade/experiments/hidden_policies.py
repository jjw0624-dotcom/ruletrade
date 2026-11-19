from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class HiddenDatasetWindow(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    start_date: date
    end_date: date


class HiddenDatasetPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    name: str
    description: str
    calibration: HiddenDatasetWindow
    evaluation: HiddenDatasetWindow
    dataset_id: str
    initial_cash: Decimal


_POLICIES = (
    HiddenDatasetPolicy(
        id="synthetic-holdout-v1",
        name="Synthetic chronological holdout",
        description=(
            "Calibrate on the first half of 2024, then evaluate the unchanged "
            "Revision on the server-owned second-half holdout."
        ),
        calibration=HiddenDatasetWindow(start_date=date(2024, 1, 2), end_date=date(2024, 6, 28)),
        evaluation=HiddenDatasetWindow(start_date=date(2024, 7, 1), end_date=date(2024, 12, 31)),
        dataset_id="filter-synthetic",
        initial_cash=Decimal("100000"),
    ),
)


def hidden_dataset_policies() -> tuple[HiddenDatasetPolicy, ...]:
    return _POLICIES


def hidden_dataset_policy(policy_id: str) -> HiddenDatasetPolicy | None:
    return next((item for item in _POLICIES if item.id == policy_id), None)
