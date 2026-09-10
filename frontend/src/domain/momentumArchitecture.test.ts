import { describe, expect, it } from "vitest";

import { projectFlow } from "./flow";
import { projectGuided } from "./guided";
import { createEditorState, editorReducer } from "../store/editorStore";
import { momentumBootstrap } from "../test/fixture";

describe("Momentum TopN cross-view architecture", () => {
  it("projects the same Canonical strategy into Guided and Flow", () => {
    const state = createEditorState(momentumBootstrap);
    const guided = projectGuided(state.canonical, state.registry);
    const flow = projectFlow(state.canonical, state.registry, state.editor.nodePositions);

    expect(guided.kind).toBe("momentum");
    if (guided.kind !== "momentum") throw new Error("expected Momentum projection");
    expect(guided.momentum.assets).toEqual(["QQQ", "VGT", "SOXX", "SCHG"]);
    expect(guided.momentum.lookbackBars).toBe(126);
    expect(guided.momentum.topN).toBe(2);
    expect(flow.nodes.map((node) => node.data.title)).toEqual(expect.arrayContaining([
      "126-day return", "Rank weakest", "Top 2", "Equal Weight 100%", "Rebalance",
    ]));
    expect(flow.edges).toHaveLength(6);
  });

  it("shows Guided Top N edits immediately in Flow", () => {
    const initial = createEditorState(momentumBootstrap);
    const edited = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: { kind: "update_component_config", componentId: "top_n", field: "count", value: 3 },
    });
    const flow = projectFlow(edited.canonical, edited.registry, edited.editor.nodePositions);

    expect(flow.nodes.find((node) => node.id === "top_n")?.data.topN).toBe(3);
    expect(initial.canonical.graph.components.find((item) => item.id === "top_n")?.config.count).toBe(2);
  });

  it("shows Flow lookback edits immediately in Guided and preserves editor separation", () => {
    const initial = createEditorState(momentumBootstrap);
    const edited = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: { kind: "update_component_config", componentId: "momentum", field: "lookback_bars", value: 63 },
    });
    const guided = projectGuided(edited.canonical, edited.registry);
    const moved = editorReducer(edited, {
      type: "move_node", componentId: "momentum", position: { x: 333, y: 222 },
    });

    expect(guided.kind === "momentum" && guided.momentum.lookbackBars).toBe(63);
    expect(moved.canonical).toBe(edited.canonical);
    expect(moved.editor.nodePositions.momentum).toEqual({ x: 333, y: 222 });
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
