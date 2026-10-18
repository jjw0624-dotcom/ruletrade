import type { Viewport, XYPosition } from "@xyflow/react";
import type { ConditionV2 } from "./canonicalV2";
import type { FinancialIntentDraft } from "./intentAuthoring";

export const PROGRAM_WORKING_DRAFT_SCHEMA = "ruletrade.dev/program-working-draft/v3" as const;

export type ProgramDraftStatus = "clean" | "incomplete" | "invalid" | "ready" | "unsupported";
export type ChooseProgramDraft = { kind: "choose"; semanticId: string; groupId: string | null; outputId: string; lookback: number; direction: "highest" | "lowest"; count: number; shortage: "choose_all" | "require_full"; withQualification?: boolean };
export type InvestmentProgramDraft = { kind: "investment"; semanticId: string; targetKind: "asset" | "group" | "selection" | null; targetRef: string | null; internalAllocation: "equal" | "proportional_score"; amountKind?: "money" | "cash_fraction" | "quantity" | null; amountValue?: string };
export type GroupProgramDraft = { kind: "group"; semanticId: string; name: string; assets: string[]; resume?: ChooseProgramDraft | InvestmentProgramDraft };
export type ProgramDraftConcept =
  | { kind: "selection"; semanticId: string; universeId: string; withQualification?: boolean }
  | GroupProgramDraft
  | ChooseProgramDraft
  | InvestmentProgramDraft
  | { kind: "event_state"; semanticId: string }
  | { kind: "control"; semanticId: string; condition: ConditionV2 | null }
  | FinancialIntentDraft
  | null;

export interface ProgramDraftConnection {
  childId: string;
  parentId: string | null;
  inputName: string | null;
}

export interface ProgramCanvasBlock {
  id: string;
  definitionId: string;
  label: string;
  createdAt: string;
  active: boolean;
  objectRef?: string | null;
}

export type ReusableObjectKind = "group" | "subgroup" | "variable" | "function" | "signal";
export interface ProgramReusableObject {
  id: string;
  kind: ReusableObjectKind;
  name: string;
  version: number;
  dependencies: string[];
  capability: "verified" | "draft_only";
}

/**
 * User-owned workspace state.  It is deliberately not CanonicalStrategyV2:
 * incomplete objects, visual geometry, and tentative connections are valid here.
 */
export interface ProgramWorkingDraft {
  schema: typeof PROGRAM_WORKING_DRAFT_SCHEMA;
  strategyKey: string;
  status: ProgramDraftStatus;
  concept: ProgramDraftConcept;
  canvasBlocks: Record<string, ProgramCanvasBlock>;
  reusableObjects: Record<string, ProgramReusableObject>;
  activeGraphRootIds: string[];
  /** Native Blockly JSON is the sole persisted authority for Blocky geometry and connections. */
  blocklyWorkspace: Record<string, unknown> | null;
  blocklyViewport: { x: number; y: number; scale: number } | null;
  blockPositions: Record<string, XYPosition>;
  flowPositions: Record<string, XYPosition>;
  blockConnections: Record<string, ProgramDraftConnection>;
  blockDisclosure: Record<string, 0 | 1 | 2>;
  flowViewport: Viewport | null;
  selectedDraftId: string | null;
  diagnostics: Array<{ code: string; productMessage: string; technicalDetail: string }>;
  updatedAt: string;
}

export function emptyProgramWorkingDraft(strategyKey: string): ProgramWorkingDraft {
  return {
    schema: PROGRAM_WORKING_DRAFT_SCHEMA,
    strategyKey,
    status: "clean",
    concept: null,
    canvasBlocks: {},
    reusableObjects: {},
    activeGraphRootIds: [],
    blocklyWorkspace: null,
    blocklyViewport: null,
    blockPositions: {},
    flowPositions: {},
    blockConnections: {},
    blockDisclosure: {},
    flowViewport: null,
    selectedDraftId: null,
    diagnostics: [],
    updatedAt: new Date(0).toISOString(),
  };
}

export function programDraftStorageKey(strategyKey: string): string {
  return `ruletrade:program-working-draft:${strategyKey}`;
}

export function browserProgramDraftStorage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}

export function loadProgramWorkingDraft(strategyKey: string, storage: Pick<Storage, "getItem"> | null): ProgramWorkingDraft {
  if (!storage) return emptyProgramWorkingDraft(strategyKey);
  try {
    const raw = storage.getItem(programDraftStorageKey(strategyKey));
    if (!raw) return emptyProgramWorkingDraft(strategyKey);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed as Partial<ProgramWorkingDraft>;
    const legacy = parsed.schema === "ruletrade.dev/program-working-draft/v1" || parsed.schema === "ruletrade.dev/program-working-draft/v2";
    if ((!legacy && parsed.schema !== PROGRAM_WORKING_DRAFT_SCHEMA) || value.strategyKey !== strategyKey) return emptyProgramWorkingDraft(strategyKey);
    return {
      ...emptyProgramWorkingDraft(strategyKey),
      ...value,
      blockPositions: value.blockPositions ?? {},
      canvasBlocks: value.canvasBlocks ?? {},
      reusableObjects: value.reusableObjects ?? {},
      activeGraphRootIds: value.activeGraphRootIds ?? [],
      blocklyWorkspace: value.blocklyWorkspace ?? null,
      blocklyViewport: value.blocklyViewport ?? null,
      flowPositions: value.flowPositions ?? {},
      blockConnections: value.blockConnections ?? {},
      blockDisclosure: value.blockDisclosure ?? {},
      diagnostics: value.diagnostics ?? [],
      schema: PROGRAM_WORKING_DRAFT_SCHEMA,
    };
  } catch {
    return emptyProgramWorkingDraft(strategyKey);
  }
}

export function persistProgramWorkingDraft(draft: ProgramWorkingDraft, storage: Pick<Storage, "setItem" | "removeItem"> | null): void {
  if (!storage) return;
  try {
    if (draft.status === "clean" && !draft.concept && Object.keys(draft.canvasBlocks).length === 0 && Object.keys(draft.reusableObjects).length === 0
      && draft.activeGraphRootIds.length === 0 && Object.keys(draft.blockPositions).length === 0
      && Object.keys(draft.flowPositions).length === 0 && Object.keys(draft.blockConnections).length === 0
      && Object.keys(draft.blockDisclosure).length === 0 && draft.diagnostics.length === 0 && !draft.flowViewport && !draft.blocklyWorkspace) {
      storage.removeItem(programDraftStorageKey(draft.strategyKey));
      return;
    }
    storage.setItem(programDraftStorageKey(draft.strategyKey), JSON.stringify({ ...draft, updatedAt: new Date().toISOString() }));
  } catch {
    // Storage may be disabled. The in-memory draft remains authoritative for this session.
  }
}

export function withNativeBlocklyState(draft: ProgramWorkingDraft, update: {
  workspace: Record<string, unknown>;
  viewport: { x: number; y: number; scale: number } | null;
  canvasBlocks: Record<string, ProgramCanvasBlock>;
  positions: Record<string, XYPosition>;
  connections: Record<string, ProgramDraftConnection>;
  disclosure: Record<string, 0 | 1 | 2>;
  selectedDraftId: string | null;
  nativeObjects?: ProgramReusableObject[];
}): ProgramWorkingDraft {
  const roots = draft.activeGraphRootIds.filter((id) => update.canvasBlocks[id]);
  const canvasBlocks = Object.fromEntries(Object.entries(update.canvasBlocks).map(([id, block]) => [id, { ...block, active: roots.includes(id) }]));
  const reusableObjects = update.nativeObjects ? {
    ...Object.fromEntries(Object.entries(draft.reusableObjects).filter(([id]) => !id.startsWith("blockly:"))),
    ...Object.fromEntries(update.nativeObjects.map((object) => [object.id, object])),
  } : draft.reusableObjects;
  return {
    ...draft,
    status: Object.keys(canvasBlocks).length || draft.concept ? "incomplete" : "clean",
    blocklyWorkspace: update.workspace,
    blocklyViewport: update.viewport,
    canvasBlocks,
    reusableObjects,
    blockPositions: update.positions,
    blockConnections: update.connections,
    blockDisclosure: update.disclosure,
    activeGraphRootIds: roots,
    selectedDraftId: update.selectedDraftId,
  };
}

export function addCanvasBlock(draft: ProgramWorkingDraft, block: ProgramCanvasBlock, position: XYPosition): ProgramWorkingDraft {
  return {
    ...draft,
    status: "incomplete",
    selectedDraftId: block.id,
    canvasBlocks: { ...draft.canvasBlocks, [block.id]: block },
    blockPositions: { ...draft.blockPositions, [block.id]: position },
  };
}

export function removeCanvasBlock(draft: ProgramWorkingDraft, id: string): ProgramWorkingDraft {
  const canvasBlocks = { ...draft.canvasBlocks }; delete canvasBlocks[id];
  const blockPositions = { ...draft.blockPositions }; delete blockPositions[id];
  const blockConnections = Object.fromEntries(Object.entries(draft.blockConnections)
    .filter(([childId, connection]) => childId !== id && connection.parentId !== id));
  const activeGraphRootIds = draft.activeGraphRootIds.filter((rootId) => rootId !== id);
  return { ...draft, canvasBlocks, blockPositions, blockConnections, activeGraphRootIds, selectedDraftId: draft.selectedDraftId === id ? null : draft.selectedDraftId,
    status: Object.keys(canvasBlocks).length || draft.concept ? "incomplete" : "clean" };
}

export function duplicateCanvasBlock(draft: ProgramWorkingDraft, sourceId: string, id: string): ProgramWorkingDraft {
  const source = draft.canvasBlocks[sourceId];
  if (!source) return draft;
  const position = draft.blockPositions[sourceId] ?? { x: 80, y: 80 };
  return addCanvasBlock(draft, { ...source, id, createdAt: new Date().toISOString(), active: false }, { x: position.x + 32, y: position.y + 32 });
}

export function setCanvasBlockActive(draft: ProgramWorkingDraft, id: string, active: boolean): ProgramWorkingDraft {
  const block = draft.canvasBlocks[id];
  if (!block) return draft;
  const roots = new Set(draft.activeGraphRootIds);
  if (active) roots.add(id); else roots.delete(id);
  return { ...draft, canvasBlocks: { ...draft.canvasBlocks, [id]: { ...block, active } }, activeGraphRootIds: [...roots] };
}

export function upsertReusableObject(draft: ProgramWorkingDraft, object: ProgramReusableObject): ProgramWorkingDraft {
  return { ...draft, reusableObjects: { ...draft.reusableObjects, [object.id]: object } };
}

export function renameReusableObject(draft: ProgramWorkingDraft, id: string, name: string): ProgramWorkingDraft {
  const object = draft.reusableObjects[id];
  const normalized = name.trim();
  return !object || !normalized ? draft : upsertReusableObject(draft, { ...object, name: normalized, version: object.version + 1 });
}

export function duplicateReusableObject(draft: ProgramWorkingDraft, id: string, duplicateId: string, name: string): ProgramWorkingDraft {
  const source = draft.reusableObjects[id];
  return source ? upsertReusableObject(draft, { ...source, id: duplicateId, name, version: 1, dependencies: [...source.dependencies] }) : draft;
}

export function removeReusableObject(draft: ProgramWorkingDraft, id: string): { draft: ProgramWorkingDraft; removed: boolean; dependants: string[] } {
  const dependants = Object.values(draft.reusableObjects).filter((item) => item.dependencies.includes(id)).map((item) => item.id);
  for (const block of Object.values(draft.canvasBlocks)) if (block.objectRef === id) dependants.push(block.id);
  if (dependants.length) return { draft, removed: false, dependants: [...new Set(dependants)] };
  const reusableObjects = { ...draft.reusableObjects }; delete reusableObjects[id];
  return { draft: { ...draft, reusableObjects }, removed: true, dependants: [] };
}

export function withProgramDraftConcept(draft: ProgramWorkingDraft, concept: ProgramDraftConcept): ProgramWorkingDraft {
  return {
    ...draft,
    concept,
    status: concept ? "incomplete" : "clean",
    selectedDraftId: concept?.semanticId ?? null,
  };
}

export function withBlockPosition(draft: ProgramWorkingDraft, id: string, position: XYPosition): ProgramWorkingDraft {
  return { ...draft, blockPositions: { ...draft.blockPositions, [id]: position } };
}

/** Persist one Blockly gesture atomically so connection reconciliation cannot overwrite geometry. */
export function withBlockMove(draft: ProgramWorkingDraft, id: string, position: XYPosition, connection?: ProgramDraftConnection): ProgramWorkingDraft {
  return {
    ...draft,
    blockPositions: { ...draft.blockPositions, [id]: position },
    blockConnections: connection ? { ...draft.blockConnections, [id]: connection } : draft.blockConnections,
  };
}

export function withFlowPositions(draft: ProgramWorkingDraft, positions: Record<string, XYPosition>): ProgramWorkingDraft {
  return { ...draft, flowPositions: { ...draft.flowPositions, ...positions } };
}

export function withBlockDisclosure(draft: ProgramWorkingDraft, id: string, level: 0 | 1 | 2): ProgramWorkingDraft {
  return { ...draft, blockDisclosure: { ...draft.blockDisclosure, [id]: level } };
}

export type ProgramConnectionKind = "statement" | "truth" | "number" | "percentage" | "money" | "quantity" | "duration" | "asset" | "group" | "subgroup" | "value" | "signal" | "function" | "state" | "fallback";

export function validProgramBlockConnection(parentType: string, inputName: string | null, childType: string): boolean {
  if (!inputName || inputName === "NEXT") return childType === "statement" && parentType === "statement";
  if (["CONDITION", "ELIGIBILITY"].includes(inputName)) return childType === "condition";
  if (["RANKING", "VALUE"].includes(inputName) || inputName.startsWith("ARG_")) return childType === "value" || childType === "condition";
  if (inputName === "FALLBACK") return childType === "fallback";
  if (["THEN", "ELSE", "DO"].includes(inputName) || inputName.startsWith("LEG_")) return childType === "statement";
  return false;
}

export function hasFlowCycle(edges: Array<{ source: string; target: string }>, next: { source: string; target: string }): boolean {
  if (next.source === next.target) return true;
  const outgoing = new Map<string, string[]>();
  for (const edge of [...edges, next]) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  const seen = new Set<string>();
  const active = new Set<string>();
  const visit = (id: string): boolean => {
    if (active.has(id)) return true;
    if (seen.has(id)) return false;
    seen.add(id); active.add(id);
    for (const child of outgoing.get(id) ?? []) if (visit(child)) return true;
    active.delete(id);
    return false;
  };
  return [...outgoing.keys()].some(visit);
}
