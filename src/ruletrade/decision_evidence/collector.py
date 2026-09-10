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
    SelectionAssetOutcome,
    SelectionEvidence,
    SleeveContributionEvidence,
    SnapshotRefreshEvidence,
    SnapshotUsageEvidence,
    SourceComponentRef,
    StateMutationEvidence,
)

PREFIXES = {
    "RULETRADE_EVIDENCE_V1|": 1,
    "RULETRADE_EVIDENCE_V2|": 2,
}


def collect_decision_evidence(log_text: str) -> tuple[CollectedDecisionEvent, ...]:
    """Parse only the explicit v1 machine contract; human traces are not inputs."""

    records: list[CollectedDecisionEvent] = []
    for line in log_text.splitlines():
        match = next(
            (
                (line.find(prefix), prefix, version)
                for prefix, version in PREFIXES.items()
                if line.find(prefix) >= 0
            ),
            None,
        )
        if match is None:
            continue
        marker, prefix, version = match
        fields = _fields(line[marker + len(prefix) :])
        records.append(_record(fields, version))
    expected = list(range(1, len(records) + 1))
    actual = [item.sequence for item in records]
    if actual != expected:
        raise DecisionEvidenceError(
            f"Decision evidence sequence must be contiguous from 1; observed {actual}."
        )
    if len({item.schema_version for item in records}) > 1:
        raise DecisionEvidenceError(
            "One Backtest Run cannot mix Decision Evidence schema versions."
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


def _record(fields: dict[str, str], schema_version: int) -> CollectedDecisionEvent:
    try:
        sequence = int(fields.pop("sequence"))
        session_id = date.fromisoformat(fields.pop("session"))
        phase = fields.pop("phase")
        kind = fields.pop("kind")
        sources = _sources(fields)
        evidence = _payload(kind, fields, schema_version)
        if fields:
            raise DecisionEvidenceError(
                f"Unexpected {kind} evidence fields: {', '.join(sorted(fields))}."
            )
        return CollectedDecisionEvent(
            schema_version=schema_version,
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
        field_path = fields.pop(f"{role}_field", None)
        if component_id:
            references.append(
                SourceComponentRef(
                    role=role,
                    component_id=component_id,
                    field_path=field_path or None,
                )
            )
        elif field_path:
            raise DecisionEvidenceError("Source field path requires a source component.")
    return tuple(references)


def _payload(kind: str, fields: dict[str, str], schema_version: int):
    if kind == "filter":
        scores = _decimal_map(fields.pop("scores"))
        eligible = set(_symbols(fields.pop("eligible")))
        rejected = set(_symbols(fields.pop("rejected")))
        if eligible | rejected != set(scores) or eligible & rejected:
            raise DecisionEvidenceError("Filter evidence does not partition observations.")
        decision_universe = (
            _symbols(fields.pop("decision_universe")) if schema_version >= 2 else None
        )
        if decision_universe is not None and not set(scores) <= set(decision_universe):
            raise DecisionEvidenceError(
                "Filter evaluations must belong to the decision universe."
            )
        return FilterEvidence(
            operator=fields.pop("operator"),
            threshold=Decimal(fields.pop("threshold")),
            evaluations=tuple(
                AssetPredicate(
                    asset=asset,
                    observed=value,
                    passed=asset in eligible,
                    stopping_stage=(
                        "filter"
                        if schema_version >= 2 and asset in rejected
                        else None
                    ),
                )
                for asset, value in scores.items()
            ),
            decision_universe=decision_universe,
        )
    if kind == "selection":
        required_count = (
            int(fields.pop("required_count")) if schema_version >= 2 else None
        )
        outcomes = None
        if schema_version >= 2:
            evaluated = _symbols(fields.pop("evaluated"))
            present = set(_symbols(fields.pop("signal_present")))
            absent = set(_symbols(fields.pop("signal_absent")))
            ranks = _int_map(fields.pop("ranks"))
            stops = _string_map(fields.pop("stops"))
            ranked = _symbols(fields["ranked"])
            candidates = _symbols(fields["candidates"])
            if present | absent != set(evaluated) or present & absent:
                raise DecisionEvidenceError(
                    "Selection signal outcomes must partition evaluated assets."
                )
            if set(ranks) != set(evaluated) or not set(stops) <= set(evaluated):
                raise DecisionEvidenceError(
                    "Selection ranks/stops must refer to evaluated assets."
                )
            if (
                evaluated != ranked
                or present != set(candidates)
                or [ranks[asset] for asset in evaluated]
                != list(range(1, len(evaluated) + 1))
            ):
                raise DecisionEvidenceError(
                    "Selection outcomes must match ranked candidates and exact ranks."
                )
            primary_selected = _symbols(fields["primary_selected"])
            if not set(primary_selected) <= present or len(candidates) > required_count:
                raise DecisionEvidenceError(
                    "Selection membership exceeds its candidate/cardinality contract."
                )
            outcomes = tuple(
                SelectionAssetOutcome(
                    asset=asset,
                    signal="present" if asset in present else "absent",
                    rank=ranks[asset],
                    primary_selected=asset in primary_selected,
                    stopping_stage=stops.get(asset),
                )
                for asset in evaluated
            )
        return SelectionEvidence(
            scores=_decimal_map(fields.pop("scores")),
            ranked=_symbols(fields.pop("ranked")),
            candidates=_symbols(fields.pop("candidates")),
            primary_selected=_symbols(fields.pop("primary_selected")),
            decision=fields.pop("decision"),
            required_count=required_count,
            asset_outcomes=outcomes,
        )
    if kind == "random_selection":
        return RandomSelectionEvidence(
            universe=_symbols(fields.pop("universe")),
            selected=_symbols(fields.pop("selected")),
            resample=fields.pop("resample"),
            required_count=(
                int(fields.pop("required_count")) if schema_version >= 2 else None
            ),
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
        eligible = _bool(fields.pop("eligible"))
        stopping_stage = (
            fields.pop("stopping_stage") or None if schema_version >= 2 else None
        )
        if schema_version >= 2 and (stopping_stage == "cooldown") == eligible:
            raise DecisionEvidenceError(
                "Cooldown stopping stage must exactly match a blocked decision."
            )
        return CooldownEvidence(
            asset=fields.pop("asset"),
            signal_candidate=_bool(fields.pop("signal_candidate")),
            last_exit=_optional_date(fields.pop("last_exit")),
            elapsed_completed_sessions=_optional_int(fields.pop("elapsed_sessions")),
            required_completed_sessions=int(fields.pop("required_sessions")),
            eligible=eligible,
            stopping_stage=stopping_stage,
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


def _int_map(value: str) -> dict[str, int]:
    return {
        key: int(raw)
        for item in value.split(",")
        if item
        for key, raw in (item.split("=", 1),)
    }


def _string_map(value: str) -> dict[str, str]:
    return {
        key: raw
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
