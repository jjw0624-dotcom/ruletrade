import { describe, expect, it } from "vitest";

import { projectConceptualFlow } from "./conceptualFlow";
import { projectGuided } from "./guided";
import { createEditorState, editorReducer } from "../store/editorStore";
import { sleevesBootstrap } from "../test/fixture";

describe("Portfolio sleeves share Canonical semantics", () => {
  it("projects source sleeve identity and allocation in Guided and Flow", () => {
    const state = createEditorState(sleevesBootstrap);
    const guided = projectGuided(state.canonical, state.registry);
    const flow = projectConceptualFlow(state.canonical, state.registry);
    expect(guided.kind).toBe("portfolio");
    if (guided.kind !== "portfolio") throw new Error("expected portfolio projection");
    expect(guided.growth).toMatchObject({ sleeveName: "Growth", allocation: "0.70" });
    expect(guided.defensive).toMatchObject({ sleeveName: "Defensive", allocation: "0.30", assets: ["TLT", "IEF"] });
    expect(flow.groups.map((group) => group.allocationValue)).toEqual(["0.70", "0.30"]);
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
    const flow = projectConceptualFlow(edited.canonical, edited.registry);
    expect(guided.kind === "portfolio" && guided.growth.allocation).toBe("0.60");
    expect(guided.kind === "portfolio" && guided.defensive.allocation).toBe("0.40");
    expect(flow.groups.map((group) => group.allocationValue)).toEqual(["0.60", "0.40"]);
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

});
