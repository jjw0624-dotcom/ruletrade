# Semantic Composition Model v1

Status: **MVP 1 — current headless domain contract**. The production Blocky Program Composer and Flow Capital Composer are future work.

## Authority and lifecycle

`CanonicalStrategyV1` remains the only persisted Strategy truth. A representation is derived and disposable:

```text
Canonical → semantic facts → Flow or Logic projection → semantic intent
          → existing Authoring/Composition Contract → validated Canonical → reproject
```

Flow/Blockly serialization, visual IDs, projection IDs, and any future draft are not Revision, compiler, Test, Evidence, or AI authority. Evidence continues to identify persisted Canonical components with `component_id` and optional `field_path`.

No Canonical schema change is required for v1.

## Shared semantic vocabulary

| Category | Meaning | Current Canonical mapping |
|---|---|---|
| Universe | Instruments considered | `asset_set@1` plus referenced asset-set definition |
| Measure | Value calculated for candidates | `trailing_return@1` |
| Eligibility | Candidate-level admission filter | `filter@1` in a selection pipeline |
| Predicate | Control-flow branch condition | `rule@1.condition`; not in the executable compiler subset |
| Selection | Ordering and choosing candidates | aggregate of `trailing_return@1`, optional `filter@1`, `rank@1`, `top_n@1`; or `random_select@1` |
| Action | Effect performed by a Strategy | current executable `rebalance@1`; Canonical rule actions remain outside the current compiler subset |
| Allocation | Capital/weight assignment | `equal_weight@1`, sleeve allocation fields |
| Constraint | Behavioral modifier | `cooldown@1` |
| Portfolio | Ownership/capital topology | `portfolio@1`, `portfolio_sleeve@1`, legacy `merge_targets@1` |
| Timing | Evaluation or execution schedule | daily/monthly/quarterly event component plus entrypoint |
| State | Strategy/position memory | Canonical state definitions; current executable path only synthesizes internal cooldown state |

These categories are not aliases. In particular:

- Eligibility asks whether one candidate can participate in Selection.
- Predicate selects a control-flow branch.
- Selection chooses assets; Action changes exposure; Allocation assigns capital.
- Constraint modifies behavior and is not automatically a sequential Action.

## Derived semantic identity

An aggregated visual semantic uses `SemanticProjectionRef`:

```text
primary_component_id
related_component_ids[]
semantic_role
optional field_path
optional definition_id
```

For “Choose 2 strongest by 126-bar return,” Top N is primary and Universe, Measure, optional Eligibility, and Rank are related. All IDs are persisted Canonical IDs. The derived reference does not replace semantic address or Evidence provenance.

## Flow semantic projection

Flow answers **where capital, ownership, and exposure flow**. Its model has representation-specific units and edges:

- Entity: Portfolio, Sleeve, Universe.
- Distribution: Allocation, split/merge topology.
- Routing: aggregated Selection and selection fallback.
- Action: current Rebalance effect.
- Timing annotation: evaluation/refresh/rebalance timing.

Measure, Eligibility, rank direction, exact predicate internals, and Cooldown normally remain compressed or Inspector detail. They retain exact fact and component references. Flow is intentionally not a component listing.

## Logic (future Blocky) semantic projection

Logic answers **what decision program executes and in what control-flow order**:

```text
Context/Object → 0..N Scripts → Trigger → ordered Statements
```

Contexts are current Investment, Sleeve, or Portfolio scopes. Independent entrypoints create independent Scripts, so monthly sleeve refresh and quarterly portfolio execution are not forced into one false global sequence.

Statement families are:

- Control: future `IF Predicate / OTHERWISE` branch topology.
- Selection: one natural aggregate, such as “Choose 2 strongest,” with Universe, Measure, Eligibility, ordering, and count recoverable.
- Action: current executable effect, presently Rebalance.
- Portfolio operation: compound Allocation/topology semantics.

Cooldown is a Selection modifier. Current Fallback is a **selection fallback** (“primary selection is incomplete”), not a control-flow `OTHERWISE`. A future market-regime `OTHERWISE` requires Predicate/control grammar and must remain distinct.

Statements in a Script are semantically ordered. Simultaneous sleeve allocations are one `compound_allocation` statement, not misleading sequential allocation actions. Parallel sleeves are separate Contexts.

## Information compression

Every semantic fact in a supported Strategy receives one of these explicit placements per representation:

- `PRIMARY_VISIBLE`
- `COMPRESSED_RECOVERABLE`
- `INSPECTOR_DETAIL`
- `NOT_MEANINGFUL_IN_THIS_PERSPECTIVE`
- `UNSUPPORTED`

There is no `LOST` state.

| Semantic fact | Flow | Logic/Blocky |
|---|---|---|
| Portfolio split/sleeves | PRIMARY_VISIBLE | COMPRESSED_RECOVERABLE as Context/topology |
| Universe | PRIMARY_VISIBLE | PRIMARY_VISIBLE in Context/Selection |
| Measure/lookback | COMPRESSED_RECOVERABLE / INSPECTOR_DETAIL | Selection detail / INSPECTOR_DETAIL |
| Eligibility | COMPRESSED_RECOVERABLE | Selection detail / Inspector |
| Control predicate | routing summary where meaningful | PRIMARY_VISIBLE control statement |
| Rank direction | INSPECTOR_DETAIL | Selection detail |
| Top N | PRIMARY_VISIBLE selection summary | PRIMARY_VISIBLE Selection statement |
| Selection fallback | PRIMARY_VISIBLE routing | Selection modifier, not control OTHERWISE |
| Schedule | PRIMARY_VISIBLE annotation | PRIMARY_VISIBLE Trigger |
| Cooldown | INSPECTOR_DETAIL | Selection modifier |
| Allocation | PRIMARY_VISIBLE | compound portfolio operation/detail |
| State | NOT_MEANINGFUL unless exposure/state is represented | Context/control detail |

## Headless contracts

`project_semantic_composition(CanonicalStrategyV1)` returns shared facts plus distinct `FlowSemanticProjection` and `LogicSemanticProjection`. The API equivalent is:

```text
POST /v1/canonical/strategies/semantic-projections
```

Semantic authoring intents are UI-independent and resolve into the existing authoring grammar:

- `configure_selection`
- `configure_eligibility`
- `configure_allocation`
- `configure_constraint`
- `configure_timing`
- `attach_fallback`
- `create_portfolio_split`
- `configure_predicate` (explicitly rejected until executable predicate authoring exists)

They apply through:

```text
POST /v1/canonical/strategies/semantic-intents/apply
```

The response contains backend-validated Canonical plus its reprojection. Invalid intents are atomic. This endpoint is headless and representation-independent; it does not encode Blockly or xyflow gestures.

Guide recipes remain macros. “Add defensive allocation” may issue several composition mutations, but the resulting Universe, Sleeve, Allocation, Portfolio, and Timing semantics are exposed rather than an opaque recipe node.

Rules maps clauses independently: “Every month” is Timing; assets are Universe; trailing return is Measure; “above 0%” is Eligibility; strongest/top 2 is Selection; “use TLT if incomplete” is selection fallback.

## Atomic versus draft gesture matrix

| Future gesture | Atomic Canonical | Reason | Draft |
|---|---:|---|---:|
| Edit Choose count/lookback | yes | one validated field batch | no |
| Edit Eligibility threshold | yes | existing filter remains executable | no |
| Edit Cooldown duration | yes | existing constraint remains connected | no |
| Edit two-sleeve allocation | yes | one simultaneous validated operation; total must remain 1 | no |
| Edit Timing | yes | existing entrypoint retains exact event identity | no |
| Attach current selection fallback | yes | existing semantic operation creates complete owned fallback | no |
| Add ranked Selection to a simple investment | yes | atomic Measure + Rank + Top N splice | no |
| Add Condition to ranked Selection | yes | atomic filter splice | no |
| Create complete supported two-sleeve split | yes | one complete composition batch | no |
| Drop disconnected Measure | no | required assets input is absent | LogicDraft |
| Drop disconnected Rank/Choose | no | typed required inputs/consumer path are absent | LogicDraft |
| Add IF before predicate and branches exist | no | incomplete control structure; current compiler grammar also lacks it | LogicDraft |
| Add Split with one empty branch | no | sleeve local targets and exactly-two-sleeve portfolio invariants fail | FlowDraft |
| Connect complete compatible replacement path atomically | yes | disconnect/connect batch ends valid | no |
| Disconnect and leave a required input empty | no | final Canonical validation rejects it | representation draft if gesture must persist |

The generic composition contract already supports `create_component`, `create_asset_set`, `set_component_field`, `connect`, `disconnect`, and `remove_component`. It intentionally declares `incomplete_working_states = false` and validates only the completed batch.

## Draft boundary — directional, not implemented

The model proves two narrow future needs:

- `LogicDraft`: temporarily incomplete IF/predicate/branch structures or disconnected program primitives.
- `FlowDraft`: temporarily incomplete split/branch topology.

They should be representation-specific, not a universal AST. Any unresolved draft must block Save and Test. Drafts never become Revision, compiler input, Test input, Evidence provenance, or authoritative AI Strategy context.

## Current fixture proof

Headless tests cover One Investment, ranked momentum, qualification, fallback, Cooldown, two-sleeve portfolio, periodic rebalance, and independent schedules. They assert:

- every Canonical component is covered by a semantic fact or exact aggregate reference;
- every fact receives explicit Flow and Logic placement;
- selection aggregation retains all component IDs;
- independent schedules remain multiple Scripts/Triggers;
- Flow and Logic structures differ while referring to the same facts;
- compiler-valid semantic edits return valid Canonical;
- incomplete Measure and Sleeve gestures fail atomically.

## Extension stress tests

These are architectural directions, not implemented grammar:

| Strategy | Flow | Blocky | Needed vocabulary expansion | Replacement? |
|---|---|---|---|---|
| Multi-condition regime | branch routing summary | Predicate tree + IF | Predicate boolean composition | no |
| Nested risk-on/off | nested routing | nested Control statements | Predicate/control nesting | no |
| Volatility targeting | allocation policy | Measure + compound Allocation | volatility Measure/computed Allocation | no |
| Risk parity | portfolio allocation | compound Allocation | covariance/risk Measures | no |
| Stop-loss/re-entry | exposure/action annotation | Predicate + Action + State/Constraint | position State, exit/re-entry Actions | no |
| Multi-timeframe | timing annotations | multiple Scripts/Triggers | additional Timing primitives | no |
| Pairs trading | paired exposure entity | Measure + Predicate + paired Actions | pair Context/Measure/Actions | no |
| Covered call | position/exposure topology | option Action script | option instrument and Action vocabulary | no |
| Collar | compound position topology | simultaneous option Actions | option Allocation/Action bundle | no |
| Tax-loss harvesting | replacement exposure path | Predicate + Constraint + Actions | tax-lot State/Constraint/Actions | no |

These require vocabulary/compiler growth, not a universal visual AST or replacement of the Flow/Logic responsibilities.

## Explicit boundaries

- Current Predicate representation can preserve Canonical expression structure, including existing boolean expression data, but the maintained executable compiler path does not support `rule@1` or state definitions.
- Current fallback is only selection fallback.
- Portfolio v0 is exactly two sleeves.
- Current schedules are daily/monthly/quarterly; composition does not create new event/effect components.
- Production Flow and Blocky remain unchanged by this contract PR.
- Validation, Forward, Challenge, options, arbitrary wiring, and a production draft system remain deferred.
