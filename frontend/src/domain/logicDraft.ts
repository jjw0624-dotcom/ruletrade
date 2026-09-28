export interface LogicDraftIf {
  draftId: string;
  kind: "if_otherwise";
  predicateSummary: string;
}

export interface LogicDraftState {
  nextId: number;
  controls: LogicDraftIf[];
}

export const EMPTY_LOGIC_DRAFT: LogicDraftState = { nextId: 1, controls: [] };

export function hasUnresolvedLogicDraft(draft: LogicDraftState): boolean {
  return draft.controls.length > 0;
}

export function logicDraftMessage(draft: LogicDraftState): string | null {
  return hasUnresolvedLogicDraft(draft)
    ? "Complete or discard the unfinished Blocky edit before saving or testing."
    : null;
}
