# Expanded Semantic Corpus and Generalized Execution Closure

## Evidence boundary

This Work is stacked on PR #51 because its 33-case corpus, reference runtime,
projection manifests, and first V2 Docker differential are not yet on `main`.
It does not copy that work onto `main` or modify the Builder.

The supplied research archive contained five files. It did **not** contain the
named original `ruletrade_natural_language_cases_v3(3).jsonl`. The 169-case JSON
contains source URLs, paraphrases, dataset interpretations, unresolved terms,
flags, and declared primitive needs; it is secondary research evidence. The
URLs were not independently verified. No source paraphrase is treated as a
profitable strategy, an executable rule, or a complete strategy.

Input SHA-256:

| Artifact | SHA-256 |
|---|---|
| `RuleTrade_Expanded_Semantic_Corpus.json` | `1d922bf830c39ea5b8aba38cd248198898c90dd3ad14017a9e3fa33cfdc8292d` |
| `RuleTrade_Semantic_Gap_and_Priority.csv` | `783a097bcdb2a6454f577b44369847e95ed8bc217ba3f723691c37d3395a5694` |
| `RuleTrade_Expanded_Strategy_Research_KO.md` | `acb25489057c0c782ac6bf5558a1780e0f8dc617b02b5c3c793c7649d624c6bf` |
| `RuleTrade_Execution_Projection_Contract.md` | `b003225ca8c2fa147c080ae5eb07ac193712de2c50162ead18a951e5e7ef4ec3` |
| `Work_Semantic_Expansion_Handoff_EN.md` | `21eaee3a4b581f789a32ace9cf121ae2d47c3a4c60285a1f2cd5e56d53b922c3` |

## Reconciliation result

`corpus/expanded-semantic-case-matrix.json` preserves all 169 case records and
adds stable source groups, semantic families, combination signatures, existing
corpus overlap, gaps, provider dependencies, six independent capability states,
and evidence IDs.

| Measure | Result |
|---|---:|
| Raw research cases | 169 |
| Distinct source URLs/source groups | 61 |
| Complete strategies proven by the package | 0 |
| Strategy fragments | 169 |
| Deduplicated semantic families | 21 |
| Distinct capability-combination signatures | 127 |
| Ambiguous (fuzzy source terms) | 96 |
| Partial formalization candidates | 32 |
| Provider-blocked | 7 |
| Unsupported by current language contract | 34 |

These numbers are not added to the existing 33-case corpus. The 33 cases are
repository-owned test cases; the 169 records are source-grounded fragments. The
only new fully formalized repository strategy is the reusable weighted-momentum
execution profile described below. After this Work the repository corpus has 34
cases across 29 families: 9 formalized, 14 partial, 8 unsupported, and 3
ambiguous.

The largest expanded families are options position lifecycle (37 fragments),
opening-range Event sequence (16), adaptive composite policy (13), model and
mean-reversion pipeline (13), multi-leg options management (12), and multi-clock
context (10). Counts describe research pressure, not implementation support.

## Capability audit and selected slice

The existing Program Core already represents and reference-evaluates recursive
Values, Conditions, Events, State transitions, remembered Values, N-of-M,
cross-sectional transforms, Scores, Selection, allocations, and policy
precedence. The maintained LEAN bridge was narrower: one trailing-return
Selection plus equal allocation and optional fallback.

The expanded cases repeatedly require weighted factor combination followed by
Selection and signal-proportional allocation (notably NL038, NL112, NL123,
NL133–NL143, and NL157). Most of those particular fragments also require
fundamentals, model fitting, strategy-as-data, or other unavailable providers.
The reusable operator seam can nevertheless be verified honestly using only the
maintained adjusted-close provider:

1. completed 21- and 63-observation Candidate trailing returns;
2. an explicit 60/40 `ScoreValueV2`, normalized by absolute weight;
3. deterministic descending Top 2 Selection with symbol tie-breaking;
4. positive-score proportional allocation;
5. daily completed-close execution.

This creates one fully specified strategy fixture. It does **not** declare the
overlapping natural-language fragments complete or Docker-verified.

## Typed execution extension

The maintained path is now:

`SemanticProgramV2 → semantic validation → typed LEAN plan → generated C# → Docker LEAN → structured evidence`

The typed plan adds:

- `LeanValue(kind="weighted_score")` with typed terms, explicit weights,
  missing policy, normalization, and optional clamps;
- `LeanTargetSleeve(weighting_method="proportional_score")` with allocation
  semantic provenance;
- a strict bridge gate: one Selection, scalar DailyValue Score terms, one direct
  score-proportional allocation, no fallback, no Portfolio Split, no bounds or
  cash remainder;
- generated C# `WeightedScore` evaluation and positive-score target
  normalization;
- evidence retaining the Score semantic ID/path and Allocation semantic ID.

The v1 topology adapter is used only to reuse proven scheduling, subscriptions,
Selection, rebalance, and order generation. A temporary equal-weight topology
placeholder is replaced inside the compiler boundary by typed V2 Score and
allocation plan nodes. It is never persisted, returned as Canonical meaning, or
used as an authoring source.

Strict non-support remains explicit for cross-sectional normalization inside a
Score, condition-point Score terms, inverse-volatility allocation, allocation
bounds/cash remainder, fallback combined with proportional allocation, Split
scaling, general Event/State/Control lowering, and multi-clock lowering.

## Counterexamples and invariants

| Counterexample | Violated invariant | General correction/evidence |
|---|---|---|
| Asset-domain order changes | Selection tie behavior must not depend on input order | deterministic score/rank/targets test |
| Future rows appended after cutoff | completed observations must be prefix-invariant | truncated/full snapshot equality |
| Insufficient history produces no ranked Candidates | valid missing data must not fabricate targets or crash top-level allocation | empty Selection records `incomplete`; unresolved allocation retains holdings |
| Missing weighted Score term | `require_all` must preserve Unknown | reference Score returns unavailable; no fabricated score |
| All positive allocation inputs absent | score allocation cannot divide by zero | reference and C# gate non-positive totals |
| Natural-language fuzzy threshold | interpretation must not become executable default | 96 cases stay `ambiguous` and no case receives a hidden Program |
| Provider-only field | synthetic evaluability must not imply production provider support | provider dimension remains `UNSUPPORTED` |
| Expanded fragment overlaps Docker-tested operator | operator proof must not become whole-case proof | every expanded case remains non-PASS for Docker |

The changed missing-history behavior is a semantic correction, not a lowering
weakening: the Program remains valid, emits no targets, and explicitly retains
current holdings.

## Provider boundary

The production dataset adapter supplies completed daily adjusted close only. It
does not claim raw OHLC, volume, intraday/session bars, options chains/Greeks,
assignment, earnings availability timestamps, dealer positioning, macro series,
point-in-time fundamentals/membership, tax lots, or model-fit inputs. The family
gap matrix in the expanded corpus records these independently from language and
backend support.

## Projection contracts

All projections remain derived from the same `SemanticProgramV2` and do not
invoke lowering:

- Structure: Portfolio ownership, Investment, Assets, Selection, Allocation,
  and timing; mathematical Score internals may be omitted.
- Flow: capital route to Investment, selected exposure, optional fallback, and
  rebalance; it never presents fallback as a sequential action.
- Blocky: Program order plus recursive decision Values. Weighted Score is a
  first-class node and each term has its own semantic address and weight.
- Rules: ordered decision statements derived from Blocky without becoming an
  editable copy.
- Summary: intent and high-level behavior, not an AST or execution guarantee.
- Inspector: stable semantic IDs and canonical paths; mutations must still pass
  shared semantic operations and CAS.

Tests assert that the Score terms appear in Blocky but not as cloned Structure
children, while Flow stays capital-first.

## Builder migration contract

No Builder code changes are part of this Work.

| Disposition | Existing responsibility |
|---|---|
| KEEP | `StrategyBuilderWorkspace` shell, navigation, compact toolbox styling, selection/focus interaction, drafts, Save/Test gating, and V1 compatibility path |
| ADAPT | Structure/Flow/Blocky/Rules/Summary consumers to their own typed manifests; Inspector to stable semantic addresses; capability display to independent dimensions |
| REPLACE | any one-size-fits-all ProductNode cloning, UI-owned semantic defaults, arbitrary error-string capability inference, and presentation-shaped mutation payloads |
| REMOVE | parallel Builder authority, raw Program editing in product UI, and representation state used as compiler input |

Future integration remains:

`existing Builder shell → perspective-specific manifest/interaction → shared semantic operation → SemanticProgramV2`

## Evidence ledger

- Expanded source case: `expanded-source:NLnnn`
- Audited case: `expanded-audit:NLnnn`
- Deduplicated family: `expanded-family:<family>`
- Formalized execution fixture: `weighted-momentum-score-allocation`
- Reference tests: `tests/test_expanded_semantic_corpus.py` and
  `tests/test_semantic_strategy_corpus.py`
- LEAN profile: `weighted-momentum-score-allocation-daily-v2`
- Docker verifier: `verify_weighted_score_e2e`

Compilation is not parity. The Docker verifier independently rebuilds a
`DailyMarketSnapshot` from the exact LEAN ZIP fixture and compares every emitted
decision's two component returns through the weighted Score, ranking, Top 2,
target weights, and submitted orders with a `1e-24` Decimal tolerance for
division-derived values.

## Remaining gaps

The 169 fragments still require source verification and full formalization.
Event/State/checkpoint semantics remain reference-only in LEAN. Intraday and
session clocks, raw OHLCV, options lifecycle, strategy-as-data, model fitting,
PIT fundamentals/membership, dual-tail/long-short portfolios, position/order
lifecycle, general adaptive policy, inverse volatility, and bounded allocation
remain unproved or unsupported exactly as recorded in the matrix.
