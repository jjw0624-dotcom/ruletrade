export type LogicDraftStatus = "clean" | "incomplete" | "valid_but_unsupported" | "commit_ready";
export type DraftControlKind = "if" | "if_otherwise";

export interface LogicWorkingBlock {
  workingId: string;
  blockType: string;
  source: "canonical" | "draft";
  componentId: string | null;
  parentWorkingId: string | null;
  inputName: string | null;
  nextWorkingId: string | null;
  summary: string | null;
}

export interface LogicWorkingProgram {
  blocks: LogicWorkingBlock[];
}

export interface PendingLogicControl {
  draftId: string;
  kind: DraftControlKind;
}

export interface LogicDraftState {
  nextId: number;
  status: LogicDraftStatus;
  workingProgram: LogicWorkingProgram | null;
  pendingControls: PendingLogicControl[];
  selectedDraftId: string | null;
  removalRequestId: string | null;
  restoreVersion: number;
}

export const EMPTY_LOGIC_DRAFT: LogicDraftState = {
  nextId: 1,
  status: "clean",
  workingProgram: null,
  pendingControls: [],
  selectedDraftId: null,
  removalRequestId: null,
  restoreVersion: 0,
};

export function hasUnresolvedLogicDraft(draft: LogicDraftState): boolean {
  return draft.status !== "clean" || draft.pendingControls.length > 0;
}

export function logicDraftMessage(draft: LogicDraftState): string | null {
  return hasUnresolvedLogicDraft(draft)
    ? "Complete or discard the unfinished Blocky edit before saving or testing."
    : null;
}

export function logicWorkingProgramSignature(program: LogicWorkingProgram): string {
  return JSON.stringify([...program.blocks].sort((left, right) => left.workingId.localeCompare(right.workingId)));
}

export function classifyWorkingProgram(program: LogicWorkingProgram, baseline: LogicWorkingProgram): LogicDraftStatus {
  if (logicWorkingProgramSignature(program) === logicWorkingProgramSignature(baseline)) return "clean";
  const baselineCanonical = new Set(baseline.blocks.filter((item) => item.source === "canonical").map((item) => item.workingId));
  const currentCanonical = new Set(program.blocks.filter((item) => item.source === "canonical").map((item) => item.workingId));
  if ([...baselineCanonical].some((id) => !currentCanonical.has(id))) return "incomplete";
  const draftControls = program.blocks.filter((item) => item.source === "draft" && item.blockType.startsWith("rt_draft_if"));
  if (draftControls.some((item) => !item.summary?.trim() || !program.blocks.some((candidate) => candidate.parentWorkingId === item.workingId))) return "incomplete";
  // Current Canonical has no generic statement-order or Predicate-creation intent.
  return "valid_but_unsupported";
}
