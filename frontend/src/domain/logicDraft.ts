import type { ConditionExpression } from "./canonical";

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
  condition?: ConditionExpression | null;
}

export interface LogicWorkingProgram {
  blocks: LogicWorkingBlock[];
}

export interface PendingLogicControl {
  draftId: string;
  kind: DraftControlKind;
  position?: { x: number; y: number };
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

function branchChain(program: LogicWorkingProgram, controlId: string, inputName: "THEN" | "ELSE"): LogicWorkingBlock[] {
  const byId = new Map(program.blocks.map((item) => [item.workingId, item]));
  const first = program.blocks.find((item) => item.parentWorkingId === controlId && item.inputName === inputName);
  const result: LogicWorkingBlock[] = [];
  let current = first;
  const seen = new Set<string>();
  while (current && !seen.has(current.workingId)) {
    seen.add(current.workingId);
    result.push(current);
    current = current.nextWorkingId ? byId.get(current.nextWorkingId) : undefined;
  }
  return result;
}

function supportedExecutableBranch(blocks: LogicWorkingBlock[]): boolean {
  const types = blocks.map((item) => item.blockType);
  return (
    JSON.stringify(types) === JSON.stringify(["rt_selection", "rt_allocation", "rt_action"])
    || JSON.stringify(types) === JSON.stringify(["rt_allocation", "rt_action"])
  );
}

export interface ControlCommitIntent {
  component_id: string;
  then_target_component_id: string;
  otherwise_target_component_id?: string;
  condition: ConditionExpression;
}

export function controlCommitIntent(program: LogicWorkingProgram): ControlCommitIntent | null {
  const controls = program.blocks.filter((item) => item.source === "draft" && item.blockType.startsWith("rt_draft_if"));
  if (controls.length !== 1) return null;
  const control = controls[0];
  if (!control.condition) return null;
  const thenBranch = branchChain(program, control.workingId, "THEN");
  const elseBranch = branchChain(program, control.workingId, "ELSE");
  if (!supportedExecutableBranch(thenBranch)) return null;
  if (control.blockType === "rt_draft_if_else" && !supportedExecutableBranch(elseBranch)) return null;
  const action = program.blocks.find((item) => item.source === "canonical" && item.blockType === "rt_action" && item.componentId);
  const thenAllocation = thenBranch.find((item) => item.blockType === "rt_allocation" && item.componentId);
  const elseAllocation = elseBranch.find((item) => item.blockType === "rt_allocation" && item.componentId);
  if (!action?.componentId || !thenAllocation?.componentId) return null;
  return {
    component_id: action.componentId,
    then_target_component_id: thenAllocation.componentId,
    ...(elseAllocation?.componentId ? { otherwise_target_component_id: elseAllocation.componentId } : {}),
    condition: control.condition,
  };
}

export function classifyWorkingProgram(program: LogicWorkingProgram, baseline: LogicWorkingProgram): LogicDraftStatus {
  if (logicWorkingProgramSignature(program) === logicWorkingProgramSignature(baseline)) return "clean";
  const baselineCanonical = new Set(baseline.blocks.filter((item) => item.source === "canonical").map((item) => item.workingId));
  const currentCanonical = new Set(program.blocks.filter((item) => item.source === "canonical").map((item) => item.workingId));
  if ([...baselineCanonical].some((id) => !currentCanonical.has(id))) return "incomplete";
  const draftControls = program.blocks.filter((item) => item.source === "draft" && item.blockType.startsWith("rt_draft_if"));
  if (draftControls.some((item) => !item.condition || branchChain(program, item.workingId, "THEN").length === 0)) return "incomplete";
  if (draftControls.some((item) => item.blockType === "rt_draft_if_else" && branchChain(program, item.workingId, "ELSE").length === 0)) return "incomplete";
  return controlCommitIntent(program) ? "commit_ready" : "valid_but_unsupported";
}
