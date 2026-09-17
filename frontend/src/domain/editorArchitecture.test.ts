import { describe, expect, it } from "vitest";

import { projectConceptualFlow } from "./conceptualFlow";
import { projectGuided } from "./guided";
import { projectFlowCanvas } from "../views/FlowView";
import { createEditorState, editorReducer } from "../store/editorStore";
import { goldenBootstrap } from "../test/fixture";

describe("Strategy Editor Canonical architecture", () => {
  it("loads and projects the Golden Canonical strategy", () => {
    const state = createEditorState(goldenBootstrap);
    const guided = projectGuided(state.canonical, state.registry);
    expect(guided.kind).toBe("golden");
    if (guided.kind !== "golden") throw new Error("expected Golden projection");

    expect(state.canonical.api_version).toBe("ruletrade.dev/strategy/v1");
    expect(guided.growth.assets).toEqual(["QQQ", "VGT", "SOXX", "SCHG"]);
    expect(guided.growth.randomCount).toBe(2);
    expect(guided.growth.resample).toBe("per_event");
    expect(guided.growth.total).toBe("0.70");
    expect(guided.safe.assets).toEqual(["TLT", "IEF"]);
    expect(guided.safe.total).toBe("0.30");
  });

  it("projects Canonical meaning and schedule into Flow", () => {
    const state = createEditorState(goldenBootstrap);
    const projection = projectConceptualFlow(state.canonical, state.registry);
    const flow = projectFlowCanvas(projection);
    expect(projection.groups[0].choose).toMatchObject({ topN: 2, resample: "per_event" });
    expect(flow.nodes.some((node) => node.data.title === "Choose 2")).toBe(true);
    expect(flow.nodes.some((node) => node.data.title === "Rebalance")).toBe(true);
  });

  it("shows a Guided semantic edit immediately in Flow", () => {
    const initial = createEditorState(goldenBootstrap);
    const patched = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: { kind: "update_component_config", componentId: "growth_random", field: "count", value: 3 },
    });
    const edited = editorReducer(patched, { type: "set_active_view", view: "flow" });
    const flow = projectConceptualFlow(edited.canonical, edited.registry);

    expect(edited.editor.activeView).toBe("flow");
    const guided = projectGuided(edited.canonical, edited.registry);
    expect(guided.kind === "golden" && guided.growth.randomCount).toBe(3);
    expect(flow.groups[0].choose?.topN).toBe(3);
    expect(initial.canonical.graph.components.find((item) => item.id === "growth_random")?.config.count).toBe(2);
  });

  it("shows a Flow semantic edit immediately in Guided", () => {
    const initial = createEditorState(goldenBootstrap);
    const patched = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: { kind: "update_component_config", componentId: "growth_random", field: "resample", value: "once" },
    });
    const edited = editorReducer(patched, { type: "set_active_view", view: "guided" });

    expect(edited.editor.activeView).toBe("guided");
    const guided = projectGuided(edited.canonical, edited.registry);
    expect(guided.kind === "golden" && guided.growth.resample).toBe("once");
    expect(projectConceptualFlow(edited.canonical, edited.registry).groups[0].choose?.resample).toBe("once");
  });

  it("keeps Flow layout entirely outside Canonical semantics", () => {
    const initial = createEditorState(goldenBootstrap);
    const canonicalBefore = JSON.stringify(initial.canonical);
    const flow = projectFlowCanvas(projectConceptualFlow(initial.canonical, initial.registry));
    flow.nodes[0].position = { x: 912, y: 318 };
    expect(JSON.stringify(initial.canonical)).toBe(canonicalBefore);
  });

  it("preserves unsupported Canonical components and AST during Guided edits", () => {
    const bootstrap = structuredClone(goldenBootstrap);
    bootstrap.strategy.definitions.state.push({
      id: "counter",
      value_type: "integer",
      initial: 0,
    });
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
