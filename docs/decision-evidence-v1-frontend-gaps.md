# Decision Evidence v1 frontend gaps

This report records only execution facts needed by the current chart-first and asset-centric research flow. The frontend continues to render absence as unknown, not as a negative fact.

## Must add before Candidate / Compare

- **Required selection cardinality.** `selection` records ranked, candidate, and selected sets, but not the configured required count. Add an optional, backward-compatible `required_count` to selection evidence. Without it the UI can say “primary selection was insufficient,” but cannot truthfully say “needed 2” or explain the exact cutoff.
- **Explicit signal outcome.** Cooldown evidence has `signal_candidate`, but selection evidence has no general per-asset signal-present/signal-absent fact. Add a per-evaluated-asset signal outcome (or an equivalent explicit stage result). Absence from an array must remain unknown for legacy evidence.
- **Stable stopping reason.** The UI can deterministically derive a first stop for the v1 filter/rank/cooldown shapes it recognizes. Candidate/Compare needs a backend-owned reason/stage identity so two runs can align decisions without duplicating execution semantics in presentation code.

## Useful soon

- **Evaluated-universe membership.** Filter evaluations prove membership for that filter, and random selection has a universe, but there is no uniform session-level statement of which assets entered each decision path. This is needed before claiming “not evaluated” or “not in universe.”
- **Source field path.** `component_id` supports component-level navigation. An optional source field/config path would let Guided focus the exact editable field without a frontend mapping that duplicates backend semantics.
- **Decision-to-order linkage.** A target decision is not an order. A future order/trade surface needs explicit IDs linking targets to resulting orders and fills.

## Can defer

- Rich trade lifecycle details until an order/trade product surface exists.
- Human-friendly evidence labels owned by the backend. Deterministic frontend wording is sufficient while the evidence facts and source identities remain versioned.

No backend contract was changed in PR #27. These are proposed additive fields for a later evidence version; the frontend does not infer them for v1 or legacy runs.
