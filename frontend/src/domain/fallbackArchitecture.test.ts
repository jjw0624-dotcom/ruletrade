import { describe, expect, it } from "vitest";

import { projectFlow } from "./flow";
import { projectGuided } from "./guided";
import { createEditorState, editorReducer } from "../store/editorStore";
import { fallbackBootstrap } from "../test/fixture";

describe("Fallback cross-view architecture", () => {
  it("projects explicit source intent into both views", () => {
    const state = createEditorState(fallbackBootstrap);
    const guided = projectGuided(state.canonical, state.registry);
    const flow = projectFlow(state.canonical, state.registry, state.editor.nodePositions);

    expect(guided.kind).toBe("momentum");
    if (guided.kind !== "momentum") throw new Error("expected score strategy projection");
    expect(guided.momentum.fallbackAsset).toBe("TLT");
    expect(guided.momentum.fallbackAssetSetRef).toBe("fallback_tlt");
    expect(flow.nodes.find((node) => node.id === "fallback")?.data.title).toBe("Fallback: TLT");
    expect(flow.edges).toHaveLength(8);
  });

  it("shows a Guided fallback edit immediately in Flow", () => {
    const initial = createEditorState(fallbackBootstrap);
    const edited = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: {
        kind: "update_component_config",
        componentId: "fallback",
        field: "fallback_asset_set_ref",
        value: "fallback_ief",
      },
    });
    const flow = projectFlow(edited.canonical, edited.registry, edited.editor.nodePositions);

    expect(flow.nodes.find((node) => node.id === "fallback")?.data.title).toBe("Fallback: IEF");
    expect(initial.canonical.graph.components.find((item) => item.id === "fallback")?.config)
      .toEqual({ fallback_asset_set_ref: "fallback_tlt" });
  });

  it("shows a Flow fallback edit immediately in Guided", () => {
    const initial = createEditorState(fallbackBootstrap);
    const edited = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: {
        kind: "update_component_config",
        componentId: "fallback",
        field: "fallback_asset_set_ref",
        value: "fallback_ief",
      },
    });
    const guided = projectGuided(edited.canonical, edited.registry);

    expect(guided.kind === "momentum" && guided.momentum.fallbackAsset).toBe("IEF");
  });

  it("keeps node movement editor-only", () => {
    const initial = createEditorState(fallbackBootstrap);
    const moved = editorReducer(initial, {
      type: "move_node",
      componentId: "fallback",
      position: { x: 444, y: 333 },
    });

    expect(moved.canonical).toBe(initial.canonical);
    expect(moved.editor.nodePositions.fallback).toEqual({ x: 444, y: 333 });
  });

  it("rejects a missing fallback reference without corrupting Canonical", () => {
    const initial = createEditorState(fallbackBootstrap);
    const edited = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: {
        kind: "update_component_config",
        componentId: "fallback",
        field: "fallback_asset_set_ref",
        value: "missing",
      },
    });

    expect(edited.canonical).toBe(initial.canonical);
    expect(edited.validation.status).toBe("invalid");
    expect(edited.validation.issues[0].message).toContain("existing asset set");
  });
});
