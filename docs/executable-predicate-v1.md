# Executable Predicate / Condition v1

**Status: MVP 1 CURRENT.** Predicate v1 activates the existing Canonical
`rule@1` boundary for one deliberately narrow, executable control condition.
It does not add a general expression editor.

## Semantic model

```text
scheduled Script
  → IF maintained asset trailing return over N completed daily observations
       compares (> / >= / < / <=) with a scalar percentage
  → THEN rebalance to the existing portfolio targets
  → OTHERWISE retain the current portfolio
```

The condition is a typed Canonical `ComparisonExpression`. Its left operand is
the generated `trailing_return_indicator@1` over an explicit asset literal and
lookback; its right operand is a percentage literal. The THEN statement is a
typed `RebalanceAction` whose `ComponentOutputExpression` identifies the
existing target-producing component and port. An empty `else_actions` sequence
has the explicit v1 meaning “do not rebalance; retain current holdings.”

Eligibility (`filter@1`) still decides which candidates may enter a Selection.
Selection fallback still handles an incomplete Selection. Neither is a control
Predicate or an OTHERWISE branch. Boolean trees, nested IF, multiple predicates,
cross-asset expressions, arbitrary actions, and executable IF/OTHERWISE authoring
remain deferred.

## Authoring and Blocky

The existing Authoring Contract exposes `add_predicate`, `update_predicate`,
and `remove_predicate` only for eligible exact targets. Adding a Predicate
atomically replaces an eligible `rebalance@1` with `rule@1` under the same
Canonical component ID, removes its graph input edge, and records that target
as the rule action. Removal performs the exact inverse. Failed validation leaves
the supplied Canonical unchanged.

Blocky exposes **If** as executable when backend capabilities contain an
eligible rebalance. Drop/click applies the backend operation and reconciles from
returned Canonical. The committed block is projected as a control statement
with Rebalance nested under THEN. **If / Otherwise** remains an honest
LogicDraft because a second executable branch is outside v1. Blockly block IDs
and workspace serialization never enter Canonical.

The Inspector owns Asset, Measure (fixed to trailing return), Period, Operator,
and Value editing. Flow compresses the Predicate as a market-condition routing
annotation. Rules and Guide state the condition and false behavior. Summary,
Code, and AI context expose the same Canonical semantics.

## Execution and Evidence

Canonical lowers through Strategy IR to a LEAN plan carrying a restricted
`LeanTrailingReturnPredicate`. Generated C# subscribes to adjusted daily data,
maintains a rolling window, and evaluates `window[0] / window[lookback] - 1`
only after `lookback + 1` completed observations. No future observation is used.
True continues into the target/rebalance path; false or insufficient history
returns before portfolio mutation.

Each evaluation emits persisted Decision Evidence with exact Predicate
`component_id` and `field_path=condition`, asset, measure, lookback, operator,
observed value, threshold, boolean outcome, and `then` / `otherwise` branch.
Result navigation therefore reaches the same semantic address in every
representation. Evidence remains decision-time truth.

## Compatibility and deferred scope

Existing Canonical v1 payloads require no migration: `else_actions` defaults to
empty and is omitted when empty. Existing executable strategies compile
unchanged. Predicate v1 does not implement AND/OR/NOT, recursive expressions,
arbitrary Blockly programs, generic branch actions, parameters, free Flow
wiring, Validation, Forward, or optimization.
