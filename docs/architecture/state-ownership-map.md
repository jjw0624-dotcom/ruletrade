# State ownership map

Audited commit: `5ceaeda56bbe5012bf755d28c580dc848814492c` (PR #75). This map describes production code, not a proposed replacement.

## Ownership rule

Only a persisted `CanonicalStrategyV2` revision owns committed financial meaning. `ProgramWorkingDraft`, native Blockly state, React Flow layout, Inspector inputs, and Quick Test configuration are intentionally separate authorities for incomplete authoring, geometry, selection, or execution configuration. A component containing editable React state is not thereby a semantic authority.

| State | Authoritative owner / storage | Created and mutated by | Consumers | Persistence / invalidation | Duplication finding |
|---|---|---|---|---|---|
| Canonical meaning | `CanonicalStrategyV2` in immutable SQLite Revision | template/bootstrap; typed `V2AuthoringOperation`; revision save CAS | projections, capability, lowerer | server revision; replaced only by a newer revision | No competing committed owner found |
| Revision identity/hash | `RevisionRecord.id`, parent and backend `source_hash` | `StrategyService`/repository | authoring CAS, Run provenance | SQLite; immutable | Client `canonicalSemanticIdentity(JSON.stringify)` is projection identity, not the CAS hash |
| Working Draft v3 | `ProgramWorkingDraft` | Builder draft helpers/native workspace events | Blocky, Flow layout, Object drafts, recovery | browser `localStorage`; invalidated by strategy key/schema | Intentionally duplicates projections, never Canonical authority |
| Blockly JSON/connections | native `Blockly.WorkspaceSvg`; serialized in Working Draft | Blockly core gestures/fields | active-root validation, recovery | local draft; disconnected/incomplete blocks persist | `canvasBlocks` is a derived index; comments explicitly keep native JSON authoritative |
| Flow nodes/edges | Canonical capital projection | `projectProgramCapitalFlow` | Flow rendering | derived on Canonical change | Not editable authority |
| Flow positions/viewport | React Flow + Working Draft | drag/pan | Flow rendering | local draft; Canonical change must preserve compatible IDs | Separate from semantic nodes by design |
| Rules edit state | component-local incomplete input | Rules/Inspector controls | typed operation on completion | ephemeral until operation succeeds | Must not write Blockly JSON |
| Objects | committed Group definitions in Canonical; incomplete definitions in Group Workspace/Working Draft | object transaction then `add/rename/remove_program_group` | Structure, Objects, references, projections | Canonical only after CAS | Definition and reference are intentionally separate |
| Inspector selection | shared semantic/draft address | selection router | Inspector | ephemeral; preserved only while identity survives | Inspector owns no semantic copy |
| Sidebar/perspective | Builder shell React state | navigation | layout | ephemeral | No semantic effect |
| Execution configuration | Quick Test form / persisted Run config | user Run gesture | executor, result | Run record, not Revision | Must not modify Canonical |
| Result/Evidence | immutable persisted Run and Decision Events | maintained executor/evidence parser | Result workspace, research loop | SQLite; loaded by versioned API | No rerun on read |

## Machine-readable ownership table

```json
{
  "schema":"ruletrade.dev/architecture/state-ownership/v1",
  "semantic_authority":"persisted CanonicalStrategyV2 revision",
  "draft_authorities":{"blockly":"native WorkspaceSvg","flow_layout":"React Flow","objects":"Group Workspace transaction","inspector":"selected-address local input"},
  "derived":{"flow_graph":"capital projection","rules":"declarative projection","summary":"meaning/readiness projection","capability":"backend preflight"},
  "execution_authority":{"config":"Run record","result":"Run result","evidence":"Decision Event records"}
}
```

## Verified violations and risks

1. `frontend/src/domain/perspectiveTranslation.ts` marks some Flow nodes editable, but complete independent Flow draft → typed intent coverage is not demonstrated for every marker. This is a P1 capability-claim risk, not proof of data corruption.
2. `canonicalSemanticIdentity()` serializes JSON for projection equality. It must never replace backend `strategy_hash` for CAS or provenance.
3. Working Draft persistence is browser-local. Save/reopen of Canonical is durable; cross-device recovery of disconnected drafts is not.

Primary evidence: `src/ruletrade/strategies/service.py`, `src/ruletrade/persistence/sqlite_strategies.py`, `src/ruletrade/strategy/v2/authoring.py`, `frontend/src/domain/programWorkingDraft.ts`, `frontend/src/domain/perspectiveTranslation.ts`, `frontend/src/components/V2StrategyEditor.tsx`, and persistence/CAS tests.
