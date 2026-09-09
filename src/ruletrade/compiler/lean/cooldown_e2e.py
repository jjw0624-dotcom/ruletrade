from __future__ import annotations

import re
from datetime import date
from decimal import Decimal
from pathlib import Path
from zipfile import ZipFile

from ruletrade.backtests.normalization import normalize_lean_result
from ruletrade.compiler.lean.e2e import COMPLETION_PATTERN, FATAL_PATTERNS, parse_target_records
from ruletrade.compiler.lean.fallback_e2e import FAILED_DATA_REQUESTS_PATTERN
from ruletrade.strategy.v1.cooldown import evaluate_cooldown

SIGNAL_PATTERN = re.compile(
    r"RULETRADE_SIGNAL\|(?P<event>\d{4}-\d{2}-\d{2})"
    r"\|scores=(?P<scores>[A-Z0-9.,_=:+-]+)"
    r"\|ranked=(?P<ranked>[A-Z0-9,]+)"
    r"\|candidate=(?P<candidate>[A-Z0-9,]+)"
)
COOLDOWN_PATTERN = re.compile(
    r"RULETRADE_COOLDOWN\|(?P<event>\d{4}-\d{2}-\d{2})"
    r"\|component=(?P<component>[A-Za-z0-9_-]+)"
    r"\|asset=(?P<asset>[A-Z0-9]+)\|candidate=true"
    r"\|last_exit=(?P<last_exit>none|\d{4}-\d{2}-\d{2})"
    r"\|elapsed_trading_days=(?P<elapsed>none|\d+)"
    r"\|required=(?P<required>\d+)"
    r"\|decision=(?P<decision>blocked|eligible)"
)
STATE_PATTERN = re.compile(
    r"RULETRADE_STATE\|(?P<event>\d{4}-\d{2}-\d{2})"
    r"\|component=(?P<component>[A-Za-z0-9_-]+)"
    r"\|asset=(?P<asset>[A-Z0-9]+)\|state=last_exit"
    r"\|old=(?P<old>none|\d{4}-\d{2}-\d{2})"
    r"\|new=(?P<new>\d{4}-\d{2}-\d{2})\|cause=target_exit"
)
SCORE_TOLERANCE = Decimal("1e-24")


def load_cooldown_fixture(fixture: Path) -> tuple[list[str], dict[str, list[Decimal]]]:
    dates: list[str] = []
    closes: dict[str, list[Decimal]] = {}
    for symbol in ("QQQ", "IEF"):
        lower = symbol.lower()
        with ZipFile(fixture / "equity" / "usa" / "daily" / f"{lower}.zip") as archive:
            rows = [row.split(",") for row in archive.read(f"{lower}.csv").decode().splitlines()]
        observed = [row[0][:8] for row in rows]
        if dates and observed != dates:
            raise ValueError("Cooldown fixture assets must have aligned Daily bars")
        dates = observed
        closes[symbol] = [Decimal(row[4]) for row in rows]
    return dates, closes


def verify_cooldown_e2e(
    log_text: str,
    result_payload: object,
    fixture: Path,
) -> tuple[int, int, str]:
    lowered = log_text.lower()
    fatal = next((pattern for pattern in FATAL_PATTERNS if pattern in lowered), None)
    if fatal or COMPLETION_PATTERN.search(log_text) is None:
        raise ValueError(f"LEAN did not complete cleanly: {fatal or 'completion marker missing'}")
    failed = FAILED_DATA_REQUESTS_PATTERN.search(log_text)
    if failed is None or int(failed.group("count")) != 0:
        raise ValueError("LEAN must report zero failed data requests")

    all_dates, closes = load_cooldown_fixture(fixture)
    event_dates = [
        value
        for value in all_dates
        if date(2024, 1, 2) <= date.fromisoformat(f"{value[:4]}-{value[4:6]}-{value[6:]}") <= date(2024, 2, 29)
    ]
    candidates: dict[str, tuple[str, ...]] = {}
    expected_scores: dict[str, dict[str, Decimal]] = {}
    for compact in event_dates:
        index = all_dates.index(compact)
        scores = {
            symbol: values[index] / values[index - 1] - Decimal(1)
            for symbol, values in closes.items()
        }
        event = f"{compact[:4]}-{compact[4:6]}-{compact[6:]}"
        expected_scores[event] = scores
        candidates[event] = (min(scores, key=lambda symbol: (-scores[symbol], symbol)),)
    sessions = tuple(sorted(candidates))
    reference = evaluate_cooldown(sessions, candidates)
    signals = {item.group("event"): item for item in SIGNAL_PATTERN.finditer(log_text)}
    cooldowns = {
        (item.group("event"), item.group("asset")): item
        for item in COOLDOWN_PATTERN.finditer(log_text)
    }
    states = {
        (item.group("event"), item.group("asset")): item
        for item in STATE_PATTERN.finditer(log_text)
    }
    targets = {item.event_identity: item for item in parse_target_records(log_text)}
    if not (len(signals) == len(cooldowns) == len(targets) == len(reference)):
        raise ValueError("expected one signal, cooldown decision, and target record per session")

    for expected in reference:
        signal = signals[expected.event]
        actual_scores = {
            symbol: Decimal(value)
            for symbol, value in (
                item.split("=", 1) for item in signal.group("scores").split(",")
            )
        }
        if actual_scores.keys() != expected_scores[expected.event].keys() or any(
            abs(actual_scores[symbol] - value) > SCORE_TOLERANCE
            for symbol, value in expected_scores[expected.event].items()
        ):
            raise ValueError(f"score mismatch for {expected.event}")
        ranked = tuple(signal.group("ranked").split(","))
        expected_ranked = tuple(
            sorted(
                expected_scores[expected.event],
                key=lambda symbol: (-expected_scores[expected.event][symbol], symbol),
            )
        )
        if ranked != expected_ranked or tuple(signal.group("candidate").split(",")) != expected.candidates:
            raise ValueError(f"signal ordering mismatch for {expected.event}")
        eligibility = expected.eligibility[0]
        cooldown = cooldowns[(expected.event, eligibility.asset)]
        expected_last_exit = eligibility.last_exit or "none"
        expected_elapsed = (
            "none" if eligibility.elapsed_trading_days is None else str(eligibility.elapsed_trading_days)
        )
        if (
            cooldown.group("component") != "cooldown"
            or cooldown.group("last_exit") != expected_last_exit
            or cooldown.group("elapsed") != expected_elapsed
            or cooldown.group("required") != "20"
            or cooldown.group("decision") != eligibility.decision
        ):
            raise ValueError(f"cooldown decision mismatch for {expected.event}")
        target = targets[expected.event]
        if target.selected != expected.selected or target.weights != dict(expected.targets):
            raise ValueError(f"target mismatch for {expected.event}")
        for asset in expected.exits:
            state = states.get((expected.event, asset))
            if state is None or state.group("new") != expected.event:
                raise ValueError(f"last-exit state mismatch for {expected.event} {asset}")

    expected_state_updates = sum(len(item.exits) for item in reference)
    if len(states) != expected_state_updates:
        raise ValueError("unexpected last-exit state mutation")
    normalized = normalize_lean_result(result_payload)
    if normalized.total_orders <= 0:
        raise ValueError("cooldown backtest submitted no orders")
    reentry = next(
        item.event
        for item in reference
        if item.eligibility[0].elapsed_trading_days == 20
        and item.eligibility[0].decision == "eligible"
    )
    return len(reference), normalized.total_orders, reentry
