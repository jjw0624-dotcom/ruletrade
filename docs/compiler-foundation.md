# Compiler foundation

> **Status: CURRENT subsystem contract.** See
> [the living architecture](architecture.md) for the full product pipeline.

This document records the compiler boundary proven by the Golden, Momentum, Filter, Fallback,
Portfolio Sleeves, Independent Schedules, and Cooldown vertical slices. It is an inventory of the
implemented system, not a roadmap for a general strategy language.

## Authority and pipeline

```text
UI views
  -> CanonicalStrategyV1
  -> source validation
  -> desugaring and IR normalization
  -> Strategy IR
  -> IR validation
  -> requirements analysis
  -> LEAN lowering
  -> LeanPlan
  -> C# code generation
  -> LEAN
```

`CanonicalStrategyV1` is the only editable strategy representation. Strategy IR, requirements,
LeanPlan, generated source and assemblies, runtime traces, and backtest results are derived. There
is no reverse conversion from IR or a backend artifact to Canonical.

`ruletrade.compiler.compile_strategy_to_lean_plan` is the official compiler entrypoint. It owns the
one-way sequence above through LeanPlan. The frontend entrypoint remains useful for IR tests, and
the backend lowering entrypoint remains useful for backend tests. `compiler.lean.lower_to_lean_plan`
is a compatibility facade and delegates to the official entrypoint; it contains no compiler logic.

## Implemented inventory

| Layer | Implemented concepts |
| --- | --- |
| Source primitives | Daily/monthly/quarterly events, named asset set, random selection, trailing return, filter, rank, Top N, Cooldown, equal weight, target merge, Fallback, Portfolio Sleeve, Portfolio, rebalance |
| IR values | event, asset set, asset scores, ranked assets, portfolio targets, per-asset trading-session state |
| IR operations | schedule operations; asset set, random selection, trailing return, filter, rank, Top N; elapsed-session gate; equal weight, scale, retain, merge, first-non-empty targets; target-exit observation; rebalance |
| Requirements | subscriptions, schedules, random behavior, Daily adjusted-close history, per-asset semantic state, completed-trading-session calendar access |
| LeanPlan | subscriptions, selections, local target sleeves, target snapshots and allocations, rebalances, scheduled events, on-data readiness, Cooldown state |
| Backend | deterministic C# generation, LEAN scheduling/exchange hours/history windows/portfolio APIs, explicit generated dictionaries and event queues |
| Reference evidence | slice-specific Python oracles, deterministic LEAN-format fixtures, trace parsers, strict differential verifiers |

## Source convenience and IR semantics

Source components preserve authoring intent. They may lower to several smaller IR operations:

```text
fallback@1
  -> AssetSet + EqualWeight + FirstNonEmptyTargets

portfolio_sleeve@1
  -> ScaleTargets

cooldown@1
  -> PerAssetState(last_exit)
   + ElapsedSessionsGate
   + ObserveTargetExits
```

The IR keeps irreducible execution semantics such as first-non-empty target choice, retained target
snapshots, elapsed-session eligibility, and target-exit observation. It does not duplicate each
source convenience as a monolithic operation.

## Semantic state and runtime bookkeeping

These categories deliberately do not share one generic state abstraction.

User semantic state changes future strategy decisions. Cooldown's per-asset `last_exit` is declared
in Strategy IR with source provenance, read by the elapsed-session gate, and mutated by the
target-exit observer.

Runtime bookkeeping implements evaluation and execution. It includes retained target snapshots,
prior-target dictionaries used to observe transitions, pending-event markers, ready-event queues,
and generated schedule/session helpers. `portfolio.retain_targets` is not user-authored state.

## Temporal phases

Schedule identity, event readiness, evaluation, target refresh, snapshot commit, portfolio
execution, state mutation, and the trading-session clock are distinct concepts. On a same-day event
the generated algorithm preserves this order:

```text
completed required market data
  -> collect ready events
  -> evaluate and refresh all ready source sleeves
  -> commit refreshed snapshots and defined semantic state effects
  -> execute ready portfolio rebalances from committed values
```

Cooldown state mutation is part of its RuleTrade target decision and occurs before order submission.
Its session clock uses LEAN exchange-hours data, while Strategy IR requests only backend-independent
completed-trading-session semantics.

## Decision vocabulary

The following terms are not interchangeable:

- signal: evidence that starts a decision path;
- candidate: an asset proposed by a selection operation;
- eligible: a candidate that passes a gate;
- ranked: ordered eligible assets;
- primary selected: assets chosen by the primary path;
- final selected: the primary or fallback choice after branching;
- local targets: weights produced inside a strategy or sleeve;
- scaled targets: local targets multiplied by a sleeve allocation;
- aggregated final targets: symbol-aggregated portfolio weights;
- executed portfolio targets: the final target set handed to the backend portfolio API.

Generated variable names and verifier assertions preserve these distinctions. A blocked or partial
candidate must not be reported as final selected.

## Requirements and backend ownership

Requirements state what execution needs. They do not prescribe a LEAN API. Market subscriptions,
history, schedules, random resampling, semantic state, and trading calendars remain separate
requirements. Run configuration such as dates, capital, dataset identity, fees, or engine settings
is not strategy semantics.

LEAN lowering chooses subscriptions, event structures, calendar anchors, history windows, and
simple generated storage. Those are LeanPlan/backend decisions and do not leak into Strategy IR.

## Provenance

Every Strategy IR declaration and operation has stable source-component provenance. Requirements
carry the component that caused them. LeanPlan retains the source IDs needed by current behaviors:
random selection, score, filter, rank, Top N selection, fallback, sleeve, retained snapshot,
rebalance, schedule, and Cooldown state.

An execution ID and a source selection ID are distinct in `LeanMomentumSelection`. This matters for
Cooldown: the execution selection is the Cooldown-gated node, while `selection_component_id` still
identifies the Top-N source component that produced the candidates.

This is enough to attach future structured decision records to stable Canonical component IDs. It
is not a general source-map system.

## Numeric comparison policy

Verifier equality is selected by semantic type:

| Value | Comparison |
| --- | --- |
| IDs, symbols, event identities, decisions, rankings, candidates and selections | Exact |
| Deterministic target and sleeve weight algebra | Exact decimal equality |
| Division-derived market scores crossing Python/C# runtime boundaries | Exact symbol keys plus absolute tolerance `1e-24` |
| Money and engine results | Existing normalized backtest-result contract |

The score tolerance is intentionally centralized and is not applied to decisions or target algebra.

## Current runtime traces

`RULETRADE_FILTER`, `RULETRADE_MOMENTUM`, `RULETRADE_FALLBACK`, `RULETRADE_FINAL`,
`RULETRADE_SLEEVE`, `RULETRADE_REFRESH`, `RULETRADE_PORTFOLIO_EVENT`, `RULETRADE_TARGETS`,
`RULETRADE_SIGNAL`, `RULETRADE_COOLDOWN`, and `RULETRADE_STATE` are acceptance evidence. Their event
identity is the RuleTrade decision session, not an order-fill timestamp. Component, sleeve, source,
snapshot, and state fields prove the provenance relevant to each slice.

These debug records are not the future Decision Trace API. The structured runtime artifact should
be emitted from compiler/LeanPlan identities and typed execution observations, rather than by
promoting or reparsing human-readable log lines.

## Testing boundary

Each slice keeps a readable independent oracle. Shared verifier utilities cover only identical
mechanics: LEAN completion/fatal detection, failed-data health, trace symbol/decimal parsing,
aligned Daily fixture loading, target parsing, and the narrow division-derived score tolerance.
Slice-specific decision and portfolio assertions remain separate.

## MVP boundary

The next ownership boundary is:

```text
immutable Strategy Revision source payload
  -> regenerated compiler artifacts
  -> Backtest Run plus separate run configuration
  -> structured decision evidence linked to source components
```

The compiler does not persist these objects. The implemented product layer
stores Canonical in an immutable Revision; a Run references exactly one Revision
and one run configuration; structured Evidence references stable component IDs
preserved through the compiler.

## MVP-readiness review

| Question | Foundation status |
| --- | --- |
| Compile a stored Revision without editor state? | Yes. Compilation consumes only `CanonicalStrategyV1`, its registry/version context, and explicit parameter bindings. |
| Is Canonical sufficient as the authoritative Revision payload? | Yes for the proven semantics; editor layout is intentionally excluded. |
| Can derived artifacts be regenerated? | Yes. IR, requirements, LeanPlan, and C# all follow the official one-way compiler path. |
| Is provenance stable enough for future decision records? | Yes. Stable Canonical component IDs reach IR, requirements, and the relevant LeanPlan records. |
| Can a Run reference one immutable Revision and run config? | Yes. Run dates, capital, data identity, and engine settings are outside strategy semantics. |
| Are market-data requirements distinct from run configuration? | Yes. Subscriptions/history/calendar needs are compiler requirements; dataset and engine choices are run configuration. |
| Can Candidate Changes target stable fields? | Yes. Guided and Flow already patch Canonical component IDs and fields, not derived nodes. |
| Is there one official compiler path? | Yes. The compatibility facade delegates to it and is covered by a differential test. |
| Are semantic state and runtime bookkeeping separate? | Yes, in IR types, requirements, LeanPlan concepts, and generated storage. |
| Are traces unambiguous enough as interim evidence? | Yes for the proven slices, provided their exact candidate/selected/local/final meanings are preserved. They are not a persistence schema. |
| Concrete blocker to Strategy/Revision/Run/Trace? | None found in the compiler foundation. Product storage needs compiler/version and run-config identities, but those belong to the next layer. |

Compiler limits remain: one Canonical version, one LEAN backend, no generic pass
framework, generic state machine, arbitrary schedule language, optimizer, or
compiler-owned persistence. Revisions, Runs, and Decision Evidence are product
layers above this compiler boundary.
