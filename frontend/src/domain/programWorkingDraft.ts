import type { Viewport, XYPosition } from "@xyflow/react";
import type { ConditionV2 } from "./canonicalV2";

export const PROGRAM_WORKING_DRAFT_SCHEMA = "ruletrade.dev/program-working-draft/v2" as const;

export type ProgramDraftStatus = "clean" | "incomplete" | "invalid" | "ready" | "unsupported";
export type ProgramDraftConcept =
  | { kind: "selection"; semanticId: string; universeId: string; withQualification?: boolean }
  | { kind: "event_state"; semanticId: string }
  | { kind: "control"; semanticId: string; condition: ConditionV2 | null }
  | null;

export interface ProgramDraftConnection {
  childId: string;
  parentId: string | null;
  inputName: string | null;
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
    const value = JSON.parse(raw) as Partial<ProgramWorkingDraft> & { schema?: string };
    const legacy = value.schema === "ruletrade.dev/program-working-draft/v1";
    if ((!legacy && value.schema !== PROGRAM_WORKING_DRAFT_SCHEMA) || value.strategyKey !== strategyKey) return emptyProgramWorkingDraft(strategyKey);
    return {
      ...emptyProgramWorkingDraft(strategyKey),
      ...value,
      blockPositions: value.blockPositions ?? {},
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
    if (draft.status === "clean" && !draft.concept && Object.keys(draft.blockPositions).length === 0
      && Object.keys(draft.flowPositions).length === 0 && Object.keys(draft.blockConnections).length === 0
      && Object.keys(draft.blockDisclosure).length === 0 && draft.diagnostics.length === 0 && !draft.flowViewport) {
      storage.removeItem(programDraftStorageKey(draft.strategyKey));
      return;
    }
    storage.setItem(programDraftStorageKey(draft.strategyKey), JSON.stringify({ ...draft, updatedAt: new Date().toISOString() }));
  } catch {
    // Storage may be disabled. The in-memory draft remains authoritative for this session.
  }
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

export function withFlowPositions(draft: ProgramWorkingDraft, positions: Record<string, XYPosition>): ProgramWorkingDraft {
  return { ...draft, flowPositions: { ...draft.flowPositions, ...positions } };
}

export function withBlockDisclosure(draft: ProgramWorkingDraft, id: string, level: 0 | 1 | 2): ProgramWorkingDraft {
  return { ...draft, blockDisclosure: { ...draft.blockDisclosure, [id]: level } };
}

export type ProgramConnectionKind = "statement" | "condition" | "value" | "fallback";

export function validProgramBlockConnection(parentType: string, inputName: string | null, childType: string): boolean {
  if (!inputName || inputName === "NEXT") return childType === "statement" && parentType === "statement";
  if (["CONDITION", "ELIGIBILITY"].includes(inputName)) return childType === "condition";
  if (["RANKING", "VALUE"].includes(inputName) || inputName.startsWith("ARG_")) return childType === "value" || childType === "condition";
  if (inputName === "FALLBACK") return childType === "fallback";
  if (["THEN", "ELSE", "DO"].includes(inputName)) return childType === "statement";
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
