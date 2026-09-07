from __future__ import annotations

from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from ruletrade.domain import RebalanceFrequency, SimpleStrategySpec


class BtStep(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str
    parameters: dict[str, Any]


class BtCompilationPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    backend: Literal["bt"] = "bt"
    schedule: Literal["initial_only", "initial_then_monthly"]
    initial_capital: Decimal
    recurring_amount: Decimal
    weights: dict[str, Decimal]
    steps: list[BtStep]


def build_bt_plan(spec: SimpleStrategySpec) -> BtCompilationPlan:
    recurring_amount = (
        Decimal("0") if spec.recurring_contribution is None else spec.recurring_contribution.amount
    )
    schedule = (
        "initial_only"
        if spec.rebalance == RebalanceFrequency.ONCE
        else "initial_then_monthly"
    )
    steps = [
        BtStep(
            name="RuleTradeSchedule",
            parameters={
                "mode": schedule,
                "recurring_amount": str(recurring_amount),
                "contribution_starts": "first_trading_day_of_next_month",
            },
        ),
        BtStep(name="SelectAll", parameters={}),
        BtStep(
            name="WeighSpecified",
            parameters={asset.symbol: str(asset.weight) for asset in spec.assets},
        ),
        BtStep(name="Rebalance", parameters={}),
    ]
    return BtCompilationPlan(
        schedule=schedule,
        initial_capital=spec.initial_capital,
        recurring_amount=recurring_amount,
        weights={asset.symbol: asset.weight for asset in spec.assets},
        steps=steps,
    )
