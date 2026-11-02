# Semantic-first block and Inspector audit

This audit records the production responsibility decision made before the compact-block implementation. The reported browser evidence is treated as a regression input: Portfolio was visible in Blocky, blocks were vertically oversized, and the native category menu was detached from the Builder Add mode.

| Surface | Decision | Existing responsibility | Required correction |
|---|---|---|---|
| `StrategyBuilderWorkspace` | KEEP | One production shell, representation lifetime, Inspector and result rail | Preserve mounted Blocky state while Add and Inspector change |
| `SemanticProgramBuilderAdapter` | ADAPT | V2 projections, Working Draft, typed operations and CAS boundary | Share Add category state with Blockly; derive Inspector copy from the block UI contract |
| Native Blockly workspace | ADAPT | Geometry, connections, focus, event history, serialization and flyout | Use compact sentence-like financial blocks and a single Add-controlled category navigation |
| Blockly registrations | REPLACE definitions, KEEP engine | Core Logic/Math/Control/Variables/Procedures plus RuleTrade financial blocks | Replace vertical title-plus-slot scaffolding with contract-driven horizontal messages |
| Inspector | ADAPT | Context, diagnostics, capability and object navigation | Keep primary inputs on blocks; expose contract-defined advanced information only |
| Object Library | KEEP | Stable reusable definition identity and dependency counts | Keep Group definition separate from explicit reference insertion |
| Group/Asset Workspace | KEEP | Search, membership, ordering, charts and provider metadata | Continue empty-slot creation and explicit reference continuation |
| Flow / React Flow | KEEP | Capital routing and layout-only viewport state | Do not project arithmetic or Blockly execution syntax into capital flow |
| Working Draft v3 | ADAPT migration | Disconnected blocks, native workspace JSON, positions, viewport and recovery | Remove legacy Portfolio scaffolding without touching unrelated blocks |
| Active graph validation | KEEP | Validate only explicit active roots and typed connections | Consume the same block contract connection types |
| Visual-to-semantic translation | KEEP | Typed intent to semantic operations and CAS | Do not commit disconnected or unsupported graphs |
| Capability assessment | ADAPT source | Separate authoring, semantic, lowering, Docker, provider and runtime dimensions | Derive block-facing capability language from the same UI contract |
| Legacy React text-card Blocky toolbox | REMOVE for Blocky | Older manual card navigation | Blocky Add selects one category; Blockly renders the shaped flyout previews |
| Canonical Portfolio context block | REMOVE from Blocky only | Internal projection context | Keep Portfolio in Canonical, Structure and Flow; filter/migrate it from Blockly |

## Responsibility levels

1. **Compact block surface** owns trigger, condition, target, action, amount/weight, branch and fallback meaning needed to read a connected strategy.
2. **Expanded block detail** owns material policy such as shortage, internal weighting and evaluation boundary when it cannot remain concise.
3. **Inspector** owns identity, explanation, advanced policy, diagnostics, capability, dependencies and navigation. It is not a second primary form.

The machine-readable contract in `frontend/src/domain/blockUiContract.ts` is the implementation authority for these levels. Blockly registration, toolbox summaries and the selected-block Inspector consume it; prose in this file is not a second source of labels.
