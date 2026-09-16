# Final frontend MVP cohesion

> **Status: HISTORICAL.** This records the pre-workbench cohesion pass. Current
> Builder and Research ownership is in [the living architecture](architecture.md).

This pass closes the existing research loop without adding investment semantics.

## Adoption contract

Comparison uses the persisted `candidate_id`, loads the Candidate's `base_revision_id`, and sends:

```text
POST /v1/candidates/{candidate_id}/adopt
{ "expected_current_revision_id": "{base_revision_id}" }
```

The frontend never builds Candidate Canonical data and adoption never starts LEAN. Both
`created=true` and idempotent `created=false` responses navigate to the returned
Strategy and Revision. The Strategy reloads normally and confirms that the change is now
part of the strategy.

A stale or lineage-mismatched adoption does not retry or overwrite. The Comparison remains
at its stable URL, and the user can open the latest Strategy. Returning to the Original
Result makes no adoption or deletion request, so Original, Candidate, and Comparison
remain historical research artifacts.

## Cohesion audit

The existing Explore, My Strategies, Strategy, Research, and Compare routes remain the
application structure. The pass normalizes content width, workspace headers, section
rhythm, selected-state outlines, action placement, and progressive Developer details.
Guided and Flow semantics, Decision Evidence presentation, Candidate fields, Comparison
alignment, and Market Data preflight behavior are unchanged.

Test remains a Strategy-level action. Saved real-data tests still preflight the exact
Revision and BacktestConfig; unavailable data stays distinct from strategy validation.
Unsaved and synthetic tests retain their existing paths.

## Manual acceptance

1. Explore → create/open Strategy → edit in Guided → confirm in Flow → Test.
2. From Result select a chart marker and failed asset, inspect Why, and Try changing.
3. Test the Candidate, open Compare, inspect Only Differences and Why Different.
4. Return to original and confirm no adoption occurred.
5. Reopen Compare, Keep change, confirm, and verify the updated Strategy opens with
   “This change is now part of your strategy.”
6. Reopen the historical Comparison and verify it still loads.
7. Exercise a stale adoption and verify no automatic retry or overwrite occurs.
8. Confirm unavailable Market Data still blocks the persisted Run before LEAN.

No real LEAN E2E is required because this pass does not change compiler or runtime semantics.
