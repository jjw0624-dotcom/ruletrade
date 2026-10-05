import { describe, expect, it } from "vitest";

import { createEditorState, editorReducer } from "../store/editorStore";
import { goldenBootstrap } from "../test/fixture";
import { classifyFlowDraft, flowDraftMessage, isCompatibleFlowConnection } from "./flowDraft";

describe("FlowDraft authoring boundary", () => {
  it("classifies clean, incomplete, supported-complete, and meaningful unsupported changes", () => {
    expect(classifyFlowDraft({})).toBe("clean");
    expect(classifyFlowDraft({ pendingSemanticUnit: true })).toBe("incomplete");
    expect(classifyFlowDraft({ compatibleConnection: true })).toBe("valid_but_unsupported");
    expect(classifyFlowDraft({ backendOperationSupported: true, configurationComplete: true })).toBe("commit_ready");
  });

  it("allows only typed capital relationships", () => {
    expect(isCompatibleFlowConnection("portfolio", "group")).toBe(true);
    expect(isCompatibleFlowConnection("universe", "selection")).toBe(true);
    expect(isCompatibleFlowConnection("selection", "allocation")).toBe(true);
    expect(isCompatibleFlowConnection("schedule", "group")).toBe(true);
    expect(isCompatibleFlowConnection("predicate", "branch")).toBe(true);
    expect(isCompatibleFlowConnection("selection", "schedule")).toBe(false);
    expect(isCompatibleFlowConnection("fallback", "action")).toBe(false);
    expect(isCompatibleFlowConnection("allocation", "allocation")).toBe(false);
  });

  it("persists incomplete working truth across perspectives and clears only on discard or commit", () => {
    const initial = createEditorState(goldenBootstrap, "flow");
    const draft = editorReducer(initial, { type: "begin_flow_draft", intent: {
      kind: "selection", targetComponentId: "universe", targetLabel: "Growth", groupId: "investment",
    } });
    expect(draft.editor.flowDraft.status).toBe("incomplete");
    expect(flowDraftMessage(draft.editor.flowDraft)).toContain("Finish or discard");
    const rules = editorReducer(draft, { type: "set_active_view", view: "rules" });
    expect(rules.editor.flowDraft).toEqual(draft.editor.flowDraft);
    expect(rules.canonical).toBe(initial.canonical);
    const cleared = editorReducer(rules, { type: "clear_flow_draft" });
    expect(cleared.editor.flowDraft.status).toBe("clean");
    expect(cleared.canonical).toBe(initial.canonical);
  });

  it("keeps a backend-rejected draft unresolved without changing Canonical", () => {
    const initial = createEditorState(goldenBootstrap, "flow");
    const draft = editorReducer(initial, { type: "begin_flow_draft", intent: {
      kind: "qualification", targetComponentId: "universe", targetLabel: "Growth", groupId: "investment",
    } });
    const applying = editorReducer(draft, { type: "set_flow_draft_status", status: "commit_ready" });
    const rejected = editorReducer(applying, { type: "set_flow_draft_status", status: "incomplete", message: "Backend rejected the change." });
    expect(rejected.canonical).toBe(initial.canonical);
    expect(rejected.editor.flowDraft.message).toBe("Backend rejected the change.");
  });
});
