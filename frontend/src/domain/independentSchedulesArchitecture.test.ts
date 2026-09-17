import { describe, expect, it } from "vitest";

import { projectConceptualFlow } from "./conceptualFlow";
import { projectGuided } from "./guided";
import { createEditorState, editorReducer } from "../store/editorStore";
import { independentSchedulesBootstrap } from "../test/fixture";

describe("Independent schedules share Canonical temporal semantics", () => {
  it("projects distinct refresh and rebalance schedules", () => {
    const state = createEditorState(independentSchedulesBootstrap);
    const guided = projectGuided(state.canonical, state.registry);
    expect(guided.kind).toBe("portfolio");
    if (guided.kind !== "portfolio") throw new Error("expected portfolio projection");
    expect(guided.growth.refreshSchedule).toBe("Monthly");
    expect(guided.defensive.refreshSchedule).toBe("Quarterly");
    expect(guided.rebalanceSchedule).toBe("Quarterly");
  });

  it("Guided schedule edit updates Canonical and Flow immediately", () => {
    const initial = createEditorState(independentSchedulesBootstrap);
    const edited = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: { kind: "update_schedule", componentId: "growth_monthly", cadence: "quarterly" },
    });
    expect(edited.canonical.graph.components.find((item) => item.id === "growth_monthly")?.primitive)
      .toBe("quarterly@1");
    const flow = projectConceptualFlow(edited.canonical, edited.registry);
    expect(flow.groups.find((item) => item.label === "Growth")?.timing).toBe("Quarterly");
  });

  it("Flow schedule edit updates Guided projection", () => {
    const initial = createEditorState(independentSchedulesBootstrap);
    const edited = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: { kind: "update_schedule", componentId: "portfolio_quarterly", cadence: "monthly" },
    });
    const guided = projectGuided(edited.canonical, edited.registry);
    expect(guided.kind === "portfolio" && guided.defensive.refreshSchedule).toBe("Monthly");
    expect(guided.kind === "portfolio" && guided.rebalanceSchedule).toBe("Monthly");
  });

  it("rejects invalid schedule edits atomically", () => {
    const initial = createEditorState(independentSchedulesBootstrap);
    const edited = editorReducer(initial, {
      type: "apply_semantic_patch",
      operation: {
        kind: "update_schedule",
        componentId: "growth_sleeve",
        cadence: "monthly",
      },
    });
    expect(edited.canonical).toBe(initial.canonical);
    expect(edited.validation.issues[0].message).toContain("Monthly or Quarterly");
  });
});
