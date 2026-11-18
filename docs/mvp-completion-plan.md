# MVP completion plan

**Status: CURRENT**

This plan supersedes continued expansion of the general-purpose Builder as the
active delivery path. It preserves the existing semantic and execution
foundation while narrowing strategy creation so the research product can be
completed end to end.

## Decision

The MVP does not require a finished general-purpose visual strategy language.

For the active MVP:

- `CanonicalStrategyV2` remains the only Strategy authority.
- Immutable Revision identity, compiler lowering, LEAN execution, Result,
  Decision Evidence, Candidate, Comparison, and adoption remain shared product
  infrastructure.
- New strategies are created from a small versioned catalog of fixed strategy
  families through Rules-oriented parameter forms.
- Summary, Guide, Flow, Blocky, Code, and AI may project a catalog strategy,
  but only Rules and explicitly listed parameter controls claim MVP authoring.
- Flow and Blocky are frozen as experimental Builder surfaces. They must not
  block delivery of evaluation and research features.
- The general-purpose Builder resumes as an independently releasable module
  after the fixed-strategy MVP loop is complete.

This is a product-scope change, not a second Strategy model. Catalog forms
compile directly to validated Canonical and every downstream feature consumes
the resulting immutable Revision.

## MVP strategy catalog

The first catalog contains a deliberately small set that exercises the common
execution foundation without requiring arbitrary composition.

| ID | Strategy family | MVP parameters |
| --- | --- | --- |
| `single_asset_periodic` | periodically hold one asset | asset, cadence |
| `top_n_momentum` | rank a fixed universe by trailing return and hold Top N | assets, lookback, count, cadence, optional shortage fallback |
| `growth_defensive` | allocate between ranked Growth assets and one Defensive asset | growth assets, defensive asset, growth share, lookback, count, cadence, optional shortage fallback |
| `regime_fallback` | hold a risk asset when one completed-return rule passes, otherwise hold a fallback asset | risk asset, fallback asset, lookback, threshold, cadence |

Each catalog entry has:

- a stable catalog ID and version;
- typed parameter schema and defaults;
- a backend-owned Canonical factory;
- validation and capability metadata;
- a human-readable Rules projection;
- maintained LEAN lowering evidence;
- exact semantic addresses for Result and Decision Evidence.

Catalog parameters may be changed through typed backend operations. The MVP does
not expose arbitrary edge wiring, generic primitive CRUD, unrestricted nested
boolean logic, or free-form Code editing.

## One experiment foundation

Every evaluation feature accepts the same immutable `revision_id` and produces
persisted, attributable work. Evaluation policy is not Strategy meaning.

| Product action | MVP behavior |
| --- | --- |
| Quick BT | one ordinary saved Revision run |
| Detail BT | a bounded explicit matrix of parameter variants with comparable persisted Runs |
| Hidden BT | user-visible training range plus server-held evaluation range; reveal only after the evaluation run is committed |
| Robustness | timing perturbation, parameter-neighborhood variants, and seeded probabilistic execution where supported |
| Random baseline | seeded random entry/allocation baseline under the same universe, period, capital, and trade constraints |
| Forward | saved Revision plus forward start time; update its paper result from data available after that timestamp |
| Learning | problem statement selects a catalog family and supplies authoring/evaluation constraints |
| Competition | the same constrained creation path with immutable objective, limits, dataset policy, and submission Revision |

Detail, Hidden, robustness, random baseline, and Forward are separate evaluation
records linked to a Revision. They never mutate or reconstruct Canonical.

## Delivery sequence

### M0 — freeze and isolate the Builder

- Stop adding grammar after the already proven V2B-01 through V2B-04 cases.
- Remove unproven editing claims from primary navigation.
- Keep Flow and Blocky reachable only as read-oriented or explicitly labeled
  experimental views.
- Define a package boundary so Builder projections can evolve without changing
  Revision, evaluation, or Research APIs.

### M1 — fixed Rules strategy creation

- Add the versioned strategy catalog and backend Canonical factories.
- Make the creation picker open a Rules-oriented form for the four catalog
  families.
- Save the validated result through the ordinary immutable Revision path.
- Prove Quick BT, Result, Decision Evidence, and Result-to-rule navigation for
  every catalog entry.

### M2 — Detail BT

- Persist an experiment definition containing one base Revision and a bounded
  parameter grid.
- Materialize variants through catalog parameter operations.
- Execute comparable Runs and show a comparison table and selected Result.
- Enforce run-count and parameter-domain limits before scheduling work.

### M3 — Hidden BT

- Persist the visible and hidden range policy separately from the Strategy.
- Prevent hidden-period Result/Evidence disclosure before committed evaluation.
- Evaluate the exact submitted Revision and reveal an immutable score/result.
- Record dataset policy and source hashes for reproducibility.

### M4 — robustness and random baselines

- Add seeded timing perturbation and parameter-neighborhood suites.
- Add a seeded random baseline with identical universe and constraints.
- Present distributions and failure cases, not only the best result.
- Preserve the seed, generated variants, and complete BacktestConfig.

### M5 — Forward

- Pin a saved Revision and forward start timestamp.
- Evaluate only observations that become available after activation.
- Display “what would have happened” on each visit without rewriting history.
- Keep Forward paper evaluation separate from broker execution.

### M6 — Learning and Competition

- Define reusable constraint and objective policy.
- Use the same catalog Rules form with disabled/required parameters.
- Enforce constraints in both authoring preflight and evaluation.
- Persist submissions by exact Revision and evaluation-policy version.

### M7 — independent Builder track

After M1 through M6 form one usable loop, continue general-purpose Builder work
behind its stable boundary:

- richer Flow capital editing;
- composable Blocky decision editing;
- cross-perspective round trips;
- seeded probabilistic V2B-05;
- additional grammar and unrestricted composition.

Builder releases must preserve the same Canonical factory/apply, Revision, and
evaluation contracts used by catalog strategies.

## MVP completion gate

The fixed-strategy MVP is complete when a user can:

1. start from either a strategy idea or a constrained problem;
2. create and save one catalog Strategy;
3. run Quick and Detail backtests;
4. submit the unchanged Revision to Hidden evaluation;
5. run robustness and random-baseline tests;
6. activate and revisit a Forward evaluation;
7. inspect Result and Decision Evidence and navigate to the responsible Rule;
8. try one supported change, compare it, and keep or discard it;
9. enter a Learning problem or Competition whose constraints are enforced;
10. recover every saved Strategy, Revision, Run, experiment, Forward evaluation,
    and submission after leaving the page.

Automated CI must pass on the exact merge head. WSL acceptance must additionally
prove real Docker/LEAN execution and browser behavior for each newly completed
vertical slice.
