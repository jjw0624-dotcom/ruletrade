# Strategy corpus and decomposition matrix

| # | Strategy family | Predicate | Candidate/Eligibility | Ranking | Take/shortage | Classification |
|---:|---|---|---|---|---|---|
| 1 | Absolute momentum | market gate | return > 0 | return desc | N / require full | executable |
| 2 | Weakest momentum | none | return >= floor | return asc | N / choose all | executable |
| 3 | Dual momentum | benchmark return > 0 | candidate return > 0 | return desc | 1 / require full | executable by composition |
| 4 | Defensive switch | risk return <= 0 | candidate return > floor | return desc | N / otherwise | executable by composition |
| 5 | Multi-clause screen | none | return > floor ALL return < cap | return desc | N / choose all | executable |
| 6 | Price above average | none | price > average | return desc | N | semantic-only |
| 7 | Volume surge | none | volume > 2.5× average | volume desc | N | deferred executable metric |
| 8 | Cheapest assets | none | valuation present | valuation asc | N | deferred data family |
| 9 | Highest yield | none | yield > floor | yield desc | N | deferred data family |
| 10 | Lowest volatility | none | history sufficient | volatility asc | N | deferred metric |
| 11 | Drawdown recovery | drawdown < limit | recovery > floor | recovery desc | N | semantic-only |
| 12 | Random basket | none | candidate | random | N | deferred deterministic primitive |
| 13 | Contribution plan | schedule | cash flow available | none | none | distinct Contribution family |
| 14 | Group breadth | breadth gate | member signal | signal desc | N | deferred group semantics |
| 15 | Parameter threshold | none | return > parameter | return desc | N | typed semantic model |
| 16 | State-aware re-entry | state gate | cooldown complete | return desc | N | existing cooldown composition |
| 17 | Stress: volume/reference/contribution | market condition | volume > 2.5× reference average | intentionally configurable | N | intentionally unresolved/deferred |

The stress case is not silently translated into trailing return. It exposes three independent gaps: volume history, reference-average semantics, and cash contribution. Ranking direction/measure must be chosen by the author; “movement” is not assigned an invented meaning.

## Coverage conclusion

The reusable grammar covers value construction and condition composition, while compiler support is deliberately narrower. Each unsupported row remains explicit rather than being mapped to a convenient but false primitive.

## Semantic Subjects and Typed Values v1 update

| Corpus gap | New status | Boundary |
|---|---|---|
| finite explicit candidates | executable semantic Universe | `universe@1` resolves explicit asset set or static Group |
| stable Growth collection | persisted static Group | never overwritten by a daily Selection result |
| current price | dataset-evaluable typed value | strategy compiler remains deferred |
| rolling price aggregate | dataset-evaluable typed value | completed observations, bounded window, no lookahead |
| current/average volume | semantically representable | price-only CSV cannot evaluate; compiler deferred |
| Group breadth/NAV | deferred | membership does not imply NAV or across-member aggregation |

The complex stress strategy is now decomposed honestly:

- all stocks: semantically representable as provider-backed Universe, not executable without
  point-in-time provider membership;
- multi-condition Candidate eligibility, ranking, Top N, choose-all, and equal allocation:
  executable today only for the Candidate trailing-return subset;
- `2.5 ×` average volume: typed series/aggregate/arithmetic shape is representable, but volume
  evaluation and compiler support remain deferred;
- monthly $1,000 Contribution: still a distinct deferred cash-flow family.
