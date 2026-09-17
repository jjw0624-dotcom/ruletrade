import { describe, expect, it } from "vitest";

import { projectConceptualFlow } from "./conceptualFlow";
import { projectGuided } from "./guided";
import { createEditorState, editorReducer } from "../store/editorStore";
import { momentumBootstrap } from "../test/fixture";

describe("Momentum TopN cross-view architecture", () => {
  it("projects the same Canonical strategy into Guided and Flow", () => {
    const state = createEditorState(momentumBootstrap);
    const guided = projectGuided(state.canonical, state.registry);
    const flow = projectConceptualFlow(state.canonical, state.registry);

    expect(guided.kind).toBe("momentum");
    if (guided.kind !== "momentum") throw new Error("expected Momentum projection");
    expect(guided.momentum.assets).toEqual(["QQQ", "VGT", "SOXX", "SCHG"]);
    expect(guided.momentum.lookbackBars).toBe(126);
    expect(guided.momentum.topN).toBe(2);
    expect(flow.groups[0].choose).toMatchObject({ lookbackBars: 126, topN: 2, ranking: "Strongest first" });
  });

  it("shows Guided Top N edits immediately in Flow", () => {
    const initial = createEditorState(momentumBootstrap);
    const edited = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: { kind: "update_component_config", componentId: "top_n", field: "count", value: 3 },
    });
    const flow = projectConceptualFlow(edited.canonical, edited.registry);

    expect(flow.groups[0].choose?.topN).toBe(3);
    expect(initial.canonical.graph.components.find((item) => item.id === "top_n")?.config.count).toBe(2);
  });

  it("shows Flow lookback edits immediately in Guided", () => {
    const initial = createEditorState(momentumBootstrap);
    const edited = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: { kind: "update_component_config", componentId: "momentum", field: "lookback_bars", value: 63 },
    });
    const guided = projectGuided(edited.canonical, edited.registry);
    expect(guided.kind === "momentum" && guided.momentum.lookbackBars).toBe(63);
    expect(projectConceptualFlow(edited.canonical, edited.registry).groups[0].choose?.lookbackBars).toBe(63);
  });

  it("rejects invalid Top N edits without corrupting Canonical", () => {
    const initial = createEditorState(momentumBootstrap);
    const edited = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: { kind: "update_component_config", componentId: "top_n", field: "count", value: 0 },
    });

    expect(edited.canonical).toBe(initial.canonical);
    expect(edited.validation.status).toBe("invalid");
  });
});
