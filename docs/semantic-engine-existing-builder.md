# Semantic engine integration in the existing Builder

## Product boundary

RuleTrade has one production authoring product: `StrategyBuilderWorkspace`.
`SemanticProgramV2` is a canonical meaning and execution boundary, not a user-facing
editor. Both persisted v1 strategies and Program-native v2 strategies enter the
same Builder chrome, representation navigation, Add/Structure panel, Blocky entry
point, and Inspector entry point.

```text
StrategyBuilderWorkspace
  -> v1 compatibility adapter -> CanonicalStrategyV1
  -> semantic program adapter -> SemanticProgramV2
```

Historical v1 revisions are never rewritten. The v1 adapter retains the existing
graph authoring contract, projections, persistence, and LEAN path. The v2 adapter
emits typed, semantic-id-addressed intents with an expected source hash. The
backend validates each intent and atomically returns a complete replacement
Canonical document.

## Shared production surfaces

- `WorkspaceLeftPanel` renders Structure and contextual Add tools for either
  backend without exposing raw Program statements.
- `BlockyView` remains the decision/program structure representation. Complex
  Values stay compressed and are edited in the Inspector.
- `SemanticInspector` remains the sole primary Inspector. Its content is selected
  by semantic role such as Selection, Condition, Event, State, or Allocation.
- Summary, Guide, Flow, Blocky, Rules, Code, and AI remain in the normal Builder
  navigation. Flow remains capital-first; Rules and Summary are projections.
- The Assets entry remains part of the shared Builder chrome and focuses the
  relevant Selection/asset context.

Incomplete Value, Condition, Event, or transition input remains local and gates
Save/Test. Complete edits auto-apply through the semantic authoring service.
Source-hash compare-and-swap prevents late requests from overwriting a newer
Canonical state. Save persists only validated Canonical v2 through the ordinary
Strategy/Revision repository.

## Execution boundary

The Builder never compiles presentation state. Supported v2 execution follows:

```text
SemanticProgramV2 -> validation -> typed plan -> lowering -> generated C# -> LEAN
```

Authorable, reference-valid, lowerable, provider-available, and production-
executable are separate capabilities. Predictably unsupported execution is gated
before Run; local Docker availability is reported as an environment limitation.

## PR #48 audit

| Disposition | Work |
|---|---|
| PORT | Program-addressed intent models and mutation logic, source-hash CAS, capability discovery, persistence/template helpers, semantic type mirrors, Value/Condition composition, and engine tests. |
| REIMPLEMENT | Program creation, progressive Value/Condition controls, Event/State/Allocation controls, projections, undo/redo, and contextual Add were connected through the existing Builder adapters and shared production entry points. |
| DROP | `V2ProgramWorkspace`, a separate v2 navigation shell, a separate v2 Blocky route, raw statement-list editing, and internal bootstrap/semantic IDs as primary UX. |

PR #48 remains a closed, unmerged architectural prototype and is not an ancestry
base for this work.
