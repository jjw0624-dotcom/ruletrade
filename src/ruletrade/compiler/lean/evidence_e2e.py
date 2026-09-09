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
