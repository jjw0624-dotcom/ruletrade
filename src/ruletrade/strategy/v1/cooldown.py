from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Mapping, Sequence


@dataclass(frozen=True)
class CooldownEligibility:
    asset: str
    last_exit: str | None
    elapsed_trading_days: int | None
    decision: str


@dataclass(frozen=True)
class CooldownEvent:
    event: str
    session_index: int
    candidates: tuple[str, ...]
    eligibility: tuple[CooldownEligibility, ...]
    selected: tuple[str, ...]
    targets: tuple[tuple[str, Decimal], ...]
    exits: tuple[str, ...]


def evaluate_cooldown(
    trading_sessions: Sequence[str],
    candidates_by_event: Mapping[str, Sequence[str]],
    *,
    required_completed_sessions: int = 20,
) -> tuple[CooldownEvent, ...]:
    """Apply cooldown to signal candidates, then observe executed target exits."""

    last_exit: dict[str, tuple[int, str]] = {}
    previous_targets: set[str] = set()
    events: list[CooldownEvent] = []
    for session_index, event in enumerate(trading_sessions):
        candidates = tuple(candidates_by_event.get(event, ()))
        eligibility: list[CooldownEligibility] = []
        selected: list[str] = []
        for asset in candidates:
            prior = last_exit.get(asset)
            elapsed = None if prior is None else session_index - prior[0]
            allowed = elapsed is None or elapsed >= required_completed_sessions
            eligibility.append(
                CooldownEligibility(
                    asset=asset,
                    last_exit=None if prior is None else prior[1],
                    elapsed_trading_days=elapsed,
                    decision="eligible" if allowed else "blocked",
                )
            )
            if allowed:
                selected.append(asset)

        target_weight = Decimal(1) / len(selected) if selected else Decimal(0)
        targets = tuple((asset, target_weight) for asset in sorted(selected))
        current_targets = set(selected)
        exits = tuple(sorted(previous_targets - current_targets))
        for asset in exits:
            last_exit[asset] = (session_index, event)
        events.append(
            CooldownEvent(
                event=event,
                session_index=session_index,
                candidates=candidates,
                eligibility=tuple(eligibility),
                selected=tuple(selected),
                targets=targets,
                exits=exits,
            )
        )
        previous_targets = current_targets
    return tuple(events)
