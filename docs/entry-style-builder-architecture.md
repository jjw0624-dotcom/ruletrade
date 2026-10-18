# Entry-style unified Builder architecture

## Boundaries

The production `StrategyBuilderWorkspace` remains the only Builder shell. `SemanticProgramV2` remains the committed strategy authority, while `ProgramWorkingDraft` owns incomplete Blockly objects, reusable draft objects, graph activation, geometry, disclosure, and tentative connections. LEAN receives only validated committed semantics; draft-only objects never lower by proximity or by merely existing on the canvas.

| Surface | Decision | Responsibility |
|---|---|---|
| `StrategyBuilderWorkspace` | Keep | Shared shell, representation navigation, Inspector and resizable detail rail |
| `ProgramBlockyProjection` | Adapt | Stable keyed reconciliation of committed blocks plus free draft blocks |
| ReactFlow capital projection | Keep | Capital routing only; split legs remain parallel edges |
| Structure / Inspector | Adapt | Object ownership and contextual editing from the same Program meaning |
| `ProgramWorkingDraft` | Replace v2 schema with migrated v3 | Canvas objects, object library, active roots, connections and layout |
| Product toolbox | Replace in Blocky only | Entry-style reasoning categories; Flow retains capital vocabulary |
| Asset Workspace / `ProgramAssetUniverseEditor` | Keep and reuse | Search, provider status, large selected lists, reorder and Group membership |
| `SemanticProgramV2` authoring API | Keep | Typed validation, source hash and CAS operations |
| execution capability and lowerer | Keep | Explicit authoring/execution boundary and strict production lowering |
| historical V1 adapter | Keep | Saved strategy compatibility; no V1-to-V2 rewrite |

## Root causes fixed

1. The v2 Working Draft stored one `concept`, so starting another operation replaced the prior incomplete fragment. Schema v3 stores independently identified `canvasBlocks` and reusable objects.
2. Earlier projections reconstructed the Blockly workspace wholesale. The Program projection now reconciles by stable semantic/draft identity and only creates, updates, connects, or removes the affected block.
3. A draft type fallback rendered Group, Investment, and other drafts as an allocation/control-looking block. Draft-to-block mapping is explicit; Investment renders as Investment with typed target and amount slots.
4. Selection lived only in canonical-node lookup, so draft block focus could be lost after reconciliation. Draft identities now participate in click selection and selection restoration.
5. Toolbox availability was inferred from backend/canonical context, preventing free composition. Blocky instantiation is always draftable; runtime status is metadata and the capability gate remains downstream.
6. Connection intent used four engine-oriented buckets and could treat proximity as meaning. Entry blocks now expose real Blockly checks for Statement, Truth, Number, Percentage, Money, Quantity, Duration, Asset, Group, Subgroup, Value, Signal, Function, and State.

## Commit rule

Canvas objects are not canonical. A user may keep disconnected alternatives indefinitely. `activeGraphRootIds` records explicit activation, but activation alone does not mutate the strategy: a supported operation still has to validate through the existing authoring API and CAS boundary. Unsupported loops, waits, randomness, signals, variables, and functions remain durable Working Draft objects with technical capability metadata.

## Product semantics

- Group is reusable membership and never capital.
- Choose consumes a Group/Subgroup and produces dynamic Subgroup membership; it never allocates.
- Investment consumes available cash and has typed Target and Amount slots. Money and Quantity drafts are not translated into target weights.
- Rebalance is a separate target-weight action.
- Blocky expresses decision logic. Flow expresses capital routing. Structure expresses ownership. All committed projections read one `SemanticProgramV2`.
- Quick Test exposes period and initial capital. Recurring contributions remain absent until maintained execution supports them; advanced assumptions stay in Detailed Backtest.

## Capability policy

Verified blocks may participate in a supported committed graph. `needs_context` blocks require complete compatible semantics. `draft_only` blocks are composable and persistent but block execution if activated. Technical details remain observable without leaking engine language into normal product labels.
