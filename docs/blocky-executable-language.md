# Blocky executable strategy language

Status: design baseline for the native Builder. This document defines the product
language before further palette or execution work. It is intentionally narrower
than every node already supported by SemanticProgramV2.

## Product rule

Blocky is a visual authoring language for strategies that can be executed, tested,
inspected, and edited again. Canvas blocks describe the user's strategy. They are
not a projection of authoring transactions, CAS operations, or backend object
shapes.

The compiler boundary is:

```
editable Blocky graph
  -> typed graph validation
  -> one immutable execution snapshot
  -> SemanticProgramV2
  -> maintained LEAN lowering
  -> Result and Decision Evidence
```

Testing must never replace an editable graph with a canonical summary block.
Disconnected fragments remain editable and do not execute.

## Collection vocabulary

| Product type | Meaning | Persistence and scope | May contain |
| --- | --- | --- | --- |
| Asset | One instrument | Stable instrument identity | — |
| Group | A named reusable collection | Shared definition; edits update every reference | Assets |
| Subgroup | A locally derived collection | Value produced inside one graph | Assets |
| Universe | The set of things a strategy can address | Strategy-level namespace, not an ordinary pipeline value | Asset, Group, and Subgroup references |

A Group is not an allocation and receives no capital by itself. A Subgroup is not
saved as another independently editable Group. Internal compiler types may retain
the name `AssetSet`, but Builder copy and sockets use Asset, Group, and Subgroup.

## Responsibility rule

Each Canvas block performs one financially meaningful transformation or action.
Parameter-rich details that do not change graph topology belong in the Inspector.

| Block | Input | Output/effect | Does not own |
| --- | --- | --- | --- |
| Filter | Group or Subgroup | Subgroup containing members that satisfy its Inspector condition list | ranking, count, fallback, allocation |
| Choose top/bottom N | Group or Subgroup, metric | Subgroup with at most N ranked members | eligibility conditions, shortage fallback, orders |
| Require at least N (later) | Subgroup | Validated Subgroup or explicit empty/failed branch | ranking |
| Fallback (later) | Subgroup, alternative Asset/Group/Subgroup | Resolved target collection | ranking or allocation |
| Buy | Asset, Group, or Subgroup plus an amount | New buy orders | target-weight reconciliation |
| Sell | Asset, Group, or Subgroup plus an amount | Sell orders | target-weight reconciliation |
| Rebalance holdings | optional holding scope plus weights/policy | Orders that reconcile positions already held | selecting new candidates |
| Rotate (later) | desired Asset/Group/Subgroup plus sizing policy | Exit removed members and enter/resize desired members | candidate filtering and ranking |
| Split (later) | capital route and weighted branches | Multiple capital routes | candidate selection |

The first Filter Inspector supports a list of conditions with ALL or ANY combination.
Nested Boolean groups can be added later without adding predicate blocks to the
Canvas.

## Amount vocabulary

Order sizing and allocation are distinct.

| Value | Buy meaning |
| --- | --- |
| 1 unit each | Buy one share of every member of the target |
| $100 each (later) | Spend up to $100 on every member |
| $100 total (later) | Divide one $100 budget according to an explicit policy |
| 10% of available cash (later) | Create orders from current available cash |
| 20% target weight | Not a Buy amount; belongs to allocation/rotation/rebalance |

A recurring Start followed by `Buy target with 1 unit each` accumulates another
share of every current member at each event. It does not automatically sell removed
members or rebalance existing positions.

## Strategy catalogue

These examples define the intended expressive direction. “First” is the initial
end-to-end implementation; later entries remain out of the Add palette until their
semantics and execution evidence are maintained.

### 1. Periodic accumulation — first

```
Every monthly close
  Buy QQQ with 1 unit each
```

Expected effect: one QQQ share order at each completed monthly close.

### 2. Reusable Group accumulation — first

```
Every monthly close
  Buy Group "Core ETFs" with 1 unit each
```

Expected effect: one share order for every current Group member. Editing the shared
Group changes every graph that references it.

### 3. Filtered top-N accumulation — first vertical slice

```
Every monthly close
  Buy
    Choose top 3
      from Filter Group "Growth ETFs"
        Inspector: ALL
          126-day return > 0%
          current price > $10
      by 126-day return
    with 1 unit each
```

Filter and Choose each produce a local Subgroup. If two candidates pass, Choose
returns two because the initial shortage behavior is “use available”. Requiring
three or using a fallback is a separate later block.

### 4. Strongest ETFs with fallback — next

```
Every monthly close
  Rotate to
    Fallback to TLT when fewer than 2
      Require at least 2
        Choose top 2
          from Filter Group "ETF candidates"
            Inspector: 126-day return > 0%
          by 126-day return
    allocation: equal target weights
```

This is rotation, not accumulation: removed holdings are exited and desired members
are resized. The existing “Strongest ETFs” recipe should eventually project to this
editable graph.

### 5. Growth and defensive sleeves — later

```
Every monthly close
  Split Portfolio
    70% -> Rotate Growth selection to equal target weights
    30% -> Rebalance Defensive Group to equal target weights
```

Split owns capital routing only. Each branch owns its selection and holding policy.

### 6. Current-holdings rebalance — next

```
Every monthly close
  Rebalance current holdings to equal weights
```

This action operates on positions already held. It does not add every member of a
Group merely because that Group is connected.

### 7. Weighted-score selection — later

```
Every monthly close
  Rotate to
    Choose top 3 from Group "Growth ETFs"
      by Score
        Inspector:
          60% * 21-day return
          40% * 63-day return
          missing data: require all
    allocation: equal target weights
```

Score is one metric block whose term list is edited in the Inspector.

### 8. Waiting period — later

```
Every daily close
  Rotate to
    Choose top 1 from Group "Risk assets" by 21-day return
    re-entry rule: exclude assets sold in the last 20 completed trading days
```

Cooldown is portfolio-history eligibility, not a generic candidate Filter condition.
It requires explicit holding/order history semantics.

### 9. Regime conditional — later

```
Every monthly close
  If QQQ is above its 200-day trend
    Rotate to top 2 growth assets
  Else
    Rotate to TLT
```

The condition chooses actions. It is distinct from Filter, whose condition is
evaluated once per candidate.

### 10. Multi-clock policy — defer

Weekly context and daily execution require explicit clock sampling and deterministic
same-timestamp ordering. Do not expose this until those semantics are represented
and tested in SemanticProgramV2 and LEAN.

### 11. Temporal state sequence — defer

Breakout/retest/confirmation strategies require named state, event windows, reset,
and expiry. They should use dedicated state/event blocks rather than overloaded
Control blocks.

## Initial Add palette

Only blocks required for the maintained vertical slice are creatable:

- Start: Every daily close, Every monthly close
- Assets: Asset reference, Group reference, Create/Edit Group
- Select: Filter, Choose top/bottom N
- Metrics: trailing return, current price
- Actions: Buy
- Amounts: units each
- Data: integer, percent, USD where required by an Inspector field

Legacy block definitions remain registered so existing drafts can load and be
migrated. They are not offered for new graphs. Generic Blockly loops, arbitrary
Boolean sockets, “Buy idea (draft only)”, bundled Choose Group, and target-weight
Rebalance are removed from the new Add palette.

## Filter Inspector contract

A Filter block stores a typed condition specification, not presentation text.

Initial condition fields:

- metric: candidate trailing return or candidate current price
- lookback observations when required
- operator: <, <=, =, !=, >=, >
- typed comparison value: percent or USD/share
- combination: ALL or ANY
- ordered condition list with add, edit, duplicate, delete

Validation is local and typed. Candidate metrics are lexically bound to the input
Group/Subgroup by the compiler. Empty results are valid. Unknown/missing observations
follow an explicit maintained default and are surfaced in Decision Evidence.

## Compilation boundary

The frontend validates graph shape and sends one typed authoring operation describing
the complete executable pipeline. The backend resolves shared Group identity, creates
candidate binding and Selection nodes, creates an order-sized Buy statement, validates
the complete SemanticProgramV2 snapshot, and applies it through revision/CAS.

The initial pipeline may lower Filter + Choose into one SemanticProgramV2
`SelectionV2`; that is a compiler optimization and must not collapse the editable
Blocky graph.

A new order-sized statement is required. It must not be encoded as
`AllocationStatementV2`:

```
BuyStatementV2
  target: asset | group | selection
  amount:
    kind: units_each
    units: positive integer
```

LEAN lowering emits one market order per resolved target member at the event. Decision
Evidence records the input Group, Filter result, ranking, chosen Subgroup, requested
units, emitted orders, and any missing-data exclusions.

## Delivery sequence and PR boundaries

### PR A — language and authoring surface

- This design baseline and strategy catalogue.
- Remove unsupported/generic blocks from the new Add palette while preserving loading.
- Implement Filter Inspector and separate Choose graph blocks.
- Add graph validation, serialization, round-trip tests, and localized errors.
- No fake executable badges.

### PR B — order-sized executable vertical slice

- Add typed atomic authoring operation for Start → Filter? → Choose? → Buy units-each.
- Add SemanticProgramV2 buy statement and validation.
- Add maintained LEAN lowering and Decision Evidence.
- Add exact-head API/Docker contracts with a dataset containing every tested symbol.
- Make Test compile an immutable snapshot without replacing or rearranging Canvas blocks.

### PR C — holdings actions

- Define and implement Rebalance-current-holdings semantics.
- Define Rotate semantics for exit/enter/resize.
- Add fallback/minimum-count blocks only when the actions can consume their outcomes.

### Deferred

- Split capital routing, weighted score, cooldown, signals, multi-clock ordering,
  temporal state machines, arbitrary loops, and universal expression blocks.
- UI dashboard polish that does not unblock authoring/execution follows the first
  real executable vertical slice.


## Consolidated core-language acceptance pass

The next manual acceptance pass occurs only after these independent operators have
typed authoring, validation, projection, LEAN lowering, and evidence:

| Operator | Input | Output or effect | Owns |
| --- | --- | --- | --- |
| Filter | Group or Subgroup | local Subgroup | ordered Inspector conditions only |
| Choose | Group or Subgroup | local Subgroup | direction, count, ranking metric, shortage policy |
| Buy units each | Asset, Group, or Subgroup | additive orders | whole units per resolved member |
| Buy cash total | Asset, Group, or Subgroup | additive orders | fixed cash budget, split equally across resolved members |

Fixed cash Buy is not target allocation. At the event boundary, the compiler resolves
the target members, divides the cash budget equally, converts each share budget to a
whole non-negative quantity using the completed observation price, and records unused
cash and excluded members in evidence. It never liquidates or resizes existing
holdings.

Filter and Choose remain separate editable blocks even if the maintained execution
plan fuses them into one ranked Selection. Reprojection must preserve that editable
operator chain rather than replacing it with an opaque Investment block.
