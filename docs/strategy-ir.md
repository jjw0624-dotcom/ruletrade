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

Strategy IR v0 deliberately contains only the Golden compiler kernel:

```text
schedule.monthly
market.asset_set
selection.random_n
portfolio.equal_weight
portfolio.merge_targets
portfolio.rebalance
```

An AssetSet connected directly to equal weighting means all assets participate, so v0 does not add
an identity `selection.all` operation. The existing equal-weight `total` attribute already expresses
the 70%/30% allocation, so no speculative `portfolio.scale_targets` operation is added either.

Each IR operation carries only a source component ID as lightweight provenance. Random semantics
continue to use the Strategy Model semantic identity, source component identity, normalized
parameter bindings, event identity, and the existing `once`/`per_event` contract. Derived IR IDs do
not become new source semantics.

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

## Portfolio vocabulary

Future source authoring may use conventional portfolio vocabulary:

```text
Portfolio → Portfolio Sleeve → Universe → Screening → Signal / Score
          → Ranking → Selection → Weighting → Target Weights
```

Those are not automatically fundamental IR or runtime objects. For example, a future Portfolio
Sleeve or Fallback can desugar into smaller target/dataflow operations when a real vertical slice
defines its requirements. RuleTrade does not implement those features in Strategy IR v0.

## Reproducibility and persistence boundary

A future strategy revision stores the authoritative Strategy Model. Strategy IR, LeanPlan,
generated C#, and assemblies may be cached but must be reproducible from the source plus compiler
and environment provenance. Relevant future provenance includes source hash, schema and Registry
versions, compiler/backend versions, LEAN image digest, dataset identity/version, BacktestConfig,
and random-semantics version. This document does not introduce persistence.
