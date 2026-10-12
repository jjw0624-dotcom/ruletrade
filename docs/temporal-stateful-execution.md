# Temporal and stateful execution contract

`SemanticProgramV2` remains authoritative. `LeanTemporalProgram` is a typed,
versioned execution plan for the bounded `event-state-daily@1` backend profile;
it is not an authoring model and it is never reconstructed from a projection.

## Observation-boundary order

At each completed daily close the runtime performs these operations in order:

1. Commit the new adjusted-close observation to the daily window. No later
   observation is visible.
2. Visit top-level Event statements in persisted Program order.
3. Evaluate each Event's Values and Condition against the checkpoint produced
   by all earlier statements at this boundary. Missing Values yield Unknown and
   cannot trigger an Event.
4. Apply trigger and occurrence semantics using the prior Event truth/count.
5. For a triggered Event, record its cutoff, then execute nested statements in
   their persisted order. A remembered Value captures the current completed
   observation. A successful transition commits immediately.
6. Later Events therefore see post-transition State and newly captured memory.
   They cannot see a future observation. Event-window checks require a strictly
   later boundary (`current > event cutoff`).
7. After every Event, evaluate policy. The highest supported State override is
   considered before the primary target. The winning policy sees post-transition
   State.
8. Calculate target exposure. `retain` does not mutate it. Submit an order intent
   only when the target changes, preventing duplicate intents.
9. Emit the durable checkpoint observation after policy and order intent. It
   contains clock/cutoff, State, Event cutoffs, and remembered Values. Actual
   fills are emitted separately from `OnOrderEvent`.

Reference replay accepts explicitly addressed State, Event history, counts,
State-entry cutoffs, and memory. It rejects unknown addresses and future cutoffs.
Generated LEAN emits checkpoint evidence, but genuine LEAN process restoration
from that checkpoint is **not proven** and is not advertised.

## Capability gap matrix

| Family | Representable | Reference | LEAN lowerable | Docker differential | Provider | Builder authoring |
|---|---:|---:|---:|---:|---:|---:|
| `event-state-daily@1` synthetic profile | yes | yes | yes | yes | adjusted close | no |
| General Event/State/Memory | yes | yes | no | no | profile-dependent | no |
| Weekly completed context → daily trigger | yes | yes | no | no | adjusted close | no |
| Reference checkpoint replay | yes | yes | n/a | n/a | synthetic | no |
| Genuine LEAN checkpoint restore | n/a | n/a | no | no | n/a | no |
| Intraday/session lifecycle | partial | no | no | no | unavailable | no |

The synthetic thresholds and windows are fixture assumptions, not claims about
the natural-language research corpus. The expanded corpus remains a collection
of fragments unless a case has its own complete formalization.
