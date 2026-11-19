from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class RobustnessPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    name: str
    description: str
    start_date_offsets: tuple[int, ...]


_POLICIES = (
    RobustnessPolicy(
        id="start-date-offset-v1",
        name="Start-date sensitivity",
        description=(
            "Run the unchanged Revision with 0, 1, 3, and 5 calendar-day start offsets "
            "to measure dependence on the initial observation and entry window."
        ),
        start_date_offsets=(0, 1, 3, 5),
    ),
)


def robustness_policies() -> tuple[RobustnessPolicy, ...]:
    return _POLICIES


def robustness_policy(policy_id: str) -> RobustnessPolicy | None:
    return next((item for item in _POLICIES if item.id == policy_id), None)
