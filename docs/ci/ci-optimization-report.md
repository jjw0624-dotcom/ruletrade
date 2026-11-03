# CI optimization report

Starting main: `f2b387d84a086c809c57a861b585c7d8123df6b9`.

## Changes

1. Added a conservative impact-classification job.
2. Kept Static & Contract and Unit & Semantic on every PR.
3. Made LEAN compilation, Docker differentials, persisted V2 API, and real Chrome conditional on affected paths.
4. Forced every integration proof on `main`, manual dispatch, workflow changes, dependency changes, and unknown paths.
5. Removed the separate Perspective Consistency job because its exact Python/Vitest files are already run by the complete suites.
6. Removed duplicated API unit invocations from Production API Contract while retaining the unique saved-Revision → Docker LEAN → persisted Run proof.
7. Increased the three-profile Docker matrix from two to three parallel jobs. Historical queue evidence shows the previous third-profile delay was imposed by `max-parallel`, not ordinary runner queue.
8. Enabled immutable `uv.lock`-keyed dependency caching for LEAN/Docker jobs.
9. Split nightly regression into independent failure domains that execute in parallel and added an explicit persisted V2 API nightly proof and stable nightly aggregator.
10. Preserved failure-only LEAN artifacts and always-on browser evidence; nightly artifacts retain 21 days.

## Correctness preserved

The optimized workflows retain explicit owners for SemanticProgramV2, typed operations, CAS, revisions, reference evaluation, generated C#, LEAN, DailyValue, Selection/fallback, Score/Allocation, temporal/state/replay, multi-clock, composable execution, persisted V2 results/evidence, and perspective round trips.

Path filtering never treats visual availability as execution support and does not modify financial semantics. Unknown or shared infrastructure changes trigger every integration proof. Main and manual runs always execute the full integration matrix.

## Required-check safety

`Capability CI Required` is unchanged by name. Its new contract validates both the classifier and every expected result. An expected job that is failed, cancelled, missing, or skipped fails the aggregator. Only an explicitly unaffected job may be skipped.

The repository currently reports no branch protection or repository rulesets. The stable aggregator is nevertheless retained so protection can continue or be enabled without another check-name migration.

## Measured baseline

- Successful-run median: 947 seconds.
- Range: 816–1,075 seconds.
- Temporal matrix median queue: 482 seconds.
- Normal initial queue: about 3 seconds.
- Duplicate Perspective job: 25-second median plus repeated environment setup.
- Docker free-space preparation: 82-second median across 28 observations.

## Exact-head implementation evidence

- First implementation head: `f5e5e84980ccc8b8455a6c00fd935ef1fe289304`.
- Capability CI run: [41592490382](https://github.com/jjw0624-dotcom/ruletrade/actions/runs/41592490382), success.
- Wall clock: 578 seconds (9m38s), from 06:51:06Z to 07:00:44Z.
- Historical successful-run median: 947 seconds (15m47s).
- Observed improvement: 369 seconds (6m09s), or 39.0% against the median.
- All three Docker profiles were created at 06:51:14Z and started at 06:51:16Z/17Z. Temporal queue was 3 seconds, versus the 482-second historical median caused by `max-parallel: 2`.
- Generated C#/LEAN, core Selection/fallback, weighted Score/Allocation, temporal/state/replay, persisted V2 API, real Chrome, and `Capability CI Required` all passed.
- The slowest job remained generated C#/LEAN compilation at 563 seconds. No semantic proof was shortened or removed to obtain the wall-clock reduction.

The path tiers remain deliberately conservative: documentation-only changes use the fast tier; frontend changes add real Chrome; backend, shared contracts, dependencies, workflows, unknown paths, `main`, and manual dispatch use the full execution matrix.

## Branch and baseline audit

- PR #81 is present in main at `f2b387d…`.
- Remote branches visible at audit time: `main` and `copilot/audit-ruletrade-architecture`.
- No tags, branch protection, or repository rulesets were present.
- The remaining Copilot branch has an empty `Initial plan` commit, PR #9 closed unmerged with no changed files, no active dependent PR, and is 388 commits behind main.
- No remote branch was deleted.
- `builder-v2-integration-baseline` must be created at `f2b387d…` before the proposed obsolete branch deletion is approved and executed.

## Validation status

The first full implementation-head Capability CI passed. A final full-matrix run is required after this evidence update. Nightly was structurally split and YAML-validated, but an actual scheduled/manual Nightly run was not triggered because the available integration exposes no workflow-dispatch mutation.
