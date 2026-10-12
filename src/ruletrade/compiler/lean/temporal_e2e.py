from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from urllib.parse import unquote
from zipfile import ZipFile

from ruletrade.backtests.normalization import normalize_lean_result
from ruletrade.compiler.lean.e2e import validate_lean_completion, validate_zero_failed_data_requests
from ruletrade.strategy.v2.corpus import temporal_breakout_strategy, temporal_multiclock_strategy
from ruletrade.strategy.v2.daily_values import DailyMarketSnapshot
from ruletrade.strategy.v2.program_execution import ProgramExecutionResult, execute_program_v2
from ruletrade.strategy.v2.semantic_types import Clock


@dataclass(frozen=True)
class TemporalDifferentialResult:
    boundaries: int
    triggered_events: int
    transitions: int
    memory_captures: int
    policy_decisions: int
    order_intents: int
    actual_orders: int
    weekly_completions: int = 0


def parse_temporal_evidence(log_text: str) -> tuple[dict[str, str], ...]:
    records: list[dict[str, str]] = []
    for line in log_text.splitlines():
        marker = "RULETRADE_EVIDENCE_V2|"
        if marker not in line:
            continue
        payload = line.split(marker, 1)[1].strip()
        fields: dict[str, str] = {}
        for part in payload.split("|"):
            if "=" not in part:
                continue
            key, value = part.split("=", 1)
            fields[unquote(key)] = unquote(value)
        if fields.get("kind") in {
            "boundary", "event", "remember", "transition", "policy_decision",
            "target", "checkpoint", "order", "weekly_completion",
            "checkpoint_import", "portfolio_restore",
            "selection", "allocation",
        }:
            records.append(fields)
    return tuple(records)


def load_temporal_snapshot(
    fixture: Path, *, snapshot_id: str = "lean-temporal-data@1",
) -> DailyMarketSnapshot:
    archive_path = fixture / "equity" / "usa" / "daily" / "qqq.zip"
    with ZipFile(archive_path) as archive:
        rows = [
            row.split(",")
            for row in archive.read("qqq.csv").decode("utf-8").splitlines()
            if row[:8] >= "20240102"
        ]
    return DailyMarketSnapshot(
        snapshot_id=snapshot_id, clock=Clock(id="daily-close"),
        dates=tuple(f"{row[0][:4]}-{row[0][4:6]}-{row[0][6:8]}" for row in rows),
        domains={"temporal-group": ("QQQ",)},
        series={"QQQ": {"close:adjusted": tuple(Decimal(row[4]) / Decimal(10_000) for row in rows)}},
    )


def reference_temporal_trace(
    snapshot: DailyMarketSnapshot, *, profile: str = "daily",
) -> tuple[ProgramExecutionResult, ...]:
    strategy = temporal_multiclock_strategy() if profile == "multiclock" else temporal_breakout_strategy()
    assert strategy.program is not None
    prior: ProgramExecutionResult | None = None
    results: list[ProgramExecutionResult] = []
    for cutoff in range(len(snapshot.dates)):
        result = execute_program_v2(
            strategy.program, snapshot, cutoff_index=cutoff,
            prior_state=None if prior is None else prior.state,
            event_cutoffs=None if prior is None else prior.event_cutoffs,
            prior_event_truths=None if prior is None else prior.event_truths,
            event_counts=None if prior is None else prior.event_counts,
            state_entered_cutoffs=None if prior is None else prior.state_entered_cutoffs,
            remembered_values=None if prior is None else prior.remembered_values,
        )
        results.append(result)
        prior = result
    return tuple(results)


def _csv_map(value: str) -> dict[str, str]:
    return dict(item.split("=", 1) for item in value.split(",") if item)


def verify_temporal_e2e(
    log_text: str,
    result_payload: object,
    fixture: Path,
    *,
    profile: str = "daily",
) -> TemporalDifferentialResult:
    validate_lean_completion(log_text)
    validate_zero_failed_data_requests(log_text)
    records = parse_temporal_evidence(log_text)
    snapshot_id = "lean-multiclock-data@1" if profile == "multiclock" else "lean-temporal-data@1"
    snapshot = load_temporal_snapshot(fixture, snapshot_id=snapshot_id)
    boundary_cutoffs = [item["cutoff"] for item in records if item.get("kind") == "boundary"]
    if not boundary_cutoffs:
        raise ValueError("temporal LEAN execution emitted no decision boundaries")
    final_cutoff = max(boundary_cutoffs)
    length = max(index for index, item in enumerate(snapshot.dates) if item <= final_cutoff) + 1
    snapshot = DailyMarketSnapshot(
        snapshot_id=snapshot.snapshot_id,
        clock=snapshot.clock,
        dates=snapshot.dates[:length],
        domains=snapshot.domains,
        series={
            symbol: {field: values[:length] for field, values in fields.items()}
            for symbol, fields in snapshot.series.items()
        },
    )
    reference = reference_temporal_trace(snapshot, profile=profile)
    by_cutoff: dict[str, list[dict[str, str]]] = {}
    for record in records:
        cutoff = record.get("cutoff") or record.get("session", "").removeprefix("daily-close:")
        by_cutoff.setdefault(cutoff, []).append(record)

    event_statements = (
        "breakout-event-statement", "retest-event-statement",
        "confirmation-event-statement", "expiry-event-statement",
    )
    triggered_events = transitions = captures = policies = intents = 0
    for expected in reference:
        observed = by_cutoff.get(expected.cutoff, [])
        boundaries = [item for item in observed if item.get("kind") == "boundary"]
        if len(boundaries) != 1:
            raise ValueError(f"expected one temporal boundary at {expected.cutoff}, got {len(boundaries)}")
        event_records = sorted(
            (item for item in observed if item.get("kind") == "event"),
            key=lambda item: int(item["event_order"]),
        )
        if len(event_records) != len(event_statements):
            raise ValueError(f"temporal Event coverage mismatch at {expected.cutoff}")
        reference_events = {
            item.semantic_id: item.outcome == "triggered"
            for item in expected.evidence if item.kind == "event"
        }
        for order, (record, statement_id) in enumerate(zip(event_records, event_statements, strict=True)):
            if record["statement_id"] != statement_id or int(record["event_order"]) != order:
                raise ValueError(f"temporal Event order mismatch at {expected.cutoff}")
            actual = record["triggered"] == "true"
            if actual != reference_events[statement_id]:
                raise ValueError(f"temporal Event occurrence mismatch at {expected.cutoff}: {statement_id}")
            event_id = record["event_id"]
            if record["truth"] != expected.event_truths[event_id]:
                raise ValueError(f"temporal T/F/U mismatch at {expected.cutoff}: {event_id}")
            expected_status = "unknown" if expected.event_truths[event_id] == "unknown" else "ready"
            if record["status"] != expected_status:
                raise ValueError(f"temporal readiness mismatch at {expected.cutoff}: {event_id}")
            triggered_events += int(actual)

        transition_records = [item for item in observed if item.get("kind") == "transition"]
        expected_transitions = [
            item for item in expected.evidence if item.kind == "transition" and item.outcome == "true"
        ]
        selected_transitions = [item for item in transition_records if item.get("selected") == "true"]
        if [item["statement_id"] for item in selected_transitions] != [item.semantic_id for item in expected_transitions]:
            raise ValueError(f"State transition mismatch at {expected.cutoff}")
        transitions += len(selected_transitions)

        memory_records = [item for item in observed if item.get("kind") == "remember" and item.get("value")]
        expected_memory = [item for item in expected.evidence if item.kind == "remember" and item.outcome == "stored"]
        if len(memory_records) != len(expected_memory):
            raise ValueError(f"memory capture count mismatch at {expected.cutoff}")
        for record in memory_records:
            if Decimal(record["value"]) != expected.remembered_values[record["memory_id"]]:
                raise ValueError(f"remembered Value mismatch at {expected.cutoff}")
        captures += len(memory_records)

        policy_records = [item for item in observed if item.get("kind") == "policy_decision"]
        if len(policy_records) != 1:
            raise ValueError(f"policy decision coverage mismatch at {expected.cutoff}")
        expected_kind = "asset" if "QQQ" in expected.target_weights else "cash"
        if policy_records[0]["target_kind"] != expected_kind or Decimal(policy_records[0]["weight"]) != Decimal(1):
            raise ValueError(f"policy target mismatch at {expected.cutoff}")
        policies += 1
        intents += len([item for item in observed if item.get("kind") == "target"])

        checkpoints = [item for item in observed if item.get("kind") == "checkpoint"]
        if len(checkpoints) != 1:
            raise ValueError(f"checkpoint evidence mismatch at {expected.cutoff}")
        expected_profile = "event-state-multiclock@1" if profile == "multiclock" else "event-state-daily@1"
        if not checkpoints[0].get("checkpoint_identity") or checkpoints[0].get("profile") != expected_profile:
            raise ValueError(f"checkpoint identity mismatch at {expected.cutoff}")
        if not checkpoints[0].get("operator_versions"):
            raise ValueError(f"checkpoint operator versions missing at {expected.cutoff}")
        if _csv_map(checkpoints[0]["state"]) != expected.state:
            raise ValueError(f"checkpoint State mismatch at {expected.cutoff}")
        actual_memory = {key: Decimal(value) for key, value in _csv_map(checkpoints[0]["memory"]).items()}
        if actual_memory != expected.remembered_values:
            raise ValueError(f"checkpoint memory mismatch at {expected.cutoff}")

    normalized = normalize_lean_result(result_payload)
    order_records = [item for item in records if item.get("kind") == "order"]
    if normalized.total_orders <= 0 or not order_records:
        raise ValueError("temporal LEAN execution produced no actual orders")
    if intents != 2:
        raise ValueError(f"expected cash and confirmed order intents without duplicates, got {intents}")
    if any(item.get("symbol") != "QQQ" or Decimal(item.get("quantity", "0")) == 0 for item in order_records):
        raise ValueError("temporal actual order evidence has an unexpected symbol or zero quantity")
    confirmation_cutoff = next(
        item.cutoff for item in reference if item.state.get("phase") == "confirmed"
    )
    if min(item.get("session", "") for item in order_records) < confirmation_cutoff:
        raise ValueError("temporal actual order preceded the confirmed policy decision")
    weekly = [item for item in records if item.get("kind") == "weekly_completion"]
    if profile == "multiclock":
        if not weekly:
            raise ValueError("multi-clock LEAN execution emitted no completed weekly observations")
        for item in weekly:
            if item.get("weekly_source_cutoff", "") >= item.get("available_cutoff", ""):
                raise ValueError("weekly context was available before its completed source cutoff")
    return TemporalDifferentialResult(
        boundaries=len(reference), triggered_events=triggered_events,
        transitions=transitions, memory_captures=captures,
        policy_decisions=policies, order_intents=intents,
        actual_orders=len(order_records),
        weekly_completions=len(weekly),
    )
