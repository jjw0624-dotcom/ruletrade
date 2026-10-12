# Perspective translation v2

## Authority and evidence

`SemanticProgramV2` is the only committed strategy meaning. `ProgramWorkingDraft`
stores incomplete intent and layout. Capital Flow and Decision Logic manifests
are immutable derivatives; neither is executable and neither is persisted as a
Strategy revision.

The attached Blueprint, Perspective Translation v2 and Perspective Data v1
packages were reviewed in full. Their 169 records are natural-language
fragments, not 169 strategies. Their ten examples are design proposals. The
repository fixture and validator win whenever an illustrative assumption differs.

The production boundary is:

`SemanticProgramV2 → perspective manifest → ReactFlow/Blockly rendering`

and in reverse:

`visual gesture → DraftIntent → typed V2 operation → validation → source-hash CAS`

Blockly XML, Flow coordinates and presentation labels never enter execution.

## Reconciliation

| Proposed concept | Repository result | Reconciliation |
|---|---|---|
| Portfolio, Investment/Sleeve | Compatible | Canonical definitions provide ownership; views derive nodes. |
| Fixed Split | Compatible | Flow owns parallel `ownership_share` routes. It is not a Blocky sequence. |
| Selection primary/fallback | Compatible after adjustment | Fallback is `fallback_on_shortage`, never synthesized as IF/ELSE. |
| Selected exposure | Projection-only | It may share a Selection address and cannot be independently deleted. |
| Rebalance | Compatible | It resolves to a Program clock; no schedule is invented. |
| Value/Condition/Score | Compatible | Decision Logic only. Flow includes them only through an actual capital-routing policy. |
| Event/State/Memory | Compatible | Decision Logic preserves ordering, identity and clocks; State transitions are not capital edges. |
| Policy precedence | Compatible | Guard → priority override → primary → fallback → retain remains explicit. |
| Single QQQ example | Adjustment required | Attachment has no verified Canonical fixture; use an explicit fixed asset Allocation. |
| SMA example cash branch | Adjustment required | Repository `price-over-sma` does not contain that target branch, so the view cannot invent it. |
| Growth + Defensive 70/30 | Adjustment required | The repository's proven independent-sleeve fixture has its own concrete selections/policy and is not claimed byte-equivalent to the illustration. |
| Inverse volatility | Incomplete/reference-only | Missing lookback, clock and nonpositive policy block commitment/execution. |
| Arbitrary route deletion/reparenting | Execution-unsupported | Kept as an explained draft until a typed semantic operation exists. |
| Coordinates and viewport | Reference-only layout | Stored in Working Draft v2; semantic identity is unchanged. |

Machine-readable reconciliation and capability evidence lives in
`corpus/perspective-translation-corpus.json`.

## Manifest contracts

`InternalSemanticManifest` records the Canonical fingerprint and address index.
`CapitalFlowManifest` has capital nodes and typed edges:

- `ownership_share`
- `conditional_target`
- `fallback_on_shortage`
- `target_contribution`
- `realization`

`DecisionLogicManifest` has context, financial-intent blocks and typed
connections. Each view object carries its source semantic addresses, meaning
role, scope, conditionality, edit operation and independent capability.

The JSON schemas are:

- `corpus/capital-flow-manifest.schema.json`
- `corpus/decision-logic-manifest.schema.json`

Both perspectives carry the same Canonical semantic fingerprint. They are not
required to have the same nodes, hierarchy or cardinality.

## Progressive Decision Logic

| Level | Product surface | Meaning |
|---|---|---|
| 0 | schedule, choose, allocate, fallback, rebalance | Investor intent macros |
| 1 | FROM, WHERE, ORDER, TAKE, shortage, nested Condition, Score terms, Event/State | Expanded decision logic |
| 2 | operator version, axis/unit, missing/Unknown, completion boundary, normalization, checkpoint identity | Inspector detail |

Collapse/expand is layout state. It does not remove semantic addresses or alter
Canonical meaning.

## DraftIntent outcomes

Every visual gesture has one explicit result:

| Outcome | Meaning |
|---|---|
| `layout_only` | Position, viewport or equivalent projected connection changed; no semantic effect. |
| `draft_only` | Meaningful but incomplete intent remains recoverable in Working Draft. |
| `ready` | A typed V2 operation can be validated and committed with CAS. |
| `invalid` | The requested relationship violates a typed invariant. Canonical is unchanged. |
| `unsupported` | The relationship is meaningful but has no production operation. Canonical is unchanged. |

The UI does not discover availability by sending a failing backend mutation.
Technical diagnostics remain in draft state while product messages avoid
compiler/lowering vocabulary.

## Equivalence

Visual forms are equivalent only when the committed Canonical semantic identity
is equal. In particular, equivalence preserves universe, eligibility, ranking,
ties, shortage, fallback, allocation, clocks, Unknown behavior, State/Event
ordering and policy precedence for all cutoffs. Similar labels or equal targets
for one fixture are insufficient.

Examples that may be equivalent after full comparison:

- combined Top N + equal allocation and separate Selection/Allocation blocks;
- collapsed and expanded nested Conditions;
- a guarded target in Decision Logic and its conditional capital route in Flow.

Selection shortage fallback and generic OTHERWISE are never equivalent by
presentation alone. Parallel sleeves and sequential statements are never
equivalent by presentation alone.

## Persistence and capability

Committed semantics use existing Strategy/Revision persistence and source-hash
CAS. Working Draft v2 stores concepts, tentative connections, Flow/Blocky
positions, viewport, progressive disclosure and diagnostics per strategy. A v1
draft is migrated in memory without losing its concept or geometry.

Representable, reference-evaluable, backend-lowerable, Docker-verified,
provider-supported, UI-authorable and runtime-available remain independent.
Projection derivation does not invoke lowering or Docker.

## Deliberate limits

No new Builder, route, canonical strategy format, execution engine or UI-owned
semantic state was introduced. Arbitrary route deletion, arbitrary nested
reparenting, dynamic/PIT universes, broad provider instruments and unformalized
inverse-volatility input remain gated. Graphical browser acceptance is a
separate gate from mounted DOM tests.
