from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, replace
from datetime import date
from decimal import Decimal
from typing import Mapping

from ruletrade.compiler.lean.plan import LeanTemporalCheckpoint, LeanTemporalProgram


SCHEMA_VERSION = "ruletrade-temporal-checkpoint@1"


class TemporalCheckpointError(ValueError):
    """A checkpoint was incomplete, corrupt, from the future, or incompatible."""


def _csv(value: str) -> tuple[tuple[str, str], ...]:
    if not value:
        return ()
    try:
        return tuple(sorted(item.split("=", 1) for item in value.split(",") if item))
    except ValueError as exc:
        raise TemporalCheckpointError("checkpoint_field_malformed") from exc


def _integer_pairs(value: str) -> tuple[tuple[str, int], ...]:
    try:
        return tuple((key, int(item)) for key, item in _csv(value))
    except ValueError as exc:
        raise TemporalCheckpointError("checkpoint_integer_field_malformed") from exc


def _decimal_pairs(value: str) -> tuple[tuple[str, Decimal], ...]:
    try:
        return tuple((key, Decimal(item)) for key, item in _csv(value))
    except Exception as exc:
        raise TemporalCheckpointError("checkpoint_decimal_field_malformed") from exc


def _payload(checkpoint: LeanTemporalCheckpoint) -> dict[str, object]:
    payload = asdict(replace(checkpoint, integrity_hash=""))
    payload.pop("integrity_hash")
    return payload


def _normalized(checkpoint: LeanTemporalCheckpoint) -> LeanTemporalCheckpoint:
    return replace(
        checkpoint,
        operator_versions=tuple(sorted(checkpoint.operator_versions)),
        state=tuple(sorted(checkpoint.state)),
        state_entered_cutoffs=tuple(sorted(checkpoint.state_entered_cutoffs)),
        event_cutoffs=tuple(sorted(checkpoint.event_cutoffs)),
        event_truths=tuple(sorted(checkpoint.event_truths)),
        event_counts=tuple(sorted(checkpoint.event_counts)),
        memory=tuple(sorted(checkpoint.memory)),
        memory_capture_cutoffs=tuple(sorted(checkpoint.memory_capture_cutoffs)),
        memory_value_ids=tuple(sorted(checkpoint.memory_value_ids)),
    )


def checkpoint_integrity_hash(checkpoint: LeanTemporalCheckpoint) -> str:
    encoded = json.dumps(
        _payload(_normalized(checkpoint)), sort_keys=True, separators=(",", ":"), default=str,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def seal_checkpoint(checkpoint: LeanTemporalCheckpoint) -> LeanTemporalCheckpoint:
    normalized = _normalized(checkpoint)
    return replace(normalized, integrity_hash=checkpoint_integrity_hash(normalized))


def checkpoint_from_evidence(record: Mapping[str, str]) -> LeanTemporalCheckpoint:
    required = {
        "schema_version", "profile", "strategy_identity", "checkpoint_identity",
        "snapshot_id", "clock", "cutoff", "boundary_index", "operator_versions",
        "asset_universe", "statement_order",
        "state", "state_entered_cutoffs", "events", "event_truths", "event_counts",
        "memory", "memory_capture_cutoffs", "memory_value_ids", "last_policy_target",
    }
    missing = sorted(required - record.keys())
    if missing:
        raise TemporalCheckpointError(f"checkpoint_incomplete:{','.join(missing)}")
    try:
        checkpoint = LeanTemporalCheckpoint(
            schema_version=record["schema_version"],  # type: ignore[arg-type]
            profile=record["profile"],  # type: ignore[arg-type]
            strategy_identity=record["strategy_identity"],
            checkpoint_identity=record["checkpoint_identity"],
            snapshot_id=record["snapshot_id"],
            clock_id=record["clock"],
            cutoff=record["cutoff"],
            boundary_index=int(record["boundary_index"]),
            operator_versions=_csv(record["operator_versions"]),
            asset_universe=tuple(item for item in record["asset_universe"].split(",") if item),
            statement_order=tuple(item for item in record["statement_order"].split(",") if item),
            state=_csv(record["state"]),
            state_entered_cutoffs=_integer_pairs(record["state_entered_cutoffs"]),
            event_cutoffs=_integer_pairs(record["events"]),
            event_truths=_csv(record["event_truths"]),
            event_counts=_integer_pairs(record["event_counts"]),
            memory=_decimal_pairs(record["memory"]),
            memory_capture_cutoffs=_integer_pairs(record["memory_capture_cutoffs"]),
            memory_value_ids=_csv(record["memory_value_ids"]),
            last_policy_target=record["last_policy_target"],
            active_week_key=record.get("active_week_key", ""),
            active_week_close=(
                Decimal(record["active_week_close"])
                if record.get("active_week_close") else None
            ),
            active_week_cutoff=record.get("active_week_cutoff", ""),
            completed_weekly_close=(
                Decimal(record["completed_weekly_close"])
                if record.get("completed_weekly_close") else None
            ),
            completed_weekly_source_cutoff=record.get("completed_weekly_source_cutoff", ""),
            completed_weekly_available_cutoff=record.get("completed_weekly_available_cutoff", ""),
            portfolio_target=record.get("portfolio_target", ""),
        )
    except (TypeError, ValueError) as exc:
        raise TemporalCheckpointError("checkpoint_decode_failed") from exc
    return seal_checkpoint(checkpoint)


def serialize_checkpoint(checkpoint: LeanTemporalCheckpoint) -> str:
    sealed = seal_checkpoint(checkpoint)
    return json.dumps(asdict(sealed), sort_keys=True, separators=(",", ":"), default=str)


def deserialize_checkpoint(payload: str) -> LeanTemporalCheckpoint:
    try:
        raw = json.loads(payload)
        checkpoint = LeanTemporalCheckpoint(
            **{
                **raw,
                "operator_versions": tuple(map(tuple, raw["operator_versions"])),
                "asset_universe": tuple(raw["asset_universe"]),
                "statement_order": tuple(raw["statement_order"]),
                "state": tuple(map(tuple, raw["state"])),
                "state_entered_cutoffs": tuple((key, int(value)) for key, value in raw["state_entered_cutoffs"]),
                "event_cutoffs": tuple((key, int(value)) for key, value in raw["event_cutoffs"]),
                "event_truths": tuple(map(tuple, raw["event_truths"])),
                "event_counts": tuple((key, int(value)) for key, value in raw["event_counts"]),
                "memory": tuple((key, Decimal(value)) for key, value in raw["memory"]),
                "memory_capture_cutoffs": tuple((key, int(value)) for key, value in raw["memory_capture_cutoffs"]),
                "memory_value_ids": tuple(map(tuple, raw["memory_value_ids"])),
                "active_week_close": Decimal(raw["active_week_close"]) if raw.get("active_week_close") is not None else None,
                "completed_weekly_close": Decimal(raw["completed_weekly_close"]) if raw.get("completed_weekly_close") is not None else None,
            }
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise TemporalCheckpointError("checkpoint_decode_failed") from exc
    if checkpoint.integrity_hash != checkpoint_integrity_hash(checkpoint):
        raise TemporalCheckpointError("checkpoint_integrity_mismatch")
    return replace(_normalized(checkpoint), integrity_hash=checkpoint.integrity_hash)


def validate_checkpoint(
    checkpoint: LeanTemporalCheckpoint,
    program: LeanTemporalProgram,
    *,
    strategy_identity: str,
    snapshot_id: str,
    resume_start: date,
) -> LeanTemporalCheckpoint:
    if checkpoint.schema_version != SCHEMA_VERSION:
        raise TemporalCheckpointError("checkpoint_schema_incompatible")
    if checkpoint.integrity_hash != checkpoint_integrity_hash(checkpoint):
        raise TemporalCheckpointError("checkpoint_integrity_mismatch")
    if checkpoint.strategy_identity != strategy_identity:
        raise TemporalCheckpointError("checkpoint_strategy_mismatch")
    if checkpoint.checkpoint_identity != program.checkpoint_identity:
        raise TemporalCheckpointError("checkpoint_semantic_hash_mismatch")
    if checkpoint.profile != program.profile:
        raise TemporalCheckpointError("checkpoint_profile_mismatch")
    if checkpoint.snapshot_id != snapshot_id:
        raise TemporalCheckpointError("checkpoint_snapshot_mismatch")
    if checkpoint.clock_id != program.clock_id:
        raise TemporalCheckpointError("checkpoint_clock_mismatch")
    if checkpoint.operator_versions != tuple(sorted(program.operator_versions)):
        raise TemporalCheckpointError("checkpoint_operator_version_mismatch")
    if checkpoint.asset_universe != (program.asset_universe or (program.anchor_symbol,)):
        raise TemporalCheckpointError("checkpoint_asset_universe_mismatch")
    if checkpoint.statement_order != (
        *(item.statement_id for item in program.events), program.policy_statement_id,
    ):
        raise TemporalCheckpointError("checkpoint_statement_order_mismatch")
    if date.fromisoformat(checkpoint.cutoff) >= resume_start:
        raise TemporalCheckpointError("checkpoint_is_not_before_resume_start")

    event_ids = {item.semantic_id for item in program.events}
    if not set(dict(checkpoint.event_truths)) <= event_ids:
        raise TemporalCheckpointError("checkpoint_unknown_event")
    if not set(dict(checkpoint.event_cutoffs)) <= event_ids:
        raise TemporalCheckpointError("checkpoint_unknown_event_history")
    if any(value not in {"true", "false", "unknown"} for _, value in checkpoint.event_truths):
        raise TemporalCheckpointError("checkpoint_event_truth_invalid")
    initial_keys = {key for key, _ in program.initial_state}
    if set(dict(checkpoint.state)) != initial_keys:
        raise TemporalCheckpointError("checkpoint_state_incomplete")
    memory_keys = {
        action.memory_id
        for event in program.events for action in event.actions
        if action.kind == "remember" and action.memory_id
    }
    if not set(dict(checkpoint.memory)) <= memory_keys:
        raise TemporalCheckpointError("checkpoint_unknown_memory")
    if set(dict(checkpoint.memory)) != set(dict(checkpoint.memory_capture_cutoffs)):
        raise TemporalCheckpointError("checkpoint_memory_capture_incomplete")
    if set(dict(checkpoint.memory)) != set(dict(checkpoint.memory_value_ids)):
        raise TemporalCheckpointError("checkpoint_memory_identity_incomplete")
    triggered = set(dict(checkpoint.event_cutoffs))
    required_memory = {
        action.memory_id
        for event in program.events if event.semantic_id in triggered
        for action in event.actions if action.kind == "remember" and action.memory_id
    }
    if not required_memory <= set(dict(checkpoint.memory)):
        raise TemporalCheckpointError("checkpoint_required_memory_missing")
    if any(value > checkpoint.boundary_index for _, value in checkpoint.event_cutoffs):
        raise TemporalCheckpointError("checkpoint_future_event")
    if any(value > checkpoint.boundary_index for _, value in checkpoint.memory_capture_cutoffs):
        raise TemporalCheckpointError("checkpoint_future_memory")
    return checkpoint
