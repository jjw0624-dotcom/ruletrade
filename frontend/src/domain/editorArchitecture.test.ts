import { describe, expect, it } from "vitest";

import { projectFlow } from "./flow";
import { projectGuided } from "./guided";
import { createEditorState, editorReducer } from "../store/editorStore";
import { goldenBootstrap } from "../test/fixture";

describe("Strategy Editor Canonical architecture", () => {
  it("loads and projects the Golden Canonical strategy", () => {
    const state = createEditorState(goldenBootstrap);
    const guided = projectGuided(state.canonical, state.registry);

    expect(state.canonical.api_version).toBe("ruletrade.dev/strategy/v1");
    expect(guided.growth.assets).toEqual(["QQQ", "VGT", "SOXX", "SCHG"]);
    expect(guided.growth.randomCount).toBe(2);
    expect(guided.growth.resample).toBe("per_event");
    expect(guided.growth.total).toBe("0.70");
    expect(guided.safe.assets).toEqual(["TLT", "IEF"]);
    expect(guided.safe.total).toBe("0.30");
  });

  it("projects Canonical components, connections, and entrypoint into Flow", () => {
    const state = createEditorState(goldenBootstrap);
    const flow = projectFlow(state.canonical, state.registry, state.editor.nodePositions);

    expect(flow.nodes).toHaveLength(8);
    expect(flow.edges).toHaveLength(7);
    expect(flow.edges).toContainEqual(expect.objectContaining({ source: "growth_random", target: "growth_weights" }));
    expect(flow.edges).toContainEqual(expect.objectContaining({ source: "monthly", target: "rebalance", animated: true }));
    expect(flow.nodes.find((node) => node.id === "growth_random")?.data.details).toEqual([
      "Count: 2",
      "Resample: per_event",
    ]);
  });

  it("shows a Guided semantic edit immediately in Flow", () => {
    const initial = createEditorState(goldenBootstrap);
    const edited = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: { kind: "update_component_config", componentId: "growth_random", field: "count", value: 3 },
    });
    const flow = projectFlow(edited.canonical, edited.registry, edited.editor.nodePositions);

    expect(projectGuided(edited.canonical, edited.registry).growth.randomCount).toBe(3);
    expect(flow.nodes.find((node) => node.id === "growth_random")?.data.randomCount).toBe(3);
    expect(initial.canonical.graph.components.find((item) => item.id === "growth_random")?.config.count).toBe(2);
  });

  it("shows a Flow semantic edit immediately in Guided", () => {
    const initial = createEditorState(goldenBootstrap);
    const edited = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: { kind: "update_component_config", componentId: "growth_random", field: "resample", value: "once" },
    });

    expect(projectGuided(edited.canonical, edited.registry).growth.resample).toBe("once");
    expect(projectFlow(edited.canonical, edited.registry, edited.editor.nodePositions)
      .nodes.find((node) => node.id === "growth_random")?.data.resample).toBe("once");
  });

  it("keeps Flow layout entirely outside Canonical semantics", () => {
    const initial = createEditorState(goldenBootstrap);
    const canonicalBefore = JSON.stringify(initial.canonical);
    const moved = editorReducer(initial, {
      type: "move_node",
      componentId: "growth_random",
      position: { x: 912, y: 318 },
    });

    expect(moved.editor.nodePositions.growth_random).toEqual({ x: 912, y: 318 });
    expect(JSON.stringify(moved.canonical)).toBe(canonicalBefore);
    expect(moved.canonical).toBe(initial.canonical);
  });

  it("preserves unsupported Canonical components and AST during Guided edits", () => {
    const bootstrap = structuredClone(goldenBootstrap);
    bootstrap.strategy.graph.components.push({
      id: "advanced_rule",
      primitive: "rule@1",
      config: {},
      condition: {
        kind: "comparison",
        operator: "gt",
        left: { kind: "state_ref", state_id: "counter" },
        right: { kind: "literal", value_type: "integer", value: 0 },
      },
      actions: [{ kind: "emit_signal", name: "advanced" }],
    });
    const initial = createEditorState(bootstrap);
    const unsupportedBefore = initial.canonical.graph.components.at(-1);
    const edited = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: { kind: "update_component_config", componentId: "growth_random", field: "count", value: 3 },
    });

    expect(edited.canonical.graph.components.at(-1)).toBe(unsupportedBefore);
    expect(edited.canonical.graph.components.at(-1)).toEqual(bootstrap.strategy.graph.components.at(-1));
  });

  it("rejects invalid semantic edits atomically", () => {
    const initial = createEditorState(goldenBootstrap);
    const edited = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: { kind: "update_component_config", componentId: "growth_random", field: "count", value: 0 },
    });

    expect(edited.canonical).toBe(initial.canonical);
    expect(edited.validation.status).toBe("invalid");
    expect(edited.validation.issues[0].path).toContain("growth_random");
  });
});
