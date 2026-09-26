import type { ResearchContext } from "./researchContext";

export type ResearchDestination =
  | { kind: "temporary_result" }
  | { kind: "run"; runId: string }
  | { kind: "comparison"; comparisonId: string };

export interface WorkbenchResearchState {
  activityOpen: boolean;
  researchOpen: boolean;
  size: number;
  destination: ResearchDestination | null;
  context: ResearchContext | null;
}

// Research is a stacked workspace. These values are vertical percentages and
// intentionally reserve at least 38% for the active Builder representation.
export const RESEARCH_DEFAULT_SIZE = 48;
export const RESEARCH_COMPARISON_SIZE = 58;
export const RESEARCH_MIN_SIZE = 32;
export const RESEARCH_MAX_SIZE = 62;
export const RESEARCH_BUILDER_MIN_SIZE = 38;

export type WorkbenchResearchAction =
  | { type: "toggle_activity" }
  | { type: "close_activity" }
  | { type: "open_temporary_result" }
  | { type: "open_run"; runId: string; context?: ResearchContext | null }
  | { type: "open_comparison"; comparisonId: string; context?: ResearchContext | null }
  | { type: "set_context"; context: ResearchContext | null }
  | { type: "set_size"; size: number }
  | { type: "reopen_research" }
  | { type: "close_research" }
  | { type: "reset" };

export const INITIAL_WORKBENCH_RESEARCH: WorkbenchResearchState = {
  activityOpen: false,
  researchOpen: false,
  size: RESEARCH_DEFAULT_SIZE,
  destination: null,
  context: null,
};

export function workbenchResearchReducer(
  state: WorkbenchResearchState,
  action: WorkbenchResearchAction,
): WorkbenchResearchState {
  switch (action.type) {
    case "toggle_activity":
      return { ...state, activityOpen: !state.activityOpen };
    case "close_activity":
      return { ...state, activityOpen: false };
    case "open_temporary_result":
      return { ...state, activityOpen: false, researchOpen: true, destination: { kind: "temporary_result" }, context: null };
    case "open_run":
      return {
        ...state,
        activityOpen: false,
        researchOpen: true,
        destination: { kind: "run", runId: action.runId },
        context: action.context ?? null,
      };
    case "open_comparison":
      return {
        ...state,
        activityOpen: false,
        researchOpen: true,
        size: Math.max(state.size, RESEARCH_COMPARISON_SIZE),
        destination: { kind: "comparison", comparisonId: action.comparisonId },
        context: action.context ?? null,
      };
    case "set_context":
      return { ...state, context: action.context };
    case "set_size":
      if (!Number.isFinite(action.size)) return state;
      {
        const size = Math.max(RESEARCH_MIN_SIZE, Math.min(RESEARCH_MAX_SIZE, action.size));
        return Math.abs(size - state.size) < 0.01 ? state : { ...state, size };
      }
    case "reopen_research":
      return state.destination ? { ...state, researchOpen: true } : state;
    case "close_research":
      return { ...state, researchOpen: false };
    case "reset":
      return INITIAL_WORKBENCH_RESEARCH;
  }
}

export function researchTitle(destination: ResearchDestination | null): string {
  if (!destination) return "Research";
  if (destination.kind === "comparison") return "Comparison";
  if (destination.kind === "temporary_result") return "Temporary result";
  return "Saved result";
}
