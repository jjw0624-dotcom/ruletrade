# Group, Choose, and Investment production execution

The production compiler now lowers the bounded allocation-driven
`SemanticProgramV2` grammar directly to the existing typed `LeanPlan`.
It does not synthesize a Selection for direct assets and does not create a
strategy-specific execution engine.

## Maintained static grammar

| Semantic operation | Typed plan meaning |
|---|---|
| Asset Investment | one direct `LeanTargetSleeve` |
| Group Investment | one equal-weight sleeve over Group membership |
| Choose/Subgroup Investment | `LeanMomentumSelection` consumed by a sleeve |
| Fixed Split | independently weighted sleeves followed by target aggregation |
| IF/OTHERWISE Investment | one `LeanRebalance` with typed condition and two routes |

Portfolio share is represented by `LeanTargetSleeve.total_weight`. For Split
legs, `local_total_weight=1` and `source_allocation` retain the distinction
between within-sleeve allocation and Portfolio routing. Duplicate symbols are
summed during final target aggregation.

Conditions use three-valued comparison results. Missing observations produce
`unknown`; `retain` skips execution and `otherwise` selects the alternative
route only because that policy is explicit in Canonical.

## Strict unsupported boundary

The compiler rejects session clocks, weekly static allocation clocks,
inverse-volatility allocation, bounded score allocation, OR/NOT static routing,
cash/retain static targets, and external contribution semantics. These remain
editable where representable and never disappear silently during lowering.

The differential profiles are created through production typed authoring
operations, saved as `SemanticProgramV2`, evaluated by the reference runtime,
compiled to generated C#, and compared with Docker LEAN target evidence.
