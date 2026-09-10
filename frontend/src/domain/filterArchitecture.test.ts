import { describe, expect, it } from "vitest";

import { projectFlow } from "./flow";
import { projectGuided } from "./guided";
import { createEditorState, editorReducer } from "../store/editorStore";
import { filterBootstrap } from "../test/fixture";

describe("Filter screening cross-view architecture", () => {
  it("projects the compositional Canonical filter into Guided and Flow", () => {
    const state = createEditorState(filterBootstrap);
    const guided = projectGuided(state.canonical, state.registry);
    const flow = projectFlow(state.canonical, state.registry, state.editor.nodePositions);

    expect(guided.kind).toBe("momentum");
    if (guided.kind !== "momentum") throw new Error("expected score strategy projection");
    expect(guided.momentum.threshold).toBe("0");
    expect(guided.momentum.topN).toBe(2);
    expect(flow.nodes.map((node) => node.data.title)).toEqual(expect.arrayContaining([
      "126-day return", "Return > 0%", "Rank weakest", "Top 2", "Equal Weight 100%", "Rebalance",
    ]));
    expect(flow.edges).toHaveLength(7);
  });

  it("shows a Guided threshold edit immediately in Flow", () => {
    const initial = createEditorState(filterBootstrap);
    const edited = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: {
        kind: "update_component_config",
        componentId: "positive_return",
        field: "threshold",
        value: "0.05",
      },
    });
    const flow = projectFlow(edited.canonical, edited.registry, edited.editor.nodePositions);

    expect(flow.nodes.find((node) => node.id === "positive_return")?.data.threshold).toBe("0.05");
    expect(flow.nodes.find((node) => node.id === "positive_return")?.data.title).toBe("Return > 5%");
    expect(initial.canonical.graph.components.find((item) => item.id === "positive_return")?.config.threshold).toBe("0");
  });

  it("shows a Flow Top N edit immediately in Guided", () => {
    const initial = createEditorState(filterBootstrap);
    const edited = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: { kind: "update_component_config", componentId: "top_n", field: "count", value: 3 },
    });
    const guided = projectGuided(edited.canonical, edited.registry);

    expect(guided.kind === "momentum" && guided.momentum.topN).toBe(3);
  });

  it("rejects a non-numeric threshold without corrupting Canonical", () => {
    const initial = createEditorState(filterBootstrap);
    const edited = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: {
        kind: "update_component_config",
        componentId: "positive_return",
        field: "threshold",
        value: "not-a-number",
      },
    });

    expect(edited.canonical).toBe(initial.canonical);
    expect(edited.validation.status).toBe("invalid");
    expect(edited.validation.issues[0].message).toBe("threshold must be numeric");

    const empty = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: {
        kind: "update_component_config",
        componentId: "positive_return",
        field: "threshold",
        value: "",
      },
    });
    expect(empty.canonical).toBe(initial.canonical);
    expect(empty.validation.status).toBe("invalid");
  });

  it("keeps Flow layout outside Canonical semantics", () => {
    const initial = createEditorState(filterBootstrap);
    const moved = editorReducer(initial, {
      type: "move_node",
      componentId: "positive_return",
      position: { x: 444, y: 222 },
    });

    expect(moved.canonical).toBe(initial.canonical);
    expect(moved.editor.nodePositions.positive_return).toEqual({ x: 444, y: 222 });
  });
});
