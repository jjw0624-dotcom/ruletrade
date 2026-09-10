from __future__ import annotations

from collections import defaultdict

from ruletrade.decision_evidence import CollectedDecisionEvent, collect_decision_evidence

EvidenceIndex = dict[tuple[str, str], tuple[CollectedDecisionEvent, ...]]


def index_decision_evidence(log_text: str) -> EvidenceIndex:
    grouped: dict[tuple[str, str], list[CollectedDecisionEvent]] = defaultdict(list)
    for event in collect_decision_evidence(log_text):
        grouped[(event.session_id.isoformat(), event.evidence.kind)].append(event)
    return {key: tuple(value) for key, value in grouped.items()}


def one_evidence(
    index: EvidenceIndex,
    session: str,
    kind: str,
) -> CollectedDecisionEvent:
    records = index.get((session, kind), ())
    if len(records) != 1:
        raise ValueError(f"expected one {kind} evidence event for {session}, got {len(records)}")
    return records[0]


def source_component(event: CollectedDecisionEvent, role: str) -> str:
    matches = [item.component_id for item in event.source_components if item.role == role]
    if len(matches) != 1:
        raise ValueError(
            f"expected one {role} source component for evidence sequence {event.sequence}"
        )
    return matches[0]


def verify_v2_filter_facts(
    event: CollectedDecisionEvent,
    *,
    decision_universe: tuple[str, ...],
    rejected: tuple[str, ...],
) -> None:
    if event.schema_version < 2:
        return
    evidence = event.evidence
    if evidence.kind != "filter" or evidence.decision_universe != decision_universe:
        raise ValueError("v2 filter decision-universe evidence mismatch")
    stops = {
        item.asset: item.stopping_stage
        for item in evidence.evaluations
        if item.stopping_stage is not None
    }
    if stops != {asset: "filter" for asset in rejected}:
        raise ValueError("v2 filter stopping-stage evidence mismatch")
    source = next(item for item in event.source_components if item.role == "filter")
    if source.field_path != "config.threshold":
        raise ValueError("v2 filter source field-path mismatch")


def verify_v2_selection_facts(
    event: CollectedDecisionEvent,
    *,
    ranked: tuple[str, ...],
    candidates: tuple[str, ...],
    primary_selected: tuple[str, ...],
    required_count: int,
    candidate_stop: str | None = None,
) -> None:
    if event.schema_version < 2:
        return
    evidence = event.evidence
    if (
        evidence.kind != "selection"
        or evidence.required_count != required_count
        or evidence.asset_outcomes is None
    ):
        raise ValueError("v2 selection cardinality evidence mismatch")
    expected = {
        asset: (
            "present" if asset in candidates else "absent",
            index,
            asset in primary_selected,
            (
                candidate_stop
                if asset in candidates and asset not in primary_selected
                else ("rank_cutoff" if asset not in candidates else None)
            ),
        )
        for index, asset in enumerate(ranked, start=1)
    }
    actual = {
        item.asset: (
            item.signal,
            item.rank,
            item.primary_selected,
            item.stopping_stage,
        )
        for item in evidence.asset_outcomes
    }
    if actual != expected:
        raise ValueError("v2 selection asset-outcome evidence mismatch")
    source = next(item for item in event.source_components if item.role == "selection")
    if source.field_path != "config.count":
        raise ValueError("v2 selection source field-path mismatch")


def evidence_for_source(
    index: EvidenceIndex,
    session: str,
    kind: str,
    role: str,
    component_id: str,
) -> CollectedDecisionEvent:
    matches = [
        event
        for event in index.get((session, kind), ())
        if any(
            item.role == role and item.component_id == component_id
            for item in event.source_components
        )
    ]
    if len(matches) != 1:
        raise ValueError(
            f"expected one {kind} evidence event for {session} and {component_id}, "
            f"got {len(matches)}"
        )
    return matches[0]
