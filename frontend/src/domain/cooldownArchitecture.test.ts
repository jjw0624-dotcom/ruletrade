import { describe, expect, it } from "vitest";

import { projectConceptualFlow } from "./conceptualFlow";
import { projectGuided } from "./guided";
import { createEditorState, editorReducer } from "../store/editorStore";
import { cooldownBootstrap } from "../test/fixture";

describe("Cooldown views share the Canonical Strategy Model", () => {
  it("projects the high-level cooldown without exposing state fields", () => {
    const state = createEditorState(cooldownBootstrap);
    const guided = projectGuided(state.canonical, state.registry);
    expect(guided.kind).toBe("momentum");
    if (guided.kind !== "momentum") throw new Error("expected momentum projection");
    expect(guided.momentum.cooldownDuration).toBe(20);
    expect(guided.momentum.cooldownUnit).toBe("trading_days");
    expect(guided.momentum.schedule).toBe("Daily");
    expect(JSON.stringify(guided)).not.toContain("last_exit");
  });

  it("Guided 20 to 30 is immediately visible in Flow", () => {
    const initial = createEditorState(cooldownBootstrap);
    const edited = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: {
        kind: "update_component_config",
        componentId: "cooldown",
        field: "duration",
        value: 30,
      },
    });
    const flow = projectConceptualFlow(edited.canonical, edited.registry);
    expect(flow.groups[0].choose?.cooldownDuration).toBe(30);
  });

  it("Flow 30 to 10 is immediately visible in Guided", () => {
    const initial = createEditorState(cooldownBootstrap);
    const atThirty = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: { kind: "update_component_config", componentId: "cooldown", field: "duration", value: 30 },
    });
    const atTen = editorReducer(atThirty, {
      type: "apply_semantic_patch",
      operation: { kind: "update_component_config", componentId: "cooldown", field: "duration", value: 10 },
    });
    const guided = projectGuided(atTen.canonical, atTen.registry);
    expect(guided.kind === "momentum" && guided.momentum.cooldownDuration).toBe(10);
  });

  it("rejects an invalid duration without mutating Canonical", () => {
    const initial = createEditorState(cooldownBootstrap);
    const edited = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: { kind: "update_component_config", componentId: "cooldown", field: "duration", value: 0 },
    });
    expect(edited.canonical).toBe(initial.canonical);
    expect(edited.validation.issues[0].message).toContain("at least 1");
  });
});
