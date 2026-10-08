# Generalized Semantic Program Authoring v1

`SemanticProgramV2` is the authoritative authoring model. The browser never persists a UI AST: complete edits are sent as typed semantic intents with the source Canonical hash, validated by the backend, and returned as a complete Canonical replacement.

## Addressing and lifecycle

Statements are addressed by stable `semantic_id`, including statements nested in Control and Event branches. Insert, move, remove, Selection, Condition, Value, Event, State transition, Allocation, policy, and formalization operations never use array position as semantic authority. A stale source hash is rejected before validation.

Incomplete fields stay in local editor state. Save and Test are gated while a working edit is unfinished or rejected. A valid edit auto-applies; there is no field-level Apply button. Undo and redo replay a previous valid Program through the same backend `set_semantic_program` validation boundary.

## Shared semantic editors

The shared Value and Condition shell is reused for Predicate, Eligibility, ranking/Score, Event, State transition, Guard, Override, and remembered Values. Values are displayed as complete financial meanings. Progressive operations include adjusted-close daily Values, bounded arithmetic and absolute value, member rank/percentile/quantile/bucket/normalization, member aggregation, and Score composition. Conditions support Comparison, ALL, ANY, NOT, and N-of-M.

Candidate references are available only under Selection scope. Cross-sectional expressions preserve their named domain. Provider capability remains honest: adjusted-close operators are executable profiles; Volume and raw OHLC are known but unavailable with the maintained provider.

## Program, capital, and policy

Blocky presents statement order and Control/Event/State/Selection/Allocation structure. Flow deliberately projects only capital, routing, Selection, and policy units; expression internals remain in Inspector. Rules and Summary are read projections of the same committed Program.

Allocation authoring preserves equal, fixed, score-proportional, inverse-volatility, floor/cap, cash remainder, and retain semantics. Guard, priority Override, primary, Fallback, and retain stay distinct. The backend rejects retain mixed with target mutation and preserves overlapping exposure aggregation.

## Capability boundary

Program Event, State, cross-sectional, Score, and advanced policy semantics are authorable and reference-evaluable but currently `backend_lowerable=false`. The editor states that boundary before execution and disables Test. Work 2 adjusted-close Value profiles keep their verified numerical capability; authorability does not promote general Program lowering.

Unresolved natural-language phrases are non-executable statements. Formalization is an atomic operation that replaces the unresolved statement and records the original phrase, explicit interpretation, and replacement semantic identity.

## Persistence and compatibility

New templates are Program-native and begin with a valid retain-allocation skeleton. Program documents round-trip through ordinary immutable v2 revisions; semantic IDs and formalization provenance are Canonical data. Selection-shaped v2 snapshots remain on their explicit compatibility editor. v1 Strategies remain v1 and are never migrated automatically.
