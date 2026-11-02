# Builder responsibility contract

## Shared domain and services

Stable strategy, semantic object, Group/Subgroup, instrument, revision, validation, execution-capability and result identities belong to the product domain. They are not owned by Blocky or Flow. Group definitions and references are distinct records. Creating a definition has no visual side effect.

## Perspective ownership

| Perspective | Owns | Must not own |
|---|---|---|
| Blocky | logic graph, native typed connections, block geometry, flyout, selection, workspace undo and serialization | Portfolio scaffolding, Group definitions, Flow edges, Canonical revisions |
| Flow | capital nodes and edges, handles, node positions, viewport | arithmetic, every predicate, Blockly geometry |
| Rules | readable committed financial rules | a second editable graph |
| Code | precise read-only typed semantics and capability | generated LEAN as a lossless editable source |
| Structure | object hierarchy, definitions, references and dependency navigation | visual graph geometry |
| Summary / Guide | explanation and guided entry points | authoritative strategy state |

## Inspector

Inspector is a contextual product editor. It may edit advanced parameters through the owning native API or typed semantic operation. It may show capability, provider, dependency and unresolved-input diagnostics. It does not own Blockly connections, Flow edges, duplicate Canonical fields, implicit Group references, or perspective selection.

Selection is the tuple `(perspective, semantic identity?, visual draft identity?, origin, editor context)`. The shell may route this selection, while each perspective retains its native selected element. Closing Inspector changes selection only; it never deletes or disconnects the selected object.

## Object Library and Group Workspace

- Object Library owns Group discovery and definition lifecycle.
- Group Workspace owns membership editing and reuses the maintained instrument workspace.
- Blockly Assets exposes typed references to committed Groups.
- A Group reference exists only after a native Blockly insertion or explicit compatible-slot completion.
- Rename keeps the stable Group ID and reprojects labels.
- Delete must pass dependency checks.
- Cancel commits neither the object nor a reference.

## Semantic boundary

`perspective gesture → recoverable draft/typed intent → readiness → semantic operation → source-hash CAS → SemanticProgramV2 → projection`

Layout changes stop at Working Draft. Incomplete gestures remain recoverable. Only validated active graphs may request semantic commitment. Execution support is assessed independently from visual availability.
