import type { ResearchContext } from "./researchContext";

export type ResearchDestination =
  | { kind: "history" }
  | { kind: "temporary_result" }
  | { kind: "run"; runId: string }
  | { kind: "comparison"; comparisonId: string };

export interface WorkbenchResearchState {
  open: boolean;
  size: number;
  destination: ResearchDestination;
  context: ResearchContext | null;
}

export type WorkbenchResearchAction =
  | { type: "open_history" }
  | { type: "open_temporary_result" }
  | { type: "open_run"; runId: string; context?: ResearchContext | null }
  | { type: "open_comparison"; comparisonId: string; context?: ResearchContext | null }
  | { type: "set_context"; context: ResearchContext | null }
  | { type: "set_size"; size: number }
  | { type: "reopen" }
  | { type: "close" }
  | { type: "reset" };

export const INITIAL_WORKBENCH_RESEARCH: WorkbenchResearchState = {
  open: false,
  size: 42,
  destination: { kind: "history" },
  context: null,
};

export function workbenchResearchReducer(
  state: WorkbenchResearchState,
  action: WorkbenchResearchAction,
): WorkbenchResearchState {
  switch (action.type) {
    case "open_history":
      return { ...state, open: true, destination: { kind: "history" }, context: null };
    case "open_temporary_result":
      return { ...state, open: true, destination: { kind: "temporary_result" }, context: null };
    case "open_run":
      return {
        ...state,
        open: true,
        destination: { kind: "run", runId: action.runId },
        context: action.context ?? null,
      };
    case "open_comparison":
      return {
        ...state,
        open: true,
        destination: { kind: "comparison", comparisonId: action.comparisonId },
        context: action.context ?? null,
      };
    case "set_context":
      return { ...state, context: action.context };
    case "set_size":
      return { ...state, size: Math.max(28, Math.min(70, action.size)) };
    case "reopen":
      return { ...state, open: true };
    case "close":
      return { ...state, open: false };
    case "reset":
      return INITIAL_WORKBENCH_RESEARCH;
  }
}

export function researchTitle(destination: ResearchDestination): string {
  if (destination.kind === "history") return "Strategy activity";
  if (destination.kind === "comparison") return "Comparison";
  if (destination.kind === "temporary_result") return "Temporary result";
  return "Saved result";
}
