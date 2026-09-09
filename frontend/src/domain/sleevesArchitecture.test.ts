import { describe, expect, it } from "vitest";

import { projectFlow } from "./flow";
import { projectGuided } from "./guided";
import { createEditorState, editorReducer } from "../store/editorStore";
import { sleevesBootstrap } from "../test/fixture";

describe("Portfolio sleeves share Canonical semantics", () => {
  it("projects source sleeve identity and allocation in Guided and Flow", () => {
    const state = createEditorState(sleevesBootstrap);
    const guided = projectGuided(state.canonical, state.registry);
    const flow = projectFlow(state.canonical, state.registry, state.editor.nodePositions);
    expect(guided.kind).toBe("portfolio");
    if (guided.kind !== "portfolio") throw new Error("expected portfolio projection");
    expect(guided.growth).toMatchObject({ sleeveName: "Growth", allocation: "0.70" });
    expect(guided.defensive).toMatchObject({ sleeveName: "Defensive", allocation: "0.30", assets: ["TLT", "IEF"] });
    expect(flow.nodes.find((node) => node.id === "portfolio")?.data.allocationPair?.value).toBe("0.70/0.30");
  });

  it("applies 60/40 atomically and both views immediately see Canonical", () => {
    const initial = createEditorState(sleevesBootstrap);
    const edited = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: {
        kind: "update_sleeve_allocations",
        allocations: [
          { componentId: "growth_sleeve", value: "0.60" },
          { componentId: "defensive_sleeve", value: "0.40" },
        ],
      },
    });
    const guided = projectGuided(edited.canonical, edited.registry);
    const flow = projectFlow(edited.canonical, edited.registry, edited.editor.nodePositions);
    expect(guided.kind === "portfolio" && guided.growth.allocation).toBe("0.60");
    expect(guided.kind === "portfolio" && guided.defensive.allocation).toBe("0.40");
    expect(flow.nodes.find((node) => node.id === "portfolio")?.data.allocationPair?.value).toBe("0.60/0.40");
  });

  it("rejects a non-100% pair without changing Canonical", () => {
    const initial = createEditorState(sleevesBootstrap);
    const edited = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: {
        kind: "update_sleeve_allocations",
        allocations: [
          { componentId: "growth_sleeve", value: "0.60" },
          { componentId: "defensive_sleeve", value: "0.30" },
        ],
      },
    });
    expect(edited.canonical).toBe(initial.canonical);
    expect(edited.validation.issues[0].message).toContain("sum to 1");
  });

  it("rejects a partial allocation edit without changing Canonical", () => {
    const initial = createEditorState(sleevesBootstrap);
    const edited = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: {
        kind: "update_component_config",
        componentId: "growth_sleeve",
        field: "allocation",
        value: "0.60",
      },
    });
    expect(edited.canonical).toBe(initial.canonical);
    expect(edited.validation.issues[0].message).toContain("atomically");
  });

  it("keeps sleeve layout editor-only", () => {
    const initial = createEditorState(sleevesBootstrap);
    const moved = editorReducer(initial, { type: "move_node", componentId: "growth_sleeve", position: { x: 9, y: 12 } });
    expect(moved.canonical).toBe(initial.canonical);
  });
});
