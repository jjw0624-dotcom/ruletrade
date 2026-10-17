# Intent-first unified authoring

Status: **CURRENT**

## Contract

`SemanticProgramV2` remains the only committed strategy meaning. Flow, Blocky,
Structure, Rules, Summary, and Inspector are projections over that meaning.
`ProgramWorkingDraft` is recoverable editor state: it may contain an incomplete
`FinancialIntentDraft`, visual positions, focus, and viewport, but it is never
compiled or executed directly.

The commit boundary is deliberately atomic:

1. a user begins with an asset, capital route, condition, timing, or allocation;
2. the Builder stores explicit values and unresolved requirements in one draft;
3. readiness is classified as `incomplete`, `ready`, or `unsupported` without
   attempting backend lowering;
4. only a ready draft becomes one typed intent operation;
5. the server expands that operation into typed values, conditions, clocks,
   selections, events, state, memory, and allocations;
6. normal semantic validation and CAS apply to the complete replacement.

No incomplete semantic scaffolding, visual coordinates, or raw Blockly/Flow
objects enter Canonical. Changing views does not change meaning.

## Reusable operations

| Product intent | Atomic operation | Committed meaning |
| --- | --- | --- |
| Hold one asset | `commit_single_asset_intent` | one Investment, explicit asset, direct fixed target, explicit rebalance clock |
| Market regime rotation | `commit_market_regime_rotation_intent` | trend Condition, IF/OTHERWISE, ranked Selection, equal selected allocation, defensive ELSE |
| Growth + Defensive | `commit_split_portfolio_intent` | Growth Selection and shortage fallback, fixed 70/30 parallel exposure, defensive asset |
| Weighted Score | `commit_weighted_score_intent` | two typed return terms, missing policy, Top N, positive score-proportional allocation |
| Breakout sequence | `commit_temporal_sequence_intent` | maintained Event/State/Memory recipe with bounded retest and confirmation |
| Weekly context + daily signal | `commit_multi_clock_policy_intent` | completed weekly context, daily signal, Score Selection, risk precedence, Unknown policy |

These operations are financial concepts, not strategy-specific builders. The
server owns generated identities and composition details. Temporal and
multi-clock edits outside the maintained formalizations remain recoverable,
explicitly unsupported drafts; they are never approximated.

## Simple monthly intent

“Invest in QQQ every month” may start from Assets, Rebalance, Investment/Flow,
or Allocation. The draft requires all of:

- asset `QQQ`;
- monthly timing;
- whether timing means rebalance or a new contribution.

Rebalance commits a direct QQQ target without inventing a Selection. Recurring
contribution is preserved as unsupported product intent because the committed
strategy model does not yet define cash inflow semantics. It never silently
becomes rebalance.

## Complex acceptance meanings

| ID | Explicit formalization | Important distinction |
| --- | --- | --- |
| A | monthly; QQQ adjusted close > SMA(200); rank QQQ/VGT/SOXX/SCHG by return(126); Top 2; equal; OTHERWISE TLT | defensive ELSE is not Selection shortage fallback |
| B | Growth 70%, Top 2 by return(126), require full, shortage TLT; Defensive 30% IEF; monthly | parallel sleeve exposure and scoped fallback |
| C | `0.6 × return(21) + 0.4 × return(63)`; require all terms; Top 3; proportional positive Score; monthly | Score missing/nonpositive behavior is explicit |
| D | QQQ breakout threshold 12; remember level; retest within 3; confirmation within 2; expire/reset | ordered Event/State/Memory semantics |
| E | completed weekly QQQ context; daily QQQ signal; 21/63 Score; Top 2; TLT; Unknown blocks | clock boundary and risk-policy precedence |

The machine-readable action evidence is
[`corpus/intent-authoring-user-actions.json`](../corpus/intent-authoring-user-actions.json).
It records two construction orders per strategy, draft state, unresolved
requirements, visible product meaning, commit operation, capability, and next
actions. Synthetic formalizations are labelled as such and are not attributed
to the 169-fragment design corpus.

## Capability boundary

The Builder keeps these dimensions separate:

| Dimension | Values used here |
| --- | --- |
| Draft readiness | incomplete / ready / unsupported |
| Semantic validity | valid / invalid after typed server validation |
| Representation | projections available from committed meaning and drafts |
| Reference execution | evaluator-supported / unsupported |
| Backend execution | lowerable / unsupported composition |
| Verification | Docker differential verified / not yet verified |
| Runtime | available / unavailable only when execution is requested |

The Test action always uses committed Canonical and the existing execution
preflight. A draft never invokes production lowering. Product surfaces keep
technical lowering errors out of ordinary authoring guidance.

## Perspective behavior

- **Blocky** defaults to compact financial concepts. The draft Inspector exposes
  terms, lookbacks, clocks, missing/Unknown policy, and temporal details.
- **Flow** shows Portfolio ownership, sleeves, conditions, selection results,
  fallback/ELSE exposure, aggregation, and rebalance—not calculation nodes.
- **Asset Workspace** supplies search and explicit asset membership. Selected
  symbols are bound to the draft or addressed Investment, not to a watchlist or
  implicit dynamic universe.
- Existing drag/layout state remains in Working Draft. Only supported semantic
  connections issue typed operations; visual motion alone never mutates Canonical.

## Deferred scope

Recurring contributions, arbitrary temporal recipes, arbitrary multi-clock
policies, and semantic connection shapes outside the current operation ledger
remain honestly gated. This work does not add a second Builder, change historical
V1 compatibility, automatically migrate V1, or broaden provider data.
