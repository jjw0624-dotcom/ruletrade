# Candidate Change v0

> **Status: CURRENT subsystem contract.** Candidate is now integrated with
> Comparison and Keep as described in [the living architecture](architecture.md).

Candidate v0 proves one refinement loop without accepting research into saved Strategy history:

`Decision Evidence → typed change → immutable Candidate → ordinary BacktestRun pipeline`

## Identities and immutability

- A Revision is saved Strategy truth. A Candidate is a research hypothesis derived from one immutable base Revision. A BacktestRun is one execution.
- Candidate creation never advances `Strategy.current_revision_id`, rewrites a Revision, changes an existing Run, or changes a client working copy.
- The Candidate stores both the explicit user intent and the complete validated resulting `CanonicalStrategyV1`. Its source hash uses the existing deterministic strategy hash contract.
- An ordinary Run has `candidate_id = null`. A Candidate Run has its base `revision_id` for lineage and a non-null `candidate_id` identifying the immutable source that actually ran. Candidate source hash—not base Revision hash—is stored in Run provenance.

## v0 semantic change allowlist

The only supported change is:

```json
{
  "kind": "filter_threshold",
  "component_id": "positive_return",
  "field_path": "config.threshold",
  "expected_before": "0.05",
  "proposed_after": "0"
}
```

The backend resolves an exact `filter@1` component, requires the exact Canonical field path, compares the numeric current value with `expected_before`, applies one finite percentage value, and validates the entire resulting Canonical source through the official source-validation boundary. Arbitrary JSON patching is not supported.

When an originating Decision Event is supplied, that event must carry the same `component_id` plus `field_path`. The Event is research context; the base Revision remains the semantic source.

## Execution and lifecycle

`POST /v1/backtest-runs/{run_id}/candidates` inherits the originating Run's immutable dates, cash, and dataset. It persists the valid Candidate before executing it through the same compiler, C# generation, LEAN runner, result normalization, Run lifecycle, provenance, timing, and Decision Evidence collector used for Revision Runs.

A runtime failure therefore leaves an immutable Candidate and an honest failed Candidate Run. Invalid proposals are rejected before either is created. Candidate creation from an archived Strategy is rejected; already-existing Candidates and their Runs remain readable.

Candidate v0 must originate from a Revision-backed Run. It does not allow Candidate-on-Candidate branching.

Canonical percentage literals use deterministic decimal strings in persisted source. The official
desugaring boundary converts those strings to `Decimal` before Strategy IR and LeanPlan creation.
Code generation therefore receives semantic numeric values; persistence formatting is never emitted
as a runtime string expression. Negative C# decimal literals are parenthesized so member calls such
as invariant `ToString` formatting remain numeric under C# operator precedence.

Run the real Candidate-to-Comparison acceptance path with Docker/LEAN:

```bash
./scripts/run_candidate_comparison_lean_e2e.sh
```

It creates a Revision-backed Original Run, applies `0 → -0.01` to the evidence-targeted filter,
executes and persists the Candidate Run and Evidence v2, then creates a Comparison.

## API

- `POST /v1/backtest-runs/{run_id}/candidates` — validate, persist, execute, and return Candidate plus Candidate Run.
- `GET /v1/backtest-runs/{run_id}/candidates` — list Candidates originating from that Run.
- `GET /v1/candidates/{candidate_id}` — reopen Candidate plus its Run.

The frontend sends the Evidence v2 `component_id` and `field_path`, the
displayed current value as `expected_before`, and the proposed value. It does
not construct authoritative Candidate Canonical JSON.

## Integrated boundaries

Comparison uses the originating Run, Candidate Run, explicit semantic change,
both normalized Results, and both Decision Evidence streams. Keep/adoption
passes the immutable Candidate source through the Strategy service with an
expected current Revision; stale or mismatched lineage is rejected. Candidate
creation and execution still never mutate the saved Strategy.

Order/fill comparison, multiple changes, Top-N count, schedule/state/sleeve
Candidate edits, Candidate branching, and generic Experiments remain deferred.
