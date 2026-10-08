# Semantic Engine / Builder Architecture Lock

This note is the implementation contract for the RuleTrade Builder semantic-engine replacement.

## Authority and boundaries

| Boundary | Contract |
| --- | --- |
| Authoritative semantic source | New Strategies persist `CanonicalStrategyV2` with `SemanticProgramV2`. Historical revisions retain their stored `CanonicalStrategyV1`; no implicit migration occurs. |
| Product semantic projection | `ProductStrategyProjection` is a derived, version-neutral financial view: Portfolio, Investment/Sleeve, Assets, Qualification, Selection, Fallback, Split, Allocation, Timing/Rebalance, and Control. It is not persisted and does not mirror the Program AST. |
| Builder selection/address identity | `ProductAddress` identifies product meaning plus canonical provenance. V2 provenance uses stable semantic IDs; V1 compatibility provenance uses stable component IDs. Array indexes are never edit addresses. |
| Semantic transformation | The Builder emits `ProductOperation`. V2 operations are validated and applied atomically by the backend against an expected source hash. V1 historical editing uses the maintained structural-authoring boundary. UI projections and Blockly are never mutation sources. |
| Draft boundary | Incomplete Values, Conditions, Selection settings, fallback targets, split weights, and control branches remain local drafts. Only a complete product operation can replace canonical semantics. Drafts block Save and Test. |
| CAS boundary | Each committed V2 operation includes the source hash of the canonical snapshot it was based on. Stale responses and stale backend requests cannot replace a newer snapshot. Persisted Save additionally uses the parent Revision ID. |
| Persistence boundary | Only validated `CanonicalStrategyV1` or `CanonicalStrategyV2` snapshots enter immutable Revision records. Product projections, editor state, Blockly state, and drafts are ephemeral. |
| Execution boundary | Executability is derived from committed semantics and reported separately from authorability, reference validity, lowering, provider readiness, and runtime availability. Execution lowers canonical semantics to typed plans; it never compiles UI state. |
| Historical v1 compatibility | Historical V1 remains readable, editable through proven V1 operations, and executable through the maintained V1 IR/LEAN pipeline. Compatibility projection maps it into the same product language without rewriting the Revision. |

## Production topology

```text
Strategy Revision (V1 or V2)
        |
        +--> canonical-specific validation/compatibility boundary
        |
        v
ProductStrategyProjection (derived)
        |
        +--> one Builder state, selection, drafts and navigation
        +--> Structure / Blocky / Flow / Rules / Summary / Guide / AI
        |
        +--> ProductOperation
                |
                +--> V2 atomic semantic transformation + source-hash CAS
                +--> V1 maintained compatibility authoring

Committed canonical
        |
        +--> capability analysis
        +--> typed execution plan --> generated C# --> LEAN
```

## Defaults

An empty V2 Strategy contains only a valid retain/no-op Program skeleton required by the Program Core invariant. That bootstrap statement is hidden from product projections. Adding an Investment creates only its identity and explicit asset membership. Selection, Qualification, Fallback, split allocation, and timing remain separate product operations. Where a complete Selection requires an executable allocation target, the transformation creates Selection and its equal-weight allocation atomically and exposes both as one completed product action.

## Capital quantity contract

Capital quantities are named by their denominator and may not be substituted merely because both happen to total 100%.

| Quantity | Meaning and range | Canonical authority | Product display / editing |
| --- | --- | --- | --- |
| Portfolio routing share | Fraction of total Portfolio capital routed to one direct Investment/Sleeve; `[0, 1]`, and sibling routes sum to `1` | V1 `portfolio_sleeve@1.config.allocation`; V2 fixed Allocation group-leg `weight` | Split and each child Investment; edited only by Split controls |
| Investment parent share | Product name for that same Portfolio routing share when viewed on the child Investment | Same field as Portfolio routing share; never a separately stored value | Investment Structure/Flow/Blocky/Inspector; redundant implicit `100%` may be omitted for a single Investment |
| Internal allocation total | Normalization total within an Investment after selection; normally `1` | V1 local target generator `total`; V2 Selection-target Allocation method/legs | Described as an internal selected-asset policy, never as the Investment's Portfolio share |
| Selection allocation policy | How qualifying selected assets divide the Investment's parent share (`equal` in the maintained production subset) | V1 target generator; V2 Allocation targeting the Selection output | Allocation toolbox/rules use “selected assets” language; not editable until another supported method exists |
| Final target exposure | Flattened executable target weight after parent-share scaling and symbol aggregation | Derived by compiler/lowerer, not authored | Execution diagnostics/results only; not reused as a Builder routing share |
| Cash remainder | Unallocated remainder explicitly directed to cash when a supported allocation permits it | Allocation `cash_remainder_asset` and cap semantics | Shown only when present and supported; never inferred from missing routes |

`ProductCapitalSemantics` is a derived typed annotation on the existing product projection. It records the canonical source of a displayed share/policy; it is not another persisted capital IR. V1 local sleeve targets normalize to `1` and are then scaled by sleeve allocation. V2 equal allocation across a Selection similarly divides only that Investment's routed capital. For example, a 50/50 Portfolio Split with equal Selection allocation means each Investment receives 50% of Portfolio—not 100%—while each Investment independently distributes 100% of its own sleeve capital.

## Adapter budget

Only two canonical adapters are allowed at the Builder boundary:

1. V1 canonical graph to/from product projection/operations for historical compatibility.
2. V2 Semantic Program to/from product projection/operations for new Strategies.

Representation-specific adapters may format the common projection, but may not reinterpret canonical meaning or own mutation logic.

