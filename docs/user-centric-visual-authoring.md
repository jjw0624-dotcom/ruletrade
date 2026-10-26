# User-centric visual authoring boundary

## Verified dependency

This work is stacked on PR #57 head
`22197b8d5d1b5674f8d2ec3b96ea5e8a3acc977c`; its target is the open
`feature/semantic-engine-builder-final-integration` branch. `main` was
`7951a1c4c5b43c6deb5e4f1552fbb72ab3812bac` when the work began.

## Root-cause matrix

| Capability | Semantic support | Prior UI state | Classification | Closure |
|---|---|---|---|---|
| Unfinished IF | Program control exists | Creation disabled | Accidental restriction | Versioned Working Draft accepts a control before its predicate/branches and compiles the completed graph atomically. |
| Block movement | Not semantic | Program blocks fixed | Accidental restriction | Blocks are independently movable; coordinates persist outside Canonical. |
| Block connections | Typed Program composition exists | Projection-only connections | Accidental restriction | Blockly connection events enter the Working Draft, are type checked, and supported IF composition commits through `set_semantic_program`. |
| Flow movement/pan | Not semantic | Nodes fixed; fit on mount | Accidental restriction | Node positions and viewport persist independently; moving a node never emits a semantic operation. |
| Flow route creation | Split operation exists | Flow connections disabled | Accidental restriction | Acyclic Portfolio-to-Investment composition invokes the existing validated split operation; unsupported routes remain drafts. |
| Asset universe discovery | Asset Workspace API/chart exist | V2 used comma text | Accidental restriction | V2 Assets reuses catalog search, identity/data status, adjusted-price chart, multi-select, reorder/remove, and explicit membership commit. |
| Arbitrary condition rewiring | Conditions are typed trees | No safe general move operation | Deliberate capability boundary | The draft preserves the attempted connection and reports invalid/unsupported; it never rewrites Canonical approximately. |
| Provider-backed dynamic/PIT universe | Model distinguishes it | No production authoring contract | Deliberate capability boundary | Search remains an asset catalog; explicit membership does not claim PIT/provider support. |
| Unsupported allocation/temporal topology | Representable beyond maintained profile | Creation gated | Deliberate capability boundary | Existing capability gates remain; no simpler executable strategy is substituted. |

## State ownership

`ProgramWorkingDraft` is a versioned, strategy-keyed browser workspace record.
It owns incomplete concepts, tentative typed connections, Blocky/Flow geometry,
viewport, and draft selection. It is not a Canonical document and is never sent
to Test. The existing validated V2 authoring endpoint remains the only semantic
commit boundary; its source hash retains stale-CAS protection. Successful
commits reproject the same `SemanticProgramV2` into Structure, Blocky, Flow,
Rules, Summary, and Inspector.

Layout state survives view changes and strategy reopen through the local
workspace record. A saved revision continues to contain only committed
Canonical meaning. Undo first discards an active incomplete semantic draft,
then resumes the existing committed semantic undo/redo history.

## Asset and universe honesty

The catalog is searchable by symbol/name and reports provider data status. A
selected list is an explicit strategy asset set. It is not a watchlist, dynamic
provider universe, point-in-time membership source, or Candidate binding until
the validated Selection operation binds it. Manual symbol entry remains an
advanced fallback and explicitly does not promise data availability.

The contextual chart reuses Asset Workspace's maintained
`lightweight-charts` path and displays daily adjusted close through the API's
reported as-of date. It does not claim live data or unsupported overlays.

## Remaining deliberate limits

- Arbitrary nested statement reparenting needs a backend operation that can
  validate a multi-object graph transaction; only the complete IF composition
  closed here is committed atomically.
- Flow only commits the maintained Portfolio split relationship. Other
  meaningful routes remain visible drafts with an unsupported status.
- Dynamic/PIT universes, unverified provider instruments, advanced allocation,
  and unsupported temporal graphs retain their existing capability gates.
- Graphical acceptance must be performed in a browser-capable environment; DOM
  and mounted component coverage is not reported as graphical proof.
