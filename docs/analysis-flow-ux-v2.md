# Analysis UX v2 and Conceptual Flow v2

## Contract audit

- Analysis uses only persisted Decision Evidence v1/v2. Schema v2 adds required selection count, explicit signal state, stopping stages, decision universe, and optional Canonical-relative field paths.
- Historical v1 runs retain cautious language; absence remains unknown.
- Target decisions are not presented as orders or fills.
- Conceptual Flow is a deterministic projection of the existing Canonical strategy through the existing Guided projection. It is not authoritative and does not replace production Flow.

## Analysis information hierarchy

1. Concise decision summary
2. Asset Outcomes
3. Selected asset explanation
4. Per-asset Selection Path
5. Portfolio contribution bars
6. More details (collapsed)

Provenance is attached to condition/path/allocation interactions. A complete source list remains secondary in More details.

## Research context

`ResearchContext` remains UI-only and carries run ID, selected session, and selected asset. Source focus separately carries component ID and optional field path. Result → Strategy shows a dated/asset-specific return affordance; returning restores the selected Run/session/asset and scrolls Analysis into view.

## Conceptual Flow v2

The production React Flow editor remains unchanged and available. Its experimental preview projects:

- Portfolio / Group hierarchy
- Split allocations
- Choose N
- qualification condition
- ranking direction
- Otherwise destination
- cooldown inside Choose
- evaluation/rebalance cadence as properties
- source Canonical component IDs

Supported fixture coverage: Golden, Momentum Top N, Filter + Top N, Fallback, Portfolio Sleeves, Independent Schedules, and Cooldown.

Conditional 60/40 ↔ 70/30 and recurring contributions are shown only as conceptual-only vocabulary/cases because current Canonical does not support them.

## Acceptance status

- Analysis v2: implemented against real evidence.
- Flow v2: useful prototype, but not accepted as a production Flow replacement. It needs first-time-user testing and broader strategy-shape validation.
- Candidate/Compare: intentionally absent.

