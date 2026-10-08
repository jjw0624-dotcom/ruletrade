# Semantic Program Core v1

Semantic Program Core is the representation-neutral layer between typed
expressions and RuleTrade's editors, projections, reference execution, compiler
planning, persistence, and Evidence.

It is introduced without automatically migrating v1 and without pretending that
provider-blocked market fields are executable.

## Canonical compatibility boundary

A v2 Canonical revision may contain:

- the existing compatibility `selection` / `predicate` shape;
- a typed `program`;
- both during the explicit transition.

At least one must exist. Program-native semantic intents address stable statement
IDs, including nested primary/override/fallback Allocation statements; replacement
must preserve the addressed statement kind. A compatibility Selection is not silently converted into a Program.

## Program vocabulary

| Family | Core node | Contract |
|---|---|---|
| Value | `DailyValueNode` | Work 2 typed daily semantics remain unchanged. |
| Cross-section | `CrossSectionalValueV2`, `CrossSectionalAggregateValueV2` | Deterministic rank, percentile, quantile, bucket, min-max, z-score, or mean/median/min/max reduction over one named domain, with explicit coverage provenance. |
| Score | `ScoreValueV2` | Weighted dimensionless Values and Condition-to-points terms, explicit missing/normalization policy, and optional clamp. Scores can be cross-sectionally ranked. |
| Condition | `ComparisonV2`, `StateConditionV2`, `EventWindowConditionV2`, N-of-M, ALL, ANY, NOT | Three-valued Truth; Candidate references require lexical Selection binding; state/Event predicates are Program-only. |
| Selection | `SelectionStatementV2` | Produces a named target set. Shortage and Selection fallback remain distinct. |
| Control | `ConditionalStatementV2` | Evaluates only the selected branch. Unknown explicitly retains or routes to OTHERWISE. |
| Event | `EventStatementV2` | Crosses/became-true/became-false/while-true or scheduled session events, with every/first/ordinal occurrence identity. |
| State | `StateTransitionStatementV2`, `RememberValueStatementV2` | Explicit initialized state, ordered transitions, and checkpointed remembered structural Values. |
| Temporal Value | `EventRelativeValueV2`, `ClockedValueV2`, bars/time-since Event/State | Event-relative references, elapsed observation/calendar-day Values, and last-completed higher-timeframe context without implicit lookahead. |
| Allocation | `AllocationStatementV2` | Equal, exact fixed, positive-score proportional, or inverse-value weights, optional bounds/cash remainder, overlap aggregation, and explicit retain. |
| Policy | `GuardedAllocationStatementV2` | Total guard/override/primary/fallback precedence. |
| Unresolved | `UnresolvedStatementV2` | Fuzzy or unsupported prose is draft-only and cannot execute or persist as valid Canonical truth. |

## Cross-sectional definitions

For an ordered available domain of size (n):

- rank is one-based;
- percentile is (1) for the best member and (0) for the worst when (n > 1);
- a singleton has percentile (1);
- quantile/bucket use explicit bin count;
- direction is explicit;
- member identity is the deterministic tie-break;
- unavailable members remain unavailable rather than receiving zero.

Every cross-sectional observation records requested, available, and missing member
identity. `require_all` reductions become unavailable on missing coverage;
`available_only` remains explicit. Score normalization never turns an unavailable
term into zero.

A cross-sectional ranking domain must be identical to its Selection universe; the runtime never substitutes a visually similar domain. These are semantic profiles, not display labels.

## Event and state semantics

Events compare the current completed-clock Truth with the previous completed-clock
Truth. Unknown is not treated as true.

- rising edge: current true and previous not true;
- falling edge: current false and previous true;
- while true: current true.
- crosses above / became true: the rising-edge profile;
- crosses below / became false: the falling-edge profile;
- scheduled: a completed named session/clock boundary with no invented Condition.

Event occurrence policy is explicit (`every`, `first`, or one-based `ordinal`).
Same-timestamp Events retain separate semantic identities and deterministic Program
order. Event checkpoints include truth, last cutoff, and occurrence count.

State keys must be declared in `initial_state`. A transition checks its optional
from-state and Condition before mutation. Callers may supply prior persisted state;
the Program result returns the next state. Event edge reconstruction uses the incoming State checkpoint, never State already mutated earlier in the current decision. `StateConditionV2` makes state-driven Control explicit and rejects undeclared keys. State is not inferred from holdings.

The execution checkpoint returns both the latest Event cutoffs and current Event Truths; callers feed them into the next decision so edge identity is durable across runs. Event-relative references require a declared Event identity and an integer
observation offset. Missing event history or an out-of-range offset produces an
unavailable Value, never zero. `before`, `after`, and bounded `within` Conditions
refer only to recorded occurrence history. Remembered Values and State-entry cutoffs
are explicit caller checkpoints; missing history stays unavailable.

## Multi-clock contract

Every clock has a timeframe, completed-close boundary, timezone, and
`completed_only=true`.

The reference runtime supports deterministic session, daily, weekly, and monthly
completed boundaries over the pinned daily calendar. Weekly/monthly boundaries are
derived from the calendar, not by reading a future market row. `ClockedValueV2`
uses the last completed boundary at or before the decision cutoff, so a higher-
timeframe context can gate a lower-timeframe trigger without future-bar leakage.
A terminal fixture row is not assumed complete unless its clock explicitly uses
`fixture_end_is_boundary`; production defaults to `not_due`.

## Allocation precedence

`GuardedAllocationStatementV2` has one total order:

1. Evaluate the hard guard.
2. False blocks; Unknown blocks unless the node explicitly allows Unknown.
3. Evaluate overrides by descending unique priority; first true override wins.
4. Otherwise execute the primary allocation when all referenced outputs resolve.
5. Otherwise execute the explicit fallback.
6. Without a resolvable primary or fallback, retain holdings.

Selection outputs follow definite-program-order analysis: an output created only inside one Control branch or an Event is unavailable outside that path. Nested Allocation statements also retain globally unique semantic addresses.

Selection fallback is still part of Selection target determination. It is not
Control OTHERWISE and it is not allocation fallback.

Fixed weights must sum exactly to one. Equal allocation persists no synthetic
weights and derives them only after targets resolve. When multiple legs or groups
resolve to the same asset, their exposure contributions add; later legs never
overwrite earlier capital.

Score-proportional allocation ignores non-positive scores and rejects an all-zero
set; inverse-value allocation requires every selected input to be positive. Bounds
are normalized deterministically. Impossible floors fail, and a cap-induced
remainder requires an explicit cash destination. Retain is never mixed with a
mutation.

## Evidence and identity

Reference execution records:

- revision identity when supplied;
- Program semantic ID;
- dataset snapshot identity;
- exact cutoff;
- executed statement semantic IDs;
- decision kind and outcome;
- Value semantic ID, candidate, observed value/reason, timestamp, and full composed-expression content hash (semantic addresses excluded);
- selected outputs, resulting target weights, retained-holdings outcome, next state, Event cutoffs, and Event Truth checkpoints.
- cross-sectional domain/coverage members, Event counts, State-entry cutoffs,
  remembered Values, selected scores, and the exact policy rule/priority that won.

Unselected Control branches emit no branch-local events or Value observations.

## Corpus boundary

Natural-language corpus cases are classified as:

- `representable`: every required semantic maps to explicit core nodes;
- `provider_blocked`: grammar exists but required data is unavailable;
- `unresolved`: fuzzy wording lacks a measurable definition;
- `deferred`: the semantic family is outside this core.

Classification is not a natural-language parser and never turns fuzzy terms into
invented Canonical meaning.

`FormalizationProvenanceV2` preserves the original phrase. An unresolved phrase
cannot point at executable semantic IDs and blocks execution. A formalized phrase
must name the exact semantic IDs and state its interpretation.

## Representative stress contract

The closure suite pins: price versus SMA; Candidate return versus Group median;
ranked composite factors; quantile-to-points; N-of-M; crosses; Event→State
breakout/retest/confirmation structure; remembered entry levels; higher-timeframe
context with lower-timeframe triggers; positive-score allocation; no-trade
override precedence; and rejected fuzzy phrases. These cases stress general Core
composition. They are not a claim about strategy popularity or a domain-specific
engine.

## Deferred from this closure

- generalized authoring UI expansion;
- Asset Workspace integration;
- v2 historical Research/Evidence UI;
- new provider fields;
- options, fundamentals, PCA, or arbitrary formulas;
- automatic v1 migration.

