# Strategy IR architecture

RuleTrade uses a one-way compiler pipeline:

```text
CanonicalStrategyV1 (Strategy Model)
  → source validation
  → desugaring and normalization
  → Strategy IR validation
  → static requirements analysis
  → LeanPlan
  → generated C#
  → .NET / LEAN
```

`CanonicalStrategyV1` currently implements the **Strategy Model** role. It is the only
authoritative, user-editable strategy representation. Guided, Flow, and future authoring views edit
that model through semantic patches. Strategy IR, LeanPlan, generated source, assemblies, and
backtest results are derived and never reconstruct the source model.

## Compiler representations

- **Strategy Model** preserves authored intent, stable component identity, and source metadata.
- **Strategy IR** is RuleTrade's typed, backend-independent domain HIR. Its graph represents coarse
  event, asset-selection, and portfolio-target dataflow; local expression/action ASTs remain a
  separate concern when a supported source feature eventually needs them.
- **LeanPlan** is RuleTrade's LEAN-specific backend IR. It records subscriptions, LEAN event
  execution requirements, selections, targets, and rebalances for C# generation.
- **Generated C#** is target source. Code generation consumes LeanPlan only.

Strategy IR deliberately grows only through proven vertical slices. The current kernel is:

```text
schedule.monthly
schedule.daily
market.asset_set
selection.random_n
market.trailing_return
selection.filter
selection.rank
selection.top_n
portfolio.equal_weight
portfolio.merge_targets
portfolio.first_non_empty_targets
portfolio.rebalance
selection.elapsed_sessions_gate
state.observe_target_exits
```

An AssetSet connected directly to equal weighting means all assets participate, so v0 does not add
an identity `selection.all` operation. The existing equal-weight `total` attribute already expresses
the 70%/30% allocation, so no speculative `portfolio.scale_targets` operation is added either.

Each IR operation carries only a source component ID as lightweight provenance. Random semantics
continue to use the Strategy Model semantic identity, source component identity, normalized
parameter bindings, event identity, and the existing `once`/`per_event` contract. Derived IR IDs do
not become new source semantics.

## Trailing-return Top N semantics

The first signal/ranking slice is compositional in both the Strategy Model and Strategy IR:

```text
market.asset_set → market.trailing_return → selection.rank → selection.top_n
                 → portfolio.equal_weight → portfolio.rebalance
```

`lookback_bars=126` means 126 completed US Equity Daily bar intervals, requiring 127 adjusted-close
observations. At a monthly event, generated code first receives the completed Daily `TradeBar` in
`OnData`, adds its close to the window, then compares it with the close 126 bars earlier using
`current / prior - 1`. No later bar can enter the calculation. LEAN warm-up supplies the preceding
126 trading-calendar samples; RuleTrade does not implement a calendar or history engine.

An asset without all 127 positive observations is ineligible. If fewer than Top N assets are
eligible, the whole rebalance is skipped rather than comparing unequal windows. Scores sort
descending and equal scores use ticker ascending as the deterministic tie-break. These are fixed
v0 semantics, not configurable policies.

The two added dataflow types are deliberately precise: `asset_scores` is a per-asset numeric score
set, and `ranked_assets` is its deterministic ordered result. They prevent raw scores or ranked
collections from being mistaken for an ordinary `AssetSet` without introducing generic collection
machinery.

## Score filtering semantics

The first screening slice composes without adding a new collection type:

```text
market.trailing_return → selection.filter → selection.rank → selection.top_n
```

`selection.filter` consumes and returns `asset_scores`, preserving the calculated score values for
ranking. Its v0 predicate is exactly `score > threshold`, using decimal comparison. Equality does
not pass. Missing or history-ineligible assets have no score and therefore cannot pass. Filtering
does not reorder scores; the downstream rank operation still owns deterministic descending order
and ticker-ascending ties.

The generated backend calculates each trailing return once, filters that dictionary, and ranks the
filtered dictionary. If fewer than Top N scores remain, the entire rebalance is skipped and current
holdings remain unchanged. It does not partially invest, silently reduce N, move to cash, or select
a fallback unless an explicit source-level `fallback@1` component follows the filter pipeline.

Runtime traces keep the partial Top N `candidate` distinct from the semantic `selected` result. A
skipped decision records `selected=` and `decision=skipped`, while the skip trace records both the
eligible and required counts. This preserves diagnostics without presenting an unexecuted candidate
as an investment selection.

## Fallback desugaring

Fallback is the first source-level convenience that expands into a smaller compiler kernel. The
authoritative Strategy Model preserves `fallback@1` with an explicit single-asset AssetSet
reference. One source component desugars to:

```text
market.asset_set (fallback asset)
  → portfolio.equal_weight (same allocation as primary)

primary portfolio targets ─┐
                           ├→ portfolio.first_non_empty_targets
fallback portfolio targets ┘
```

`portfolio.first_non_empty_targets` is the one new irreducible IR operation: choosing between two
already-computed target sets is runtime decision semantics, while the source-specific convenience
of naming one fallback asset is not. The IR operation is backend-independent and contains no LEAN
types, scheduling rules, or symbols hard-coded by the backend.

Fallback v0 is all-or-nothing. When the filtered primary can supply the requested Top N, primary
targets execute. Otherwise its partial candidate is not selected and the fallback asset receives
the primary allocation (100% in the reference strategy). Traces separately record primary
`eligible`, `ranked`, `candidate`, and `selected`; fallback activation; and the final executed
selection. The shared source provenance on the three derived operations identifies the source
fallback component that caused the decision.

Requirements analysis discovers the derived fallback AssetSet as a subscription. Only the primary
AssetSet is an operand of `market.trailing_return`, so its 127 adjusted Daily observations do not
apply to the fallback asset. Filter-without-fallback retains its existing skipped-rebalance policy.

Subscription, history, and decision readiness are separate requirements. The fallback strategy
subscribes to TLT so LEAN can price and trade it, but TLT has no momentum-history requirement. The
current LEAN v0 event guard conservatively requires a current ready bar for every subscribed asset,
including TLT, before executing either path. That is semantically correct for this fixed Daily
slice. Path-sensitive conditional readiness is deliberately deferred until a real strategy proves
the conservative guard insufficient; this slice does not add a generic readiness framework.

## Registry and analysis

The existing Primitive Registry remains the definition source for source-language operations: IDs,
ports, financial value types, fields, defaults, constraints, authoring support, and backend
capabilities. The Registry does not store compiler passes, C# templates, runtime algorithms, Docker
logic, or LEAN execution code. A broad rename to “Operation Registry” is deferred to avoid churn;
conceptually, that is its language-definition role.

IR validation independently checks operation kinds, attributes required by typed operation models,
operand/result compatibility, dataflow, entrypoints, and the financial constraints needed by this
kernel. Static analysis then derives immutable required assets, schedules, operation capabilities,
and deterministic-random requirements. Backend-specific subscription choices remain in LEAN
lowering.

## Portfolio sleeves and hierarchical allocation

Source authoring uses conventional portfolio vocabulary:

```text
Portfolio → Portfolio Sleeve → Universe → Screening → Signal / Score
          → Ranking → Selection → Weighting → Target Weights
```

`portfolio_sleeve@1` preserves stable source component identity, a human-readable name, allocation,
and the local target-producing dataflow. `portfolio@1` preserves membership. Neither is an Asset or
an IR runtime object. For the current two-sleeve, shared-monthly-schedule slice they desugar to:

```text
Growth local targets    → portfolio.scale_targets(0.70) ─┐
                                                         ├→ portfolio.merge_targets
Defensive local targets → portfolio.scale_targets(0.30) ─┘
```

`portfolio.scale_targets` is the only new irreducible IR operation. Existing additive
`portfolio.merge_targets` semantics aggregate contributions by symbol, so Growth fallback TLT at
70% plus Defensive TLT at 15% becomes one final TLT target of 85%, not two positions or a discarded
contribution. Local targets sum to one within each sleeve and source validation requires the two
reference allocations to sum to one.

Requirements compose through ordinary IR dataflow: subscriptions are deduplicated across sleeves,
while Daily momentum history remains attached only to the Growth trailing-return operands. LEAN
receives only flat final target weights; no fake LEAN Sleeve abstraction is generated. Source
provenance on scale operations and deterministic `RULETRADE_SLEEVE` traces expose local weights,
allocation, and scaled contribution. Nested sleeves and path-sensitive readiness remain deliberately
deferred.

## Independent schedules v0

`CanonicalStrategyV1` now distinguishes scheduled target refresh from portfolio execution through
ordinary event entrypoints. The reference source uses `monthly@1 → growth_sleeve`,
`quarterly@1 → defensive_sleeve`, and `quarterly@1 → rebalance`. Monthly means the first trading day
of every month; Quarterly means the first trading day of January, April, July, and October.

An independently scheduled source sleeve desugars to `portfolio.retain_targets` followed by the
existing `portfolio.scale_targets`. `retain_targets` is the one new irreducible temporal IR semantic:
it retains the latest semantic local `PortfolioTargets` and refresh provenance between events. It is
compiler/runtime execution state, not user-authored Strategy State. Unscheduled sleeves retain the
existing event-local lowering, so previous strategies do not silently acquire snapshot semantics.

On a ready Daily slice the runtime performs two deterministic phases: all pending sleeve refreshes
commit first, then all pending portfolio executions consume the committed snapshots. Registration or
entrypoint ordering therefore cannot change same-day results. Portfolio execution is skipped until
every referenced snapshot exists. A snapshot records local targets and its source event identity;
LEAN-specific dictionaries remain confined to `LeanPlan → C#` lowering.

## User-authored cooldown state v0

`cooldown@1` preserves the user-facing intent “after exit, wait N completed trading sessions before
selecting this asset again.” It is distinct from retained target snapshots: a retained snapshot is
compiler/runtime bookkeeping, while `last_exit` changes future investment decisions and is therefore
semantic strategy state. The source convenience desugars explicitly to:

```text
per-asset last-exit state declaration
Top N candidates → selection.elapsed_sessions_gate → local targets
local targets → state.observe_target_exits → rebalance
```

No monolithic Cooldown operation is added to Strategy IR. `selection.elapsed_sessions_gate` reads
per-asset state and filters candidates by completed-session distance;
`state.observe_target_exits` passes `PortfolioTargets` through unchanged while defining the semantic
mutation point. These are backend-independent operations with source-component provenance.

An exit is a RuleTrade target transition from positive to zero at a rebalance decision, independent
of later broker fill timing. The exit exchange session is day 0. Each following completed regular
exchange session advances the elapsed count, and eligibility returns when the count is at least the
configured duration. A signal during cooldown is blocked; v0 does not backfill from lower-ranked
candidates. In the Top-1 reference strategy this can produce an empty target set and cash until the
candidate becomes eligible again.

Requirements keep subscriptions, Daily history, scheduled events, semantic user state, trading
calendar access, and retained runtime snapshots separate. The LEAN backend uses the subscribed US
equity's `Security.Exchange.Hours.IsDateOpen` calendar to advance the session ordinal only on open
exchange dates; it does not approximate trading sessions with calendar-day arithmetic. Generated
private dictionaries store last-exit session/date and prior semantic targets, but those C# details
do not leak into Strategy IR.

## Reproducibility and persistence boundary

A future strategy revision stores the authoritative Strategy Model. Strategy IR, LeanPlan,
generated C#, and assemblies may be cached but must be reproducible from the source plus compiler
and environment provenance. Relevant future provenance includes source hash, schema and Registry
versions, compiler/backend versions, LEAN image digest, dataset identity/version, BacktestConfig,
and random-semantics version. This document does not introduce persistence.
