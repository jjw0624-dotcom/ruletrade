# Composable Strategy Language v1

## Decision

Canonical remains the source of truth. The existing recursive expression tree is extended with `Candidate`, while authoring roles remain explicit:

| Role | Scope | Fallback meaning |
|---|---|---|
| Predicate | strategy/control decision | OTHERWISE branch |
| Eligibility | each Selection candidate | candidate excluded |
| Ranking | eligible set | ordering only |
| Selection | ordered set | shortage policy |
| Allocation | selected set | portfolio targets |

A Candidate reference is legal in Eligibility and ranking expressions and illegal in a control Predicate. This prevents Eligibility from being mistaken for Predicate.

## Executable v1 boundary

- Value expressions retain literals, parameters, state, price, average cost, indicators, component outputs, and typed arithmetic.
- Conditions retain comparisons, AND/OR, and NOT in Canonical.
- The executable LEAN Selection subset is Candidate trailing return compared to percentage literals, with one comparison or a one-level ALL group.
- Operators: `>`, `>=`, `<`, `<=`.
- Ranking: trailing-return score, ascending or descending, deterministic symbol tie-break.
- Selection: Top N with `require_full` or `choose_all`.
- Predicate compilation remains the established explicit-asset trailing-return subset.
- Existing typed Control still evaluates Predicate first and only the selected branch program.

ANY, NOT, nested boolean groups, arbitrary price/volume/reference averages, and arbitrary arithmetic are valid semantic model concepts but not offered as executable Selection controls in v1. Desugaring fails honestly if they enter the executable path.

Random remains deferred: no ambient RNG is introduced. Contribution remains a distinct cash-flow family and is deferred. Group metrics remain deferred until membership and aggregation semantics are specified. Flow Capital Composer is outside this change.

## Lowering

`Canonical condition → typed validation → FilterClause[] → LeanFilterClause[] → C# Where(predicate)`.

`rank.direction → OrderBy/OrderByDescending → ThenBy(symbol)`.

`top_n.shortage_policy` controls whether an incomplete result returns without mutation or executes with every eligible candidate.

Legacy filter/rank/top-N documents deserialize with `gt`, `descending`, and `require_full` defaults.

## Evidence contract

Selection evidence continues to identify score, rank, selection, evaluated candidates, ranks, stopping reason, and final targets. The generated filter is the executable truth; one-level ALL clauses are evaluated inside the single candidate predicate. No unselected typed-Control branch emits branch-local Evidence.

## Acceptance boundary

GitHub Actions is the implementation validation environment. WSL acceptance must repeat backend tests, frontend tests/build, generated C# compilation, and a real LEAN run where the local LEAN environment is available.
