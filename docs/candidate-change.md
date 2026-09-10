# Candidate Change v0

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

## API

- `POST /v1/backtest-runs/{run_id}/candidates` — validate, persist, execute, and return Candidate plus Candidate Run.
- `GET /v1/backtest-runs/{run_id}/candidates` — list Candidates originating from that Run.
- `GET /v1/candidates/{candidate_id}` — reopen Candidate plus its Run.

The future frontend sends the Evidence v2 `component_id` and `field_path`, the displayed current value as `expected_before`, and the user's proposed value. It does not construct authoritative Candidate Canonical JSON.

## Future boundaries

A future Keep operation can pass the Candidate Canonical source to the existing Revision service with `expected_parent_revision_id = candidate.base_revision_id`. If the Strategy advanced, existing optimistic concurrency rejects the save. No Keep behavior exists here.

Future Comparison already has stable identities for the originating Run, Candidate Run, explicit semantic change, both normalized results, and both Decision Evidence streams. No diff or Experiment semantics are introduced.

Order/fill comparison, multiple changes, Top-N count, schedule/state/sleeve edits, Candidate branching, Keep/Discard, and Comparison are intentionally deferred.
