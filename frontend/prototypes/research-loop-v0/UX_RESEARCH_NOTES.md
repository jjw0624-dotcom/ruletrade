# UX research notes

## Hypothesis

A Strategy Explorer can move from an anomalous result to a causal explanation and a one-parameter comparison without leaving the market-time context or opening the Strategy Editor.

## Core journey

1. Notice the orange June 3 decision marker: `TLT 85%`.
2. Select it to see the before/after holdings.
3. Ask `Why was it TLT?`.
4. Follow the causal chain: one Growth asset passed → required two → TLT fallback supplied Growth 70% → Defensive TLT 15% aggregated → final TLT 85%.
5. Edit the relevant strict filter in place from `0%` to `-5%`.
6. Compare Original and Candidate.
7. Use `Only differences` and inspect June 3.
8. Follow condition difference → decision difference → holding difference → result difference.

The shortest intended path is six clicks: June marker, Why, Try a change, Compare, Only differences, changed decision. The first changed decision is already selected after Compare, so understanding the main divergence takes five clicks.

## Real semantics used

- 126 completed trading-day return signal.
- Strict `score > threshold` filter; equality does not pass.
- Descending rank followed by Top 2.
- Explicit, all-or-nothing TLT fallback when fewer than two assets qualify.
- Growth 70% and Defensive 30% Portfolio Sleeves.
- Equal-weight Defensive TLT/IEF targets.
- Additive symbol aggregation: Growth TLT 70% + Defensive TLT 15% = final TLT 85%.

The prototype does not change or extend these production semantics.

## Prototype-local mock boundary

All files live inside this prototype directory. No production API is called. The following are deterministic fixtures, not production contracts:

- decision candidates and scores on June 3;
- structured explanation/decision trace;
- inline Candidate Change;
- Original/Candidate metrics and equity paths;
- difference counts, divergence dates, and causal explanations;
- disabled feedback affordances.

## Backend/domain data production would need

- Stable run, strategy revision, component, sleeve, event, decision, and order identifiers.
- Event timestamp plus market-data cutoff/readiness provenance.
- Per-asset signal value, eligibility, filter result, ranking, candidate, selected result, and rejection reason.
- Fallback activation and source component provenance.
- Sleeve-local targets, scale factor, symbol-level contributions, merged final targets, and resulting orders.
- A safe parameter-patch representation tied to the authoritative Strategy Model component/field.
- Experiment records linking Original and Candidate to exact strategy revisions, run configuration, dataset, engine/compiler versions, and deterministic results.
- Decision/holding/order diffs aligned by comparable events.
- Performance and risk deltas plus largest-divergence windows.
- Trust metadata for data version, execution status, warnings, and reproducibility.
- Later: user feedback annotations tied to chart time, instrument, decision, and strategy revision; holdout/forward period definitions.

## Production candidates

- Question-led Result workspace and time-anchored decision Inspector.
- Plain-language causal chain with observed values visually distinct from editable conditions.
- Inline one-field Candidate Change that preserves Original.
- Comparison centered on changed behavior, with `Only differences` and `Why different?`.
- Persistent focused-date context across Result and Compare.

## Deliberately disposable

- Hand-authored equity SVG paths and absolute marker placement.
- Hard-coded 2024 scores, metrics, counts, and divergence dates.
- Hash-based state routing and DOM-only state management.
- Static dialog details and disabled feedback buttons.
- Prototype CSS rather than production components/design tokens.

## Self-review and iteration

1. **Why TLT?** The first explanation sentence answers it, then the score table and allocation chain prove it. The ambiguous phrase “fallback happened” was avoided in favor of `1 of 2 qualified` and explicit sleeve arithmetic.
2. **Editor detour?** None. The exact Strategy condition appears in the Inspector where the decision is explained.
3. **Interaction count?** Five clicks to understand the largest Candidate divergence; six to explicitly activate difference-only and reselect it. Candidate input is prefilled at −5% to test the intended one-change flow without typing.
4. **Why behavior changed?** The Compare Inspector explicitly links VGT −3.2% against both thresholds, then condition → decision → holding → result.
5. **Lost time context?** June 3 is shown in the marker, Inspector heading, Compare context chip, divergence window, difference row, and Why-different heading.
6. **Requires quant metrics?** No. Default summary uses Return, Largest drop, Orders, and plain-language behavior counts. Advanced metrics are behind Details.
7. **Semantic/result confusion?** Observed scores use `Observed result`; mutable threshold uses a bordered `Editable strategy condition`; Original is stated as untouched.
8. **Future fit?** Timeline decisions can accept feedback annotations; comparison toolbar can add Holdout/Forward alongside Advanced without changing the primary loop.
9. **Unnecessary complexity?** The timeline is intentionally limited to four notable events. Trades/Rebalances tabs and a dense metrics grid were removed from the primary view.
10. **Fewer interactions?** Compare lands with the largest changed decision already selected and Why-different visible. `Only differences` is optional for the first explanation, reducing the essential path.

## Known research risks

- The orange marker may still compete with the equity curve; test whether users notice it without prompting.
- `Largest drop` is easier than drawdown but may need a tooltip before production.
- The prefilled −5% Candidate accelerates this scenario but does not test parameter discovery or free-form editing.
- A real run may have many events; grouping and search behavior remain untested.
