# Original versus Candidate Comparison v0

A Comparison is an immutable derived research artifact. It relates one
Revision-backed Original Run to the real Candidate Run produced for one
Candidate. It is not a Strategy Revision, Candidate, Backtest Run, Experiment,
or acceptance decision, and creating one never executes LEAN or mutates any of
its inputs.

## Comparability contract

Comparison creation requires all of the following:

- the Candidate has an originating Revision-backed Run;
- its Candidate Run belongs to that Candidate;
- both Runs share the Candidate's base Revision lineage;
- Original and Candidate source hashes match their immutable source artifacts;
- the complete validated `BacktestConfig` values are exactly equal;
- both Runs succeeded and have normalized results; and
- both Runs have complete Decision Evidence v2.

Failed Runs, missing evidence, and legacy Evidence v1 are rejected honestly.
Zero changed decisions is a valid Comparison result.

## Three-layer contract

`strategy_diff` is copied from the Candidate's explicit semantic change intent:
Canonical component ID, Canonical field path, typed before value, and typed
after value. It is not reconstructed by diffing arbitrary JSON.

`changed_decision_contexts` is derived from persisted machine Decision Evidence,
never human `RULETRADE_*` traces. Evidence is aligned by session, temporal phase,
evidence kind, structured source provenance, subject asset where applicable, and
a per-key occurrence index. Global event ordinals are deliberately not an
alignment identity. Original-only and Candidate-only events are explicit.

Differences use a closed v0 vocabulary for qualification, ranking, candidate and
primary selection, fallback, Cooldown eligibility, final selection, retained
snapshot behavior, sleeve contributions, user-state mutation, and final targets.
Each difference retains the underlying immutable event records. Contexts with no
behavior change are omitted, and `first_difference` points to the earliest
changed context in deterministic order.

`result_diff` contains exact original, Candidate, and delta values for the
normalized metrics RuleTrade already owns: initial/final value, total return,
total order count, and total fees. Equity curves remain on their Runs; the
Comparison stores their Run IDs rather than duplicating curve payloads. Order
counts are result metrics only—Comparison does not claim order/fill-level causal
alignment.

## Persistence and API

One immutable Comparison payload is persisted per Candidate. Reopening it reads
that payload and does not rerun LEAN or realign mutable frontend state.

- `POST /v1/candidates/{candidate_id}/comparison`
- `GET /v1/comparisons/{comparison_id}`

The POST is idempotent for an already-compared Candidate. The response gives a
future frontend the explicit change, changed decision contexts for “Only
Differences”, structural facts and source provenance for “Why different?”, exact
result deltas, and both Run identities for overlaid equity curves.

This contract deliberately defers Comparison UI, prose explanation, Keep/
Discard, arbitrary Run pairing, generic Experiments, order/fill diffs, and claims
that a strategy parameter scientifically caused market returns.
