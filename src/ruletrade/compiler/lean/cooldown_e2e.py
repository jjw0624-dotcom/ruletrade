from __future__ import annotations

import re
from datetime import date
from decimal import Decimal
from pathlib import Path

from ruletrade.backtests.normalization import normalize_lean_result
from ruletrade.compiler.lean.e2e import (
    division_derived_scores_match,
    load_aligned_daily_closes,
    parse_decimal_map,
    parse_target_records,
    validate_lean_completion,
    validate_zero_failed_data_requests,
)
from ruletrade.compiler.lean.evidence_e2e import (
    index_decision_evidence,
    one_evidence,
    verify_v2_selection_facts,
)
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


def load_cooldown_fixture(fixture: Path) -> tuple[list[str], dict[str, list[Decimal]]]:
    return load_aligned_daily_closes(
        fixture,
        ("QQQ", "IEF"),
        fixture_name="Cooldown",
    )


def verify_cooldown_e2e(
    log_text: str,
    result_payload: object,
    fixture: Path,
) -> tuple[int, int, str]:
    validate_lean_completion(log_text)
    validate_zero_failed_data_requests(log_text)

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
    evidence = index_decision_evidence(log_text)
    if not (len(signals) == len(cooldowns) == len(targets) == len(reference)):
        raise ValueError("expected one signal, cooldown decision, and target record per session")

    for expected in reference:
        signal = signals[expected.event]
        actual_scores = parse_decimal_map(signal.group("scores"))
        if not division_derived_scores_match(
            actual_scores,
            expected_scores[expected.event],
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
        if evidence:
            selection_event = one_evidence(evidence, expected.event, "selection")
            verify_v2_selection_facts(
                selection_event,
                ranked=expected_ranked,
                candidates=expected.candidates,
                primary_selected=(),
                required_count=1,
            )
            cooldown_event = one_evidence(evidence, expected.event, "cooldown")
            structured = cooldown_event.evidence
            if (
                structured.asset != eligibility.asset
                or structured.signal_candidate is not True
                or (
                    None
                    if structured.last_exit is None
                    else structured.last_exit.isoformat()
                )
                != eligibility.last_exit
                or structured.elapsed_completed_sessions
                != eligibility.elapsed_trading_days
                or structured.required_completed_sessions != 20
                or structured.eligible != (eligibility.decision == "eligible")
                or structured.stopping_stage
                != (None if eligibility.decision == "eligible" else "cooldown")
            ):
                raise ValueError(
                    f"structured cooldown evidence mismatch for {expected.event}"
                )
            source = next(
                item
                for item in cooldown_event.source_components
                if item.role == "cooldown"
            )
            if source.field_path != "config.duration":
                raise ValueError(
                    f"structured cooldown field-path mismatch for {expected.event}"
                )
        target = targets[expected.event]
        if target.selected != expected.selected or target.weights != dict(expected.targets):
            raise ValueError(f"target mismatch for {expected.event}")
        for asset in expected.exits:
            state = states.get((expected.event, asset))
            if state is None or state.group("new") != expected.event:
                raise ValueError(f"last-exit state mismatch for {expected.event} {asset}")
            if evidence:
                mutations = evidence.get((expected.event, "state_mutation"), ())
                if not any(
                    item.evidence.asset == asset
                    and item.evidence.new_value.isoformat() == expected.event
                    for item in mutations
                ):
                    raise ValueError(
                        f"structured state evidence mismatch for {expected.event} {asset}"
                    )

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
