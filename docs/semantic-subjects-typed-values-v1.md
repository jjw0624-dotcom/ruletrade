# Semantic Subjects, Universes, Groups, and Typed Values v1

## Decision

Canonical remains Strategy truth. This foundation gives every consumer the same answer to four
questions: which subject is referenced, which candidate domain Selection searches, which
point-in-time observation is read, and which typed scalar is produced.

```text
Asset / Candidate ──> Price or Volume series ──> Current / rolling aggregate ──> scalar value
        │
        └── Universe membership ──> Eligibility ──> Rank ──> Top N selection result
```

Blocky, Flow, Rules, Guide, future Asset Workspace/Compare/Mark, compiler, and Evidence consume
these persisted semantics. UI node IDs never become domain identity.

## Repository-native concept audit

| Concept | Exact v1 meaning | Persistence | Execution/projection |
|---|---|---|---|
| Asset | one normalized investable symbol | asset literal or `AssetSetDefinition` member | LEAN equity subscription |
| Asset set | storage for a finite, explicit symbol list | `definitions.asset_sets` | retained for compatibility |
| Universe | named candidate domain and membership source | `definitions.universes` + `universe@1` | explicit/static-Group sources compile; provider source fails honestly |
| Group | named stable semantic collection referencing an asset set | `definitions.groups` | supplies static Universe membership; no implicit series |
| Selection result | dynamic result of eligibility/rank/Top-N at one evaluation | Decision/Evidence only | never persisted as Group membership |
| Sleeve | portfolio ownership/construction boundary with allocation | `portfolio_sleeve@1` | local targets scaled into Portfolio |
| Portfolio | overall target composition and holdings context | `portfolio@1` and execution state | not interchangeable with Group |
| Candidate | current Universe member during Selection evaluation | contextual expression only | legal in Eligibility/ranking, illegal in Predicate |

The old `asset_set@1` remains valid. `universe@1` is not `AssetSetV2`; it supplies the missing
semantic identity while resolving to the same typed `asset_set` port at the compiler boundary.

## Universe and Group

An explicit Universe references an existing asset set. A static Group Universe references a
Group, which in turn references an asset set. Both resolve deterministically during compilation.
A provider-backed Universe stores provider-neutral `provider_id` and `query` semantics, but is
not executable until membership can be resolved point-in-time. “All US stocks” is therefore not
fabricated from the repository fixtures.

A Group exposes identity and members only in v1. `RSI(Group)` is invalid because neither Group
NAV nor across-member aggregation is defined. Future constructs must distinguish:

- an indicator of a defined Group NAV series; and
- an aggregation across independently evaluated member indicators.

## Typed values

The internal series/scalar distinction is explicit:

```text
Asset or Candidate
  -> market_series(price | volume)
  -> current
     or rolling_aggregate(mean | median | min | max, completed observations)
  -> scalar with the series unit
```

Existing `price`, arithmetic, and trailing-return indicator expressions remain compatible.
`window_observations` means completed daily observations and is bounded to 1–1000. It is not a
calendar duration: three months is not silently rewritten as 63 observations. A future calendar
window requires its own explicit contract.

The user-facing projection describes “Candidate volume mean over 252 completed observations,”
not an implementation pipeline. The frontend formatting contract is shared by Inspector and the
future Value/Condition/Selection Composer.

## Capability and execution matrix

| Value | Canonical | price-CSV evaluation | Strategy compiler/LEAN |
|---|---:|---:|---:|
| explicit Asset trailing return | yes | yes | yes |
| Candidate trailing return | yes | yes with Candidate context | yes |
| Asset/Candidate current adjusted price | yes | yes | deferred |
| rolling price mean/median/min/max | yes | yes | deferred |
| current/rolling volume | yes | no: CSV has no volume | deferred |
| Group-derived series | no implicit series | no | no |

`GET /v1/canonical/value-capabilities` exposes these distinctions. Frontend and AI callers do
not need to hard-code which composition is valid or overstate backend support. A rank expression
outside Candidate trailing return is rejected by the current compiler instead of being silently
executed as return ranking.

## Point-in-time evaluation and provider boundary

`POST /v1/canonical/values/evaluate` is a bounded research/historical domain boundary. It accepts
one typed expression, an `as_of` date, context, optional Candidate binding, and optional stable
Canonical provenance. Before any calculation, data is sliced to observations at or before
`as_of`; expression depth is limited to eight and windows to 1000 observations.

The current evaluator reuses `DatasetRegistry` and identifies its source as
`ruletrade-price-csv`. Those fixtures contain adjusted prices only. The existing LEAN preflight
remains the execution-data boundary and identifies local daily TradeBar availability separately.
Volume is modeled because LEAN bars conceptually carry it, but no value is fabricated through
the price-only CSV evaluator and code generation does not advertise it.

Future providers implement the same provider-neutral observations. Cached bars and derived
rolling values may live below that boundary; caches never become Canonical Strategy truth.

## Evidence and provenance

`SemanticValueEvidence` records subject kind/identity, the exact value definition, type, observed
value, `as_of`, actual observation timestamp, research/historical context, provider ID, and
optional `component_id + condition|value_expression` provenance. It never refers to a Blocky
block, Flow node, or Inspector element. Condition Evidence can compose two such operands plus its
operator and outcome when the compiler supports the value path.

## Historical and future fundamental correctness

Historical evaluation only consumes observations available by the decision timestamp. Future
fundamental observations must additionally carry observation/fiscal period, publication or
availability timestamp, revision/restatement policy, and provider provenance. Canonical field
names must remain vendor-neutral. A provider API that exposes only the latest restated value is
insufficient for backtests.

## Future consumers

- Asset Workspace uses the same Asset, series, value, Strategy membership, and historical
  Decision identities. “Use in Strategy” produces a Semantic Intent and backend Canonical edit.
- Compare evaluates one value definition against several Asset subjects; it has no second metric
  language.
- Mark joins an Asset and historical timestamp to the same observations/values and Decisions.
- Flow consumes Universe, Group, Condition, Selection, Allocation, and Control semantics; it does
  not create a parallel grammar.

## Deferred deliberately

Provider-backed market-wide membership, Group NAV, member aggregates, strategy-compiled price or
volume ranking, RSI, volatility, calendar windows, full Value Composer UX, Asset Workspace, Mark,
Flow Capital Composer, fundamentals, and cash Contribution remain separate work. Their extension
points are now explicit without claiming unavailable data or runtime behavior.
