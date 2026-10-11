# Semantic Strategy Corpus and Execution Closure

## Repository baseline

This Work starts from GitHub `main` at
`25bfdef0194c202174bf50f83026cba92e569038`, the merge commit for PR #50.
PR #47 is an ancestor through `50ff74602e24424139cb487be7b384a4e330f608`.
PR #49 was closed without merge and diverges from `main`; PR #50 superseded it and
was merged at `f2f22b2affdbb87f5f7f571fb6748745bbab9411`.

The audit does not introduce another semantic engine, Builder, or persistence
format. `CanonicalStrategyV2.program` remains authoritative.

## Capability and gap audit

| Area | Existing authority and behavior | Proven status | Gap / disposition |
|---|---|---|---|
| Value algebra | `DailyValueNode`, plus Program Values in `models.py` | Typed quantity/unit/refinement, named axes, history planning, deterministic daily reference evaluation | General Program Value lowering remains narrower than reference evaluation. |
| Recursive Condition | Comparison, ALL, ANY, NOT, N-of-M, State and Event-window Conditions | T/F/U reference semantics and bounded validation | N-of-M, State, and Event-window lowering remain unsupported. |
| Candidate scope | `CandidateBinding` owned by `SelectionV2` | Candidate Values reject a different binder | No Candidate escape is permitted; no change needed. |
| Cross-sectional transforms | rank, percentile, quantile, bucket, min-max, z-score | Explicit domain, coverage observations, stable ties | Reference-only outside the narrow Selection bridge. Domain validation now covers Eligibility as well as Ranking. |
| Composite Score | weighted Value and Condition terms | Missing policy, normalization, clamp, deterministic reranking | Reference-only; deliberately not made Builder-authorable. |
| Temporal semantics | Event, State transition, remembered and Event-relative Values | Deterministic checkpointed reference execution | No general production lowering. |
| Multiple clocks | session/daily/weekly/monthly completed boundaries | Last-completed higher-timeframe evaluation; prefix invariant | Only daily/monthly Selection timing lowers through the maintained bridge. |
| Event occurrence | every, first, ordinal; scheduled and condition edges | Deterministic count/cutoff checkpoints | General Event lowering unsupported. |
| State machine | explicit parallel state keys and ordered transitions | Checkpoint shape validation and ordered same-cutoff transitions | Hierarchical state is not inferred; production lowering unsupported. |
| Allocation | equal/fixed, proportional score, inverse volatility, bounds, cash remainder | Reference evaluation rejects impossible weights and non-positive scores | Maintained V2 bridge supports equal Selection allocation and one two-leg fixed Portfolio split only. |
| Guards/overrides/fallback | guarded primary, unique priority overrides, fallback | Total precedence and explicit winning reason | Selection shortage fallback lowers; general guarded policy does not. |
| Missing/Unknown | missing Values retain reasons; Conditions use T/F/U | Unknown is never coerced to False or zero | Provider availability must remain separate. |
| Determinism | stable semantic IDs, semantic content hashes, explicit cutoffs | repeat, input-domain reorder, and future-prefix invariants | Cache identity continues to include cutoff, domain snapshots, binding, operator lock, and run identity. |
| Provider capability | adjusted close is maintained; raw OHLC, Volume, and PIT membership are explicit limitations | Synthetic fixtures do not promote provider support | Volume, fundamentals, PIT universes, options, and external cash flows stay blocked/unsupported. |
| Persistence/CAS | immutable Revision snapshots; source-hash authoring CAS | Existing save/reopen and stale-CAS regression suite | Corpus and projections are derived and never persisted as authority. |
| V2→V1 bridge | narrow static Group Selection, compatible Conditions/Values, equal allocation, fallback, daily/monthly timing | Typed LEAN plan and generated C# | It is not general Program lowering and remains strict. |
| Projection inputs | product semantics in the Builder and new backend projection contracts | Canonical-addressed, deterministic manifests | ReactFlow, Blockly, Inspector, and Builder UI changes are outside this Work. |

## Corpus artifacts

`corpus/semantic-strategy-corpus.json` is the machine-readable inventory. Every
entry records source provenance, the original phrase, interpretation status,
dependencies, expected behavior, limitation, and six independent capability
dimensions:

`representable / reference-evaluable / backend-lowerable / Docker-verified / provider-supported / UI-authorable`

Fully formalized entries reference a stable fixture in
`ruletrade.strategy.v2.corpus.PROGRAM_FIXTURES`; resolving the fixture yields an
ordinary `SemanticProgramV2`, not a parallel DSL. The manifest currently covers:

- Selection, fallback, recursive Conditions, cross-sectional aggregation,
  composite Score, N-of-M, Events, State, remembered Values, multi-clock context,
  guards, policy precedence, score/inverse-volatility allocation, bounds, and
  overlapping exposure.
- Provider-blocked Volume and point-in-time membership.
- Explicitly unsupported fundamentals, contributions, tax lots, options, PCA,
  and pairs.
- Ambiguous prose such as “strong breakout,” “low risk,” and “reasonable
  turnover,” which receives no hidden executable interpretation.

`corpus/reference-evaluation-fixtures.json` pins snapshot identity, cutoff,
domain coverage, observations, T/F/U outcomes, Events, State, ranking, selected
assets, fallback, targets, and provenance at meaningful decision boundaries.

## Counterexample findings and corrections

| Counterexample | Result | Correction |
|---|---|---|
| Cross-sectional aggregate in Eligibility names a domain different from its Selection | Previously only Ranking was checked | Recursive Selection Value validation now rejects the mismatch. |
| History planning visits N-of-M, State, or Event-window Condition | Compatibility helper assumed every non-ALL leaf had `.child` | History planning now handles N-of-M and NOT explicitly; checkpoint predicates add no market history. |
| Input asset order changes | Selection could only be accepted if semantic outcomes stay stable | Maintained regression reverses the domain and requires identical Selection/targets. |
| Future rows appended after cutoff | Earlier results must not change | Maintained prefix-invariance regression compares the short snapshot with the extended snapshot. |
| Repeated execution | Nondeterminism would invalidate the oracle | Every fully formalized fixture executes twice and compares the complete result. |
| Fuzzy term | Hidden formalization would be false authority | Ambiguous entries have no fixture and are non-representable until explicitly defined. |

Existing Program Core regressions continue to cover axis/domain mismatch,
invalid broadcasting, unit/refinement mismatch, Candidate scope, missing history,
Unknown semantics, higher-timeframe lookahead, checkpoint injection, Event order,
tie stability, missing members, allocation conflicts, duplicate policy priority,
CAS, semantic hash/provenance, and provider overstatement.

## Reference execution

`execute_program_v2` is the reference oracle. It consumes only the Canonical
Program, a `DailyMarketSnapshot`, an explicit cutoff, and validated checkpoint
state. It does not import or consult Builder state.

Reference results include:

- snapshot and cutoff identity;
- state, Event cutoffs/truth/counts, and remembered Values;
- Selection outputs and scores;
- target weights and retained-holdings outcome;
- ordered decision evidence;
- per-Value observations with expression hash and domain coverage.

Synthetic data proves semantics only. It does not claim that a production
provider supplies Volume, fundamentals, PIT membership, or other unavailable
fields.

## LEAN execution closure

`corpus/lean-differential-matrix.json` records the executable and reference-only
profiles. The maintained executable proof is:

`CanonicalStrategyV2 → validate_strategy_v2 → lower_v2_to_v1 → typed LEAN plan → generated C# → DockerLeanRunner → structured differential`

`make check-lean-semantic-corpus` generates C# from the V2 Strongest-ETFs corpus
profile, executes it against the tracked `filter-synthetic` LEAN data, and reuses
the maintained fallback verifier. The verifier compares all twelve monthly
decisions at score, eligibility/rejection, rank, primary Selection, shortage,
fallback, final Selection, target-weight, structured-evidence, and submitted-order
boundaries. Division-derived scores use the existing operator-specific tolerance;
target weights use exact Decimal comparison.

Compilation alone is not counted as Docker verification. General Events, State,
Control, cross-sectional Score, and advanced Allocation remain reference-only.

## Capability matrix summary

| Profile | Representable | Reference | Lowerable | Docker | Provider | UI |
|---|---:|---:|---:|---:|---:|---:|
| Strongest ETFs monthly Selection/fallback | yes | yes | yes | yes | yes | yes |
| Multi-clause maintained Selection subset | yes | yes | yes | not separately proven | yes | yes |
| Cross-sectional aggregate / composite Score | yes | yes | no | no | yes | no |
| Event / State / remembered / multi-clock | yes | yes | no | no | yes | no |
| Score or inverse-volatility allocation | yes | yes | no | no | yes | no |
| Raw Volume screen | yes | synthetic only | no | no | no | no |
| PIT universe / fundamentals / cash contribution | no or incomplete | no | no | no | no | no |
| Ambiguous prose | no | no | no | no | irrelevant | no |

## Validation boundary

PASS, FAIL, NOT PROVEN, UNSUPPORTED, and ENVIRONMENT BLOCKED are reported
separately. A green compile cannot promote a profile to Docker-verified. A
synthetic reference fixture cannot promote provider support. A backend-lowerable
operation cannot imply UI authorability.

## Remaining semantic gaps

- General Program lowering for Control, Event, State, remembered Values, and
  higher-timeframe orchestration.
- Backend lowering for cross-sectional normalization, composite Score, N-of-M,
  score-derived Allocation, bounds, and cash remainder.
- Authoritative providers for Volume, raw OHLC, PIT membership, fundamentals,
  and corporate actions.
- Semantics for external contributions, tax lots, derivatives, rolling model fit,
  and matrix-valued algorithms.
- A future Builder migration against the projection contracts; intentionally not
  implemented here.
