export type FlowSemanticKind =
  | "portfolio" | "group" | "universe" | "eligibility" | "selection"
  | "allocation" | "target" | "exposure" | "action" | "predicate" | "branch" | "schedule"
  | "fallback" | "constraint";

export type FlowDraftStatus = "clean" | "incomplete" | "valid_but_unsupported" | "commit_ready";

export interface FlowDraftConnection {
  sourceId: string;
  targetId: string;
  sourceKind: FlowSemanticKind;
  targetKind: FlowSemanticKind;
  sourceHandle?: string | null;
}

export interface FlowDraftIntent {
  kind: string;
  targetComponentId: string;
  targetLabel: string;
  groupId: string | null;
}

export interface FlowDraftState {
  status: FlowDraftStatus;
  intent: FlowDraftIntent | null;
  connection: FlowDraftConnection | null;
  message: string | null;
}

export const EMPTY_FLOW_DRAFT: FlowDraftState = {
  status: "clean", intent: null, connection: null, message: null,
};

const COMPATIBLE_CONNECTIONS = new Set([
  // Flow connects capital and routing units. Candidate mechanics belong inside Selection's Inspector.
  "portfolio>group",
  "group>selection",
  "group>allocation",
  "selection>exposure",
  "selection>allocation",
  "selection>fallback",
  "selection>constraint",
  "exposure>allocation",
  "allocation>action",
  "fallback>action",
  "predicate>exposure",
  "predicate>group",
  "predicate>allocation",
  "predicate>branch",
  "branch>group",
  "branch>allocation",
  "schedule>portfolio",
  "schedule>group",
  "schedule>selection",
  "schedule>allocation",
  "schedule>predicate",
]);

export function isCompatibleFlowConnection(source: FlowSemanticKind, target: FlowSemanticKind): boolean {
  return source !== target && COMPATIBLE_CONNECTIONS.has(`${source}>${target}`);
}

export function classifyFlowDraft(input: {
  pendingSemanticUnit?: boolean;
  compatibleConnection?: boolean;
  backendOperationSupported?: boolean;
  configurationComplete?: boolean;
}): FlowDraftStatus {
  if (input.backendOperationSupported && input.configurationComplete) return "commit_ready";
  if (input.compatibleConnection) return "valid_but_unsupported";
  if (input.pendingSemanticUnit) return "incomplete";
  return "clean";
}

export function flowDraftMessage(draft: FlowDraftState): string | null {
  if (draft.status === "clean") return null;
  if (draft.status === "incomplete") return draft.message ?? "Finish or discard the Flow change before saving or testing.";
  if (draft.status === "valid_but_unsupported") return draft.message ?? "This Flow relationship is meaningful but is not safely committable yet.";
  return draft.message ?? "Applying the complete Flow change…";
}
