# Candidate + Comparison frontend

> **Status: SUPERSEDED.** This predates the integrated Research workspace and
> Keep/adoption UI. See [the living architecture](architecture.md).

## Contracts used

The frontend consumes the merged product contracts without reconstructing their semantics:

- `POST /v1/backtest-runs/{run_id}/candidates` with one `filter_threshold` change, `component_id`, the exact `config.threshold` field path, expected/proposed decimal values, and the optional originating Decision Event ID.
- `GET /v1/candidates/{candidate_id}` for the immutable Candidate and its real Run.
- `POST /v1/candidates/{candidate_id}/comparison` for the idempotent backend-aligned Comparison.
- `GET /v1/comparisons/{comparison_id}` for stable route reopening.
- `GET /v1/backtest-runs/{run_id}` for the immutable Original/Candidate results and equity curves referenced by a Comparison.

Candidate eligibility is intentionally narrow. `Try changing` appears only for Evidence v2 filter evidence whose structured source reference identifies `field_path = config.threshold`. The frontend sends semantic intent; it never builds Candidate Canonical JSON, mutates the editor working copy, or aligns the two Evidence streams.

## UX and state ownership

The What-if panel stays inside the original Analysis context and states that the saved strategy remains unchanged. Submission progresses through validating and real Candidate execution, prevents duplicate submission, then creates/loads the Comparison and opens `/comparisons/{id}`.

The Compare workspace owns only UI selection. The immutable Comparison owns the strategy, behavior, and result diffs. The immutable Runs continue to own equity curves. An in-session research context carries the originating run/date/asset into Compare; a direct refresh deterministically selects backend `first_difference`.

Comparison hierarchy is:

1. the explicit semantic field change;
2. backend-aligned changed decision contexts and `Why different?`;
3. final allocation and normalized result differences;
4. secondary technical details.

The changed-context count is always described as decisions, never trades. Zero changed contexts is presented as useful evidence, not an error. Original-only and Candidate-only event presence remains explicit.

## Keep boundary

Current `main` has no explicit Candidate acceptance operation. The frontend therefore does not implement or simulate Keep. A safe future contract must accept a Candidate against an expected current Strategy Revision, reject stale lineage, and return the newly created immutable Revision. Until that exists, leaving the experiment unadopted and returning to Original is the honest behavior.

## Manual acceptance

1. Open a persisted Strategy and a successful saved Backtest with Evidence v2.
2. Select a chart decision marker, then an asset that failed its qualification rule.
3. Verify the exact observed/required values and select **Try changing**.
4. Enter a different threshold and confirm the panel says the saved strategy is unchanged.
5. Select **Test change** once; verify duplicate submission is disabled.
6. After real Candidate execution, verify Compare opens automatically.
7. Confirm **You changed** shows the backend before/after values.
8. Confirm Behavior reports decision contexts—not trades—and shows only backend differences chronologically.
9. Select a difference and explain its Original/Candidate qualification, selection, fallback, or allocation change.
10. Inspect final allocation, normalized result diff, and both immutable equity curves.
11. Return to Original and verify the originating date/asset context remains selected.
12. Refresh `/comparisons/{id}` and verify it reloads persisted artifacts without running LEAN.

## Intentional deferrals

- Keep/accept pending the safe backend contract above.
- Candidate fields beyond the backend filter-threshold allowlist.
- Experiments, multi-field changes, parameter sweeps, order/fill comparison, and frontend Evidence alignment.
- A generic Candidate history dashboard.
