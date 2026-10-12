# Temporal execution reliability and multi-clock contract

`SemanticProgramV2` remains authoritative. `LeanTemporalProgram` is a typed,
versioned backend plan for two bounded profiles; it is not an authoring model.

## Reliability capability-gap audit

| Capability | Daily profile | Weekly → daily profile | General family |
|---|---:|---:|---:|
| Representable | yes | yes | partial |
| Reference-evaluable | yes | yes | partial |
| Backend-lowerable | yes | yes | no |
| Docker-verified | yes | yes | no |
| Checkpoint-exportable | yes | yes | no |
| Checkpoint-restorable | yes | yes | no |
| Fresh-process replay verified | yes, bounded fixture | not separately claimed | no |
| Provider-supported | adjusted close | adjusted close | profile-dependent |
| UI-authorable | no | no | no |

`event-state-daily@1` and `event-state-multiclock@1` are the only promoted
profiles. This does not promote arbitrary Event/State graphs or clocks.

## Boundary order

At each completed daily bar the runtime:

1. commits the adjusted close;
2. when the ISO week changes, exposes the prior week's last observed trading
   close and records both its source cutoff and the current availability cutoff;
3. visits Events in persisted statement order;
4. evaluates T/F/U conditions against only committed observations and the
   checkpoint produced by earlier statements at the same boundary;
5. records Event occurrence, memory captures, and State transitions immediately;
6. applies policy in `guard → priority override → primary → fallback → retain`
   order as supported by Program Core;
7. submits a semantic order intent only when the target changes; and
8. emits a complete checkpoint after policy evaluation.

An incomplete or missing weekly observation is Unknown, never zero or False.
The first week in a fixture has no completed weekly value. Holiday-shortened
weeks use their last actual observed trading bar. Future rows cannot change an
earlier cutoff.

## Checkpoint schema and integrity

`ruletrade-temporal-checkpoint@1` contains:

- strategy semantic identity and execution-profile identity;
- snapshot identity, asset universe, statement order, operator versions;
- clock, cutoff, and monotonic boundary index;
- State plus State-entry cutoffs;
- Event cutoffs, truth values, and occurrence counts;
- remembered decimal Values, capture cutoffs, and Value semantic identities;
- weekly in-progress and last-completed aggregates;
- last semantic policy target and intended portfolio target; and
- a SHA-256 hash over canonical JSON excluding the hash field.

Import rejects incompatible schema/profile/operator versions, a mismatched
semantic hash or snapshot, asset/statement-order mismatch, future checkpoints,
unknown State/Event/Memory addresses, incomplete remembered Values, invalid
truth values, and a corrupted integrity hash. Technical provenance remains in
the checkpoint/import observations.

## Fresh-process proof and brokerage boundary

`make check-lean-temporal-reliability` runs one continuous LEAN backtest and a
four-process interrupted chain. Each process is a new Docker LEAN algorithm.
The host exports the prior process's structured checkpoint to a sealed JSON
file; the next generated algorithm validates and imports it. Cut points cover
pre-Event, post-transition/active-window, and post-fill states. All semantic
boundaries, Event/State/memory results, policies, targets, and checkpoints must
match the continuous run exactly.

LEAN brokerage internals and order tickets are not serializable through this
bounded compiler harness. After a post-fill restart, the fresh account restores
the intended target with an explicitly observed `brokerage_reconstitution`
order. That order is not counted as a new semantic intent. Native brokerage
state/order-ticket restoration remains **NOT PROVEN**.

## Evidence and exclusions

The common `RULETRADE_EVIDENCE_V2` protocol includes checkpoint export/import,
restoration identity, weekly completion/availability, daily cutoff, Event/State
trace, policy result, target, order intent, portfolio reconstitution, and fills.
Absent evidence is a failure.

Still **NOT PROVEN**: arbitrary Event/State workflow graphs, arbitrary
multi-clock composition, intraday/session execution, native brokerage restore,
live trading, broad provider coverage, and Builder authoring. The Builder UI is
unchanged.
