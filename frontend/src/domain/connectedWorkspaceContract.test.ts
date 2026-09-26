import { describe, expect, it, vi } from "vitest";
import { authoringApi } from "../structuralAuthoringApi";
import { sameCanonicalSnapshot, strategyApi } from "../strategyApi";
import { createEditorState, editorReducer } from "../store/editorStore";
import { filterBootstrap, momentumBootstrap } from "../test/fixture";
import { projectConceptualFlow } from "./conceptualFlow";
import { projectLogicRepresentation } from "./logicRepresentation";
import { sameSemanticAddress, semanticSelection } from "./semanticSelection";
import { INITIAL_WORKBENCH_RESEARCH, RESEARCH_MAX_SIZE, workbenchResearchReducer } from "./workbenchResearch";

const target = semanticSelection("qualification", "positive_return", { fieldPath: "config.threshold", groupId: "growth" });

describe("connected workspace authority and navigation contract", () => {
  it("addresses one Canonical field across roles without treating UI context as identity", () => {
    expect(sameSemanticAddress(target, semanticSelection("rule", "positive_return", { fieldPath: "config.threshold" }))).toBe(true);
    expect(sameSemanticAddress(target, semanticSelection("rule", "positive_return", { fieldPath: "config.operator" }))).toBe(false);
    expect(sameSemanticAddress(target, semanticSelection("rule", "another", { fieldPath: "config.threshold" }))).toBe(false);
    expect(sameSemanticAddress(target, semanticSelection("portfolio", null))).toBe(false);
  });

  it("keeps a surviving address and clears removed objects on dirty apply and authoritative Keep/reopen", () => {
    const initial = editorReducer(createEditorState(filterBootstrap, "flow"), { type: "select_semantic", selection: target });
    const updated = structuredClone(initial.canonical);
    updated.graph.components.find((item) => item.id === "positive_return")!.config.threshold = "0.05";
    const edited = editorReducer(initial, { type: "replace_canonical_dirty", canonical: updated });
    expect(edited.editor.selection).toBe(target);
    expect(edited.validation.status).toBe("dirty");
    const reopened = editorReducer(edited, { type: "replace_canonical", canonical: updated });
    expect(reopened.editor.selection).toBe(target);
    expect(reopened.validation.status).toBe("valid");
    const adopted = momentumBootstrap.strategy;
    const kept = editorReducer(edited, { type: "replace_canonical", canonical: adopted });
    expect(kept.editor.selection).toBeNull();
    expect(kept.validation.status).toBe("valid");
    expect(editorReducer(edited, { type: "replace_canonical_dirty", canonical: adopted, selection: target }).editor.selection).toBeNull();
  });

  it("applies only backend-returned Canonical, reprojects two perspectives, then saves and reopens", async () => {
    const before = createEditorState(filterBootstrap, "rules");
    const returned = structuredClone(before.canonical);
    returned.graph.components.find((item) => item.id === "positive_return")!.config.threshold = "0.05";
    const authoringFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ strategy: returned }), { status: 200 }));
    const canonical = await authoringApi.apply(before.canonical, { kind: "update_qualification_threshold", component_id: "positive_return", threshold: "0.05" }, authoringFetch);
    const edited = editorReducer(before, { type: "replace_canonical_dirty", canonical });
    expect(projectConceptualFlow(edited.canonical, edited.registry).groups[0].choose?.threshold).toBe("0.05");
    expect(projectLogicRepresentation(edited.canonical, edited.registry).groups[0].steps.find((step) => step.kind === "condition")?.value).toBe(5);
    const saved = { created: true, strategy: { id: "strategy", name: "Filter", current_revision_id: "revision-2", created_at: "", updated_at: "", archived_at: null }, revision: { id: "revision-2", strategy_id: "strategy", parent_revision_id: "revision-1", canonical_strategy: canonical, source_hash: "hash", schema_version: "1", created_at: "" } };
    const requests: Array<{ url: string; method: string | undefined }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method });
      return new Response(JSON.stringify(String(input).endsWith("/revisions") ? saved : { strategy: saved.strategy, current_revision: saved.revision }), { status: 200 });
    }) as typeof fetch;
    const persisted = await strategyApi.save("strategy", "revision-1", edited.canonical, fetcher);
    const reopened = await strategyApi.get("strategy", fetcher);
    expect(persisted.revision.id).toBe("revision-2");
    expect(sameCanonicalSnapshot(reopened.current_revision.canonical_strategy, edited.canonical)).toBe(true);
    expect(requests).toEqual([{ url: "/api/v1/strategies/strategy/revisions", method: "POST" }, { url: "/api/v1/strategies/strategy", method: undefined }]);
    expect(authoringFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps Research context and Canonical untouched while switching views and resizing", () => {
    const initial = editorReducer(createEditorState(filterBootstrap, "flow"), { type: "select_semantic", selection: target });
    const context = { runId: "run-1", sessionId: "2025-06-01", asset: "QQQ" };
    const opened = workbenchResearchReducer(INITIAL_WORKBENCH_RESEARCH, { type: "open_run", runId: context.runId, context });
    const resized = workbenchResearchReducer(opened, { type: "set_size", size: 75 });
    const switched = editorReducer(editorReducer(initial, { type: "set_active_view", view: "blocky" }), { type: "set_active_view", view: "rules" });
    expect(switched.canonical).toBe(initial.canonical);
    expect(switched.validation).toBe(initial.validation);
    expect(switched.editor.selection).toBe(target);
    expect(resized).toMatchObject({ destination: { kind: "run", runId: context.runId }, context, size: RESEARCH_MAX_SIZE });
  });

  it("leaves all projected semantics and dirty state intact after backend rejection", async () => {
    const initial = createEditorState(filterBootstrap, "blocky");
    const response = new Response(JSON.stringify({ detail: { code: "result_invalid", message: "Invalid" } }), { status: 422 });
    await expect(authoringApi.apply(initial.canonical, { kind: "update_qualification_threshold", component_id: "positive_return", threshold: "0.05" }, vi.fn().mockResolvedValue(response))).rejects.toThrow();
    expect(initial.validation.status).toBe("valid");
    expect(projectConceptualFlow(initial.canonical, initial.registry).groups[0].choose?.threshold).toBe("0");
    expect(projectLogicRepresentation(initial.canonical, initial.registry).groups[0].steps.find((step) => step.kind === "condition")?.value).toBe(0);
  });
});
