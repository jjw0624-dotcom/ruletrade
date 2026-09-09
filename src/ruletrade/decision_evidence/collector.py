from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation
from urllib.parse import unquote

from ruletrade.decision_evidence.errors import DecisionEvidenceError
from ruletrade.decision_evidence.models import (
    AssetPredicate,
    CollectedDecisionEvent,
    CooldownEvidence,
    FallbackEvidence,
    FilterEvidence,
    FinalSelectionEvidence,
    FinalTargetsEvidence,
    RandomSelectionEvidence,
    SelectionEvidence,
    SleeveContributionEvidence,
    SnapshotRefreshEvidence,
    SnapshotUsageEvidence,
    SourceComponentRef,
    StateMutationEvidence,
)

PREFIX = "RULETRADE_EVIDENCE_V1|"


def collect_decision_evidence(log_text: str) -> tuple[CollectedDecisionEvent, ...]:
    """Parse only the explicit v1 machine contract; human traces are not inputs."""

    records: list[CollectedDecisionEvent] = []
    for line in log_text.splitlines():
        marker = line.find(PREFIX)
        if marker < 0:
            continue
        fields = _fields(line[marker + len(PREFIX) :])
        records.append(_record(fields))
    expected = list(range(1, len(records) + 1))
    actual = [item.sequence for item in records]
    if actual != expected:
        raise DecisionEvidenceError(
            f"Decision evidence sequence must be contiguous from 1; observed {actual}."
        )
    return tuple(records)


def _fields(encoded: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for token in encoded.strip().split("|"):
        if "=" not in token:
            raise DecisionEvidenceError("Decision evidence field is malformed.")
        raw_key, raw_value = token.split("=", 1)
        key, value = unquote(raw_key), unquote(raw_value)
        if not key or key in fields:
            raise DecisionEvidenceError("Decision evidence fields must be named and unique.")
        fields[key] = value
    return fields


def _record(fields: dict[str, str]) -> CollectedDecisionEvent:
    try:
        sequence = int(fields.pop("sequence"))
        session_id = date.fromisoformat(fields.pop("session"))
        phase = fields.pop("phase")
        kind = fields.pop("kind")
        sources = _sources(fields)
        evidence = _payload(kind, fields)
        if fields:
            raise DecisionEvidenceError(
                f"Unexpected {kind} evidence fields: {', '.join(sorted(fields))}."
            )
        return CollectedDecisionEvent(
            sequence=sequence,
            session_id=session_id,
            phase=phase,
            source_components=sources,
            evidence=evidence,
        )
    except (KeyError, ValueError, InvalidOperation) as exc:
        if isinstance(exc, DecisionEvidenceError):
            raise
        raise DecisionEvidenceError("Decision evidence record is invalid.") from exc


def _sources(fields: dict[str, str]) -> tuple[SourceComponentRef, ...]:
    roles = sorted(key[:-10] for key in fields if key.endswith("_component"))
    references = []
    for role in roles:
        component_id = fields.pop(f"{role}_component")
        if component_id:
            references.append(SourceComponentRef(role=role, component_id=component_id))
    return tuple(references)


def _payload(kind: str, fields: dict[str, str]):
    if kind == "filter":
        scores = _decimal_map(fields.pop("scores"))
        eligible = set(_symbols(fields.pop("eligible")))
        rejected = set(_symbols(fields.pop("rejected")))
        if eligible | rejected != set(scores) or eligible & rejected:
            raise DecisionEvidenceError("Filter evidence does not partition observations.")
        return FilterEvidence(
            operator=fields.pop("operator"),
            threshold=Decimal(fields.pop("threshold")),
            evaluations=tuple(
                AssetPredicate(asset=asset, observed=value, passed=asset in eligible)
                for asset, value in scores.items()
            ),
        )
    if kind == "selection":
        return SelectionEvidence(
            scores=_decimal_map(fields.pop("scores")),
            ranked=_symbols(fields.pop("ranked")),
            candidates=_symbols(fields.pop("candidates")),
            primary_selected=_symbols(fields.pop("primary_selected")),
            decision=fields.pop("decision"),
        )
    if kind == "random_selection":
        return RandomSelectionEvidence(
            universe=_symbols(fields.pop("universe")),
            selected=_symbols(fields.pop("selected")),
            resample=fields.pop("resample"),
        )
    if kind == "fallback":
        return FallbackEvidence(
            asset=fields.pop("asset"), activated=_bool(fields.pop("activated"))
        )
    if kind == "final_selection":
        return FinalSelectionEvidence(
            selected=_symbols(fields.pop("selected")), source=fields.pop("source")
        )
    if kind == "cooldown":
        return CooldownEvidence(
            asset=fields.pop("asset"),
            signal_candidate=_bool(fields.pop("signal_candidate")),
            last_exit=_optional_date(fields.pop("last_exit")),
            elapsed_completed_sessions=_optional_int(fields.pop("elapsed_sessions")),
            required_completed_sessions=int(fields.pop("required_sessions")),
            eligible=_bool(fields.pop("eligible")),
        )
    if kind == "state_mutation":
        return StateMutationEvidence(
            asset=fields.pop("asset"),
            state=fields.pop("state"),
            old_value=_optional_date(fields.pop("old_value")),
            new_value=date.fromisoformat(fields.pop("new_value")),
            cause=fields.pop("cause"),
        )
    if kind == "snapshot_refresh":
        return SnapshotRefreshEvidence(
            schedule=fields.pop("schedule"),
            local_targets=_decimal_map(fields.pop("local_targets")),
            snapshot_session=date.fromisoformat(fields.pop("snapshot_session")),
        )
    if kind == "snapshot_usage":
        return SnapshotUsageEvidence(
            schedule=fields.pop("schedule"),
            snapshots=_date_map(fields.pop("snapshots")),
            executed=_bool(fields.pop("executed")),
        )
    if kind == "sleeve_contribution":
        return SleeveContributionEvidence(
            local_selected=_symbols(fields.pop("local_selected")),
            local_targets=_decimal_map(fields.pop("local_targets")),
            allocation=Decimal(fields.pop("allocation")),
            scaled_targets=_decimal_map(fields.pop("scaled_targets")),
        )
    if kind == "final_targets":
        return FinalTargetsEvidence(
            selected=_symbols(fields.pop("selected")),
            targets=_decimal_map(fields.pop("targets")),
        )
    raise DecisionEvidenceError(f"Unsupported decision evidence kind: {kind}.")


def _symbols(value: str) -> tuple[str, ...]:
    return tuple(item for item in value.split(",") if item)


def _decimal_map(value: str) -> dict[str, Decimal]:
    return {
        key: Decimal(raw)
        for item in value.split(",")
        if item
        for key, raw in (item.split("=", 1),)
    }


def _date_map(value: str) -> dict[str, date]:
    return {
        key: date.fromisoformat(raw)
        for item in value.split(",")
        if item
        for key, raw in (item.split("=", 1),)
    }


def _bool(value: str) -> bool:
    if value not in {"true", "false"}:
        raise DecisionEvidenceError("Boolean evidence values must be true or false.")
    return value == "true"


def _optional_date(value: str) -> date | None:
    return None if value == "none" else date.fromisoformat(value)


def _optional_int(value: str) -> int | None:
    return None if value == "none" else int(value)
