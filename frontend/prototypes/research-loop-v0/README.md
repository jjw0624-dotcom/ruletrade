# RuleTrade research-loop UX prototype

Disposable, frontend-only interaction prototype for:

`Result → Why → Change → Compare → Why different?`

Run from this directory:

```bash
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173`.

Useful deterministic states:

- `#decision` — June 3 selected
- `#why` — explanation expanded
- `#edit` — inline threshold edit
- `#compare` — Original vs Candidate
- `#differences` — differences-only comparison

## Boundary

This folder does not call RuleTrade APIs and does not define a production domain contract. Decision trace, candidate edit, comparison, and feedback affordances are deterministic research fixtures. Labels and causal rules are aligned to the existing Canonical v1 Filter / Momentum / Fallback / Portfolio Sleeve semantics.
