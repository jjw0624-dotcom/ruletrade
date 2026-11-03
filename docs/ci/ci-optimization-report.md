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

## Expected mechanisms, not claimed results

- A docs-only PR should run only the classifier and fast tier.
- A frontend PR should add real Chrome but not Docker/LEAN/API.
- A backend or shared-contract PR should run the full execution matrix.
- Full-matrix critical path should remove approximately one Docker-profile queue interval by running all three profiles concurrently.

These are design expectations. The final section must be updated with exact-head before/after Action timestamps before claiming a measured improvement.

## Branch and baseline audit

- PR #81 is present in main at `f2b387d…`.
- Remote branches visible at audit time: `main` and `copilot/audit-ruletrade-architecture`.
- No tags, branch protection, or repository rulesets were present.
- The remaining Copilot branch has an empty `Initial plan` commit, PR #9 closed unmerged with no changed files, no active dependent PR, and is 388 commits behind main.
- No remote branch was deleted.
- `builder-v2-integration-baseline` must be created at `f2b387d…` before the proposed obsolete branch deletion is approved and executed.

## Validation status

Pending exact-head workflow execution. Full Nightly execution will be reported separately if it cannot be triggered through the available integration.
