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
IDs. A compatibility Selection is not silently converted into a Program.

## Program vocabulary

| Family | Core node | Contract |
|---|---|---|
| Value | `DailyValueNode` | Work 2 typed daily semantics remain unchanged. |
| Cross-section | `CrossSectionalValueV2` | Deterministic rank, percentile, quantile, or bucket over one named domain. Missing members do not receive a rank. Ties use stable member identity. |
| Score | `ScoreValueV2` | Explicit non-zero weighted dimensionless terms; missing policy is either require-all or renormalize-available. |
| Condition | `ComparisonV2`, `StateConditionV2`, ALL, ANY, NOT | Three-valued Truth; Candidate references require lexical Selection binding; declared state is Program-only and cannot filter Eligibility. |
| Selection | `SelectionStatementV2` | Produces a named target set. Shortage and Selection fallback remain distinct. |
| Control | `ConditionalStatementV2` | Evaluates only the selected branch. Unknown explicitly retains or routes to OTHERWISE. |
| Event | `EventStatementV2` | Rising edge, falling edge, or while-true at a named clock. |
| State | `StateTransitionStatementV2` | Explicit initialized key and guarded transition; false/Unknown do not mutate state. |
| Event-relative Value | `EventRelativeValueV2` | Reads a typed Value at an explicit observation offset from a named Event occurrence. |
| Allocation | `AllocationStatementV2` | Equal or exact fixed weights over asset/group/Selection/cash/retain targets. |
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

A cross-sectional ranking domain must be identical to its Selection universe; the runtime never substitutes a visually similar domain. These are semantic profiles, not display labels.

## Event and state semantics

Events compare the current completed-clock Truth with the previous completed-clock
Truth. Unknown is not treated as true.

- rising edge: current true and previous not true;
- falling edge: current false and previous true;
- while true: current true.

State keys must be declared in `initial_state`. A transition checks its optional
from-state and Condition before mutation. Callers may supply prior persisted state;
the Program result returns the next state. `StateConditionV2` makes state-driven Control explicit and rejects undeclared keys. State is not inferred from holdings.

The execution checkpoint returns both the latest Event cutoffs and current Event Truths; callers feed them into the next decision so edge identity is durable across runs. Event-relative references require a declared Event identity and an integer
observation offset. Missing event history or an out-of-range offset produces an
unavailable Value, never zero.

## Multi-clock contract

Every clock has a timeframe, completed-close boundary, timezone, and
`completed_only=true`.

The reference runtime supports deterministic daily, weekly, and monthly boundary
gating over the pinned daily calendar. It does not fabricate intraday bars or
implicitly align incomplete observations. A terminal fixture row is not assumed to close a week or month unless the clock explicitly declares `fixture_end_is_boundary`; production defaults to `not_due`. Cross-clock Value alignment beyond
as-of completed observations remains an explicit future profile.

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
weights and derives them only after targets resolve.

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

Unselected Control branches emit no branch-local events or Value observations.

## Corpus boundary

Natural-language corpus cases are classified as:

- `representable`: every required semantic maps to explicit core nodes;
- `provider_blocked`: grammar exists but required data is unavailable;
- `unresolved`: fuzzy wording lacks a measurable definition;
- `deferred`: the semantic family is outside this core.

Classification is not a natural-language parser and never turns fuzzy terms into
invented Canonical meaning.

## Deferred from this closure

- generalized authoring UI expansion;
- Asset Workspace integration;
- v2 historical Research/Evidence UI;
- new provider fields;
- options, fundamentals, PCA, or arbitrary formulas;
- automatic v1 migration.
