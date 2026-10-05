import { describe, expect, it } from "vitest";

import { projectConceptualFlow, type ConceptualFlowProjection } from "./conceptualFlow";
import { fallbackBootstrap, filterBootstrap, goldenBootstrap, independentSchedulesBootstrap, momentumBootstrap, sleevesBootstrap, cooldownBootstrap } from "../test/fixture";
import { mergeFlowNodePositions, projectFlowCanvas } from "../views/FlowView";

function canvas(bootstrap: typeof goldenBootstrap) {
  return projectFlowCanvas(projectConceptualFlow(bootstrap.strategy, bootstrap.registry));
}

describe("Flow Capital Composer semantic projection", () => {
  it.each([
    ["one investment", goldenBootstrap],
    ["momentum selection", momentumBootstrap],
    ["eligibility filter", filterBootstrap],
    ["selection fallback", fallbackBootstrap],
    ["cooldown constraint", cooldownBootstrap],
    ["parallel sleeves", sleevesBootstrap],
    ["independent schedules", independentSchedulesBootstrap],
  ])("projects %s as deterministic semantic capital flow", (_name, bootstrap) => {
    const first = canvas(bootstrap as typeof goldenBootstrap);
    const second = canvas(bootstrap as typeof goldenBootstrap);
    expect(first).toEqual(second);
    expect(first.nodes.some((item) => item.data.semanticKind === "universe")).toBe(true);
    expect(first.nodes.some((item) => item.data.semanticKind === "allocation")).toBe(true);
    expect(first.nodes.some((item) => item.data.semanticKind === "action")).toBe(true);
  });

  it("keeps Eligibility, Selection, Allocation, and Action distinct", () => {
    const graph = canvas(filterBootstrap as typeof goldenBootstrap);
    expect(graph.nodes.map((item) => item.data.semanticKind)).toEqual(expect.arrayContaining([
      "universe", "eligibility", "selection", "allocation", "action",
    ]));
    expect(graph.edges.some((item) => item.label === "eligible candidates")).toBe(true);
    expect(graph.edges.some((item) => item.label === "selected candidates")).toBe(true);
    expect(graph.edges.some((item) => item.label === "portfolio targets")).toBe(true);
  });

  it("represents fallback and cooldown as Selection modifiers, never false routing", () => {
    const fallback = canvas(fallbackBootstrap as typeof goldenBootstrap);
    expect(fallback.nodes.find((item) => item.data.semanticKind === "fallback")?.data.title).toBe("Selection fallback");
    expect(fallback.edges.find((item) => item.target.startsWith("fallback:"))?.label).toBe("if incomplete");
    expect(fallback.edges.find((item) => item.target.startsWith("fallback:"))?.source).toMatch(/^selection:/);
    const cooldown = canvas(cooldownBootstrap as typeof goldenBootstrap);
    expect(cooldown.nodes.find((item) => item.data.semanticKind === "constraint")?.data.title).toBe("Selection constraint");
    expect(cooldown.edges.find((item) => item.target.startsWith("constraint:"))?.label).toBe("modifies");
  });

  it("lays out sleeves in parallel with ownership edges and independent schedules", () => {
    const graph = canvas(independentSchedulesBootstrap as typeof goldenBootstrap);
    const groups = graph.nodes.filter((item) => item.data.semanticKind === "group");
    expect(groups).toHaveLength(2);
    expect(groups[0].position.y).toBe(groups[1].position.y);
    expect(groups[0].position.x).not.toBe(groups[1].position.x);
    expect(graph.edges.filter((item) => item.label === "70%" || item.label === "30%")).toHaveLength(2);
    const scheduleEdges = graph.edges.filter((item) => item.className?.includes("timing-edge"));
    expect(scheduleEdges.length).toBeGreaterThanOrEqual(2);
    expect(scheduleEdges.every((item) => item.label === "evaluates")).toBe(true);
  });

  it("projects true, false, and no-ELSE retain-holdings routing explicitly", () => {
    const base = projectConceptualFlow(goldenBootstrap.strategy, goldenBootstrap.registry);
    const withElse: ConceptualFlowProjection = { ...base, predicate: {
      componentId: "market_rule", label: "SPY 126-observation return > 0%",
      thenTarget: "growth_targets", otherwiseTarget: "defensive_targets",
    } };
    const routed = projectFlowCanvas(withElse);
    expect(routed.edges.find((item) => item.sourceHandle === "true")?.label).toBe("true");
    expect(routed.edges.find((item) => item.sourceHandle === "false")?.label).toBe("false");
    expect(routed.nodes.find((item) => item.id === "predicate:otherwise")?.data.detail).toBe("defensive_targets");

    const noElse = projectFlowCanvas({ ...base, predicate: {
      componentId: "market_rule", label: "SPY 126-observation return > 0%", thenTarget: "growth_targets",
    } });
    expect(noElse.nodes.find((item) => item.id === "predicate:retain")?.data.detail).toContain("Retain current holdings");
    expect(noElse.nodes.some((item) => item.id === "predicate:otherwise")).toBe(false);
  });

  it("preserves local presentation positions by stable semantic identity after Canonical reprojection", () => {
    const projected = canvas(fallbackBootstrap as typeof goldenBootstrap).nodes;
    const selectionId = projected.find((item) => item.data.semanticKind === "selection")!.id;
    const moved = projected.map((item) => item.id === selectionId
      ? { ...item, position: { x: 901, y: 707 } } : item);
    const reprojected = canvas(fallbackBootstrap as typeof goldenBootstrap).nodes;
    expect(mergeFlowNodePositions(reprojected, moved).find((item) => item.id === selectionId)?.position).toEqual({ x: 901, y: 707 });
    expect(reprojected.find((item) => item.id === selectionId)?.data.selection.componentId).toBe("top_n");
  });
});
