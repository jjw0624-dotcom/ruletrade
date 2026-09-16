# Strategy Builder workspace

> **Status: SUPERSEDED.** This established the Builder before Activity and
> Research integration. See [the living architecture](architecture.md).

The Strategy editor is one viewport-height workbench over one working
`CanonicalStrategyV1`. Summary, Guide, Flow, Structure, and the Inspector are
projections and controls around that same document; none of them persists a
second Strategy model.

## State and mutation boundary

- The editor store owns working Canonical, Registry, dirty/validation status,
  the active representation, and one semantic selection (`component_id`,
  optional `field_path`, role/context).
- Representation switching, xyflow positions/viewport, panel state, and
  Dashboard state are UI-only and never mark Canonical dirty.
- Typed parameter controls reuse the existing semantic patch path.
- Structural insertion and deletion use the backend capability/apply contract.
  The frontend does not recognize valid graph topology independently.
- Every successful structural operation replaces working Canonical with the
  backend-validated response and all representations reproject.
- Save continues through the immutable Strategy Revision API.

## Workspace surfaces

The compact chrome owns representation choice, Strategy identity/save state,
and Test. The collapsible left surface has a semantic Structure tree and
contextual Add surface. Selecting the same component in Structure, Guide, Flow,
or Evidence drives one shared Inspector. The Inspector is absent when there is
no meaningful selection.

Saved Runs live in the representation-independent Dashboard rail instead of a
large section below the editor. A right-side Research host can mount an
existing Result workspace while leaving the Builder mounted; this establishes
the layout boundary for a later integrated Research Layer without duplicating
research state.

## Construction grammar

The Add surface is contextual: the selected semantic target plus the backend
capability response determines which operations appear. Click-to-insert and
the quick transformations converge on the same backend operations:

- direct investment to ranked Choose;
- ranked Choose to one qualification;
- filtered selection to fallback;
- simple portfolio output to explicit Growth + Defensive allocation.

Removal is exposed only where a valid inverse exists. Qualification and an
unshared generated fallback can be removed atomically. Group deletion,
collapsing a Split, arbitrary connections, and primitive deletion remain
unsupported because their surviving ownership or investment intent is not
unambiguous.

## Rendering infrastructure

xyflow owns node/edge rendering, selection mechanics, dragging, zoom, pan,
viewport, background, and fit-view behavior. RuleTrade owns the conceptual
projection, semantic identity, selection/Inspector linkage, backend operations,
Canonical, and Evidence provenance. xyflow nodes and coordinates are never
serialized into Canonical.

Radix Collapsible and Tabs provide keyboard/focus behavior for the left panel,
its Structure/Add switcher, and Dashboard. Cross-surface drag/drop was not
needed: contextual click-to-insert is clearer while detached blocks and empty
canvas drops have no valid Canonical meaning. dnd-kit is therefore deferred.

## Future representation contract

A future representation should supply only:

1. `Canonical -> representation projection`;
2. `representation gesture -> SemanticSelection or existing semantic operation`.

It reuses the working Canonical, Inspector, save path, Dashboard, Research
host, and Evidence provenance. A future Blocky or Rules surface must not add a
new Strategy store or persistence model.
