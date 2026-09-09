# Usability test notes

## Research hypothesis

A first-time Strategy Explorer can understand RuleTrade as a place to test understandable investment rules, reach a meaningful result, investigate an unusual decision, and compare one changed assumption without instruction or quant vocabulary.

## Facilitator stance

- Start at the landing screen and say only: “Please explore this as if you found it yourself.”
- Do not point out Growth + Defensive, June 3, `Worth a look`, or `Only differences`.
- Ask the participant to think aloud without teaching terminology.
- Use **Reset test** between participants.

## Critical path and minimum interactions

| Transition | Interactions | Expected action |
| --- | ---: | --- |
| Landing → templates | 1 | Explore strategies |
| Templates → strategy | 1 | Use this strategy |
| Strategy → result | 1 | Run backtest; loading resolves automatically |
| Result → interesting decision | 1 | See why, or the June marker |
| Decision → causal understanding | 0 | Explanation is revealed in context |
| Why → quick change | 1 | Try changing this |
| Change → compare | 1 | Compare; −5% is prefilled |
| Compare → difference focus | 1 optional | Only differences |
| Difference → why different | 0 | Largest June 3 difference is already selected |

Minimum to reach and understand Why-different: **6 clicks**. With Only differences explicitly enabled: **7 clicks**. Typing is optional on the intended scenario.

## Existing RuleTrade semantics represented

- Growth and Defensive Portfolio Sleeves at 70%/30%.
- Growth universe: QQQ, VGT, SOXX, SCHG.
- 126 completed trading-day return signal.
- Strict return-score threshold (`score > threshold`).
- Descending rank and Top 2 selection.
- Explicit all-or-nothing TLT fallback when fewer than Top 2 qualify.
- Defensive TLT/IEF equal weighting.
- Additive target merging, producing TLT 85% when Growth contributes 70% TLT and Defensive contributes 15% TLT.

The prototype changes none of these semantics.

## Deterministic mock assumptions

- $10,000 grows to $13,740; headline return +37.4%; largest decline −18.2%.
- June 3 values: QQQ +24.3%, VGT −3.2%, SOXX −27.5%, SCHG −33.2%.
- A −5% Candidate lets VGT pass and avoids the Growth fallback.
- Candidate result: +38.3%, −18.9% largest decline, 34 orders.
- Four decisions and three holdings differ, with the largest divergence during June–July.
- Equity paths, dates, order counts, comparison, loading, and explanation records are fixed fixtures.

## Production data/domain requirements

- Persistent Strategy revisions with stable component and parameter identities.
- A user-safe semantic parameter patch that creates a Candidate without overwriting Original.
- Backtest run identity and reproducibility metadata: Strategy revision/hash, dataset/version, config, engine/compiler version, warnings.
- Time-aligned Decision Trace: signal observations, data cutoff, eligibility, filter result, rank, candidate, selected result, fallback reason.
- Sleeve-local targets, scale contributions, merged final targets, holdings before/after, and linked orders.
- Experiment/Comparison entities linking Original and Candidate runs.
- Comparable-event alignment and decision/holding/order diffs.
- Performance/risk deltas and divergence-window calculation.
- Later: annotations and feedback tied to event, symbol, run, and Strategy revision; holdout/forward period definitions.

## What to observe and ask

Observe first; ask afterward:

1. In your own words, what is RuleTrade for?
2. What made you choose that example? What did you expect it to do?
3. Before running it, explain the Growth and Defensive parts.
4. Which values looked changeable? Did you want to change any?
5. What does the result tell you? What does it not tell you?
6. What attracted your attention after seeing the result?
7. Why did TLT become 85% on June 3?
8. Which rule caused that outcome?
9. What did the Candidate change? Was the Original preserved?
10. Why did Original and Candidate hold different assets?
11. Which version would you prefer, and what else would you need to know?
12. What is the next “what if?” or “why?” question you would try?

## Self-review and changes made

- Landing copy is one sentence plus a three-step mental model; no architecture or quant terms.
- The primary landing action says `Explore strategies`, matching the next screen rather than implying a blank editor.
- Template preview exposes every important rule before selection; only one template is fully runnable to keep the test coherent.
- Strategy values use question labels and visible input borders. Observed results never use the same editable treatment.
- Run settings were omitted; they would add decisions unrelated to this hypothesis.
- Result begins with dollar growth and plain-language decline, not Sharpe/Sortino.
- `Worth a look` makes the anomalous event discoverable without presenting it as advice or an AI recommendation.
- Why is revealed inline under the same chart/date context; there is no debugging page.
- The causal explanation includes sleeve arithmetic so the participant can derive 85%, not merely accept it.
- Candidate comparison opens with June 3 already selected and Why-different visible, removing a redundant click.
- Original/Candidate labels repeat at the top of Compare; no memory of the prior screen is required.
- Reset is globally visible but visually quiet.

## Known weaknesses

- Non-primary template cards are preview-only; participants may feel constrained if they choose another mental model.
- The landing promise “shape your own” is broader than this prototype's single runnable template.
- The prefilled −5% Candidate tests comprehension and comparison more than free-form hypothesis formation.
- Static mock results cannot test trust in real execution time, failures, or provenance.
- Desktop-only minimum width is acceptable for this study but not production-ready.
- A real strategy may produce too many decisions for the simple difference list.

## Production candidates vs. disposable work

Potential production patterns: plain-language template preview, question-led Strategy view, in-context `Worth a look`, time-anchored Why Inspector, semantic quick-change preserving Original, behavior-first Compare, `Only differences`, and the condition → decision → holdings → result chain.

Disposable: static routing, DOM state, hard-coded fixtures, artificial loader, hand-authored SVG paths/marker coordinates, prototype CSS, single runnable template, and fixed comparison copy.
