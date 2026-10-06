import { describe, expect, it } from "vitest";

import { projectConceptualFlow, type ConceptualFlowProjection } from "./conceptualFlow";
import {
  cooldownBootstrap, fallbackBootstrap, filterBootstrap, goldenBootstrap,
  independentSchedulesBootstrap, momentumBootstrap, sleevesBootstrap,
} from "../test/fixture";
import { flowNodeIdForSelection, mergeFlowNodePositions, projectFlowCanvas, type FlowRelationshipRole, type FlowVisualRole } from "../views/FlowView";
import { semanticSelection } from "./semanticSelection";

function canvas(bootstrap: typeof goldenBootstrap) {
  return projectFlowCanvas(projectConceptualFlow(bootstrap.strategy, bootstrap.registry));
}

const visualRoles: FlowVisualRole[] = ["capital", "routing", "decision-detail", "timing", "constraint", "action"];
const relationshipRoles: FlowRelationshipRole[] = ["capital", "routing", "decision-detail", "timing", "constraint", "action"];

describe("minimal capital Flow projection", () => {
  it.each([
    ["one investment", goldenBootstrap], ["momentum selection", momentumBootstrap],
    ["eligibility filter", filterBootstrap], ["selection fallback", fallbackBootstrap],
    ["cooldown constraint", cooldownBootstrap], ["parallel sleeves", sleevesBootstrap],
    ["independent schedules", independentSchedulesBootstrap],
  ])("projects %s deterministically with the capital grammar", (_name, bootstrap) => {
    const first = canvas(bootstrap as typeof goldenBootstrap);
    expect(first).toEqual(canvas(bootstrap as typeof goldenBootstrap));
    expect(first.nodes.every((item) => visualRoles.includes(item.data.visualRole))).toBe(true);
    expect(first.edges.every((item) => relationshipRoles.includes(item.data!.role))).toBe(true);
    expect(first.nodes.filter((item) => item.data.semanticKind === "action")).toHaveLength(1);
  });

  it("removes candidate-processing and intermediate target nodes from the default canvas", () => {
    const graph = canvas(filterBootstrap as typeof goldenBootstrap);
    const destination = graph.nodes.find((item) => item.id.startsWith("selected-target:"))!;
    for (const kind of ["universe", "eligibility", "allocation", "target", "schedule", "constraint"] as const) {
      expect(graph.nodes.some((item) => item.data.semanticKind === kind)).toBe(false);
    }
    expect(graph.nodes.some((item) => item.data.title === "Selection universe")).toBe(false);
    expect(graph.nodes.some((item) => item.data.title === "Portfolio target")).toBe(false);
    expect(destination.data.provenance?.some((item) => item.role === "universe")).toBe(true);
    expect(destination.data.provenance?.some((item) => item.role === "qualification")).toBe(true);
    expect(destination.data.badges).toContain("1 eligibility filter");
    expect(flowNodeIdForSelection(graph.nodes, semanticSelection("qualification", "positive_return"))).toBe(destination.id);
  });

  it("keeps Selection as a routing node only when fallback changes the capital destination", () => {
    const graph = canvas(fallbackBootstrap as typeof goldenBootstrap);
    const selection = graph.nodes.find((item) => item.data.semanticKind === "selection")!;
    const selected = graph.nodes.find((item) => item.id.startsWith("selected-target:"))!;
    const fallback = graph.nodes.find((item) => item.data.semanticKind === "fallback")!;
    expect(selection.data.detail).not.toContain("from ");
    expect(selected.data).toMatchObject({ title: "Selected assets", visualRole: "capital" });
    expect(fallback.data.visualRole).toBe("capital");
    expect(graph.edges.find((item) => item.source === selection.id && item.target === selected.id)?.label).toBe("selected · equal weight");
    expect(graph.edges.find((item) => item.source === selection.id && item.target === fallback.id)?.label).toBe("if incomplete");
    expect(graph.nodes.some((item) => item.data.semanticKind === "allocation")).toBe(false);
  });

  it("compresses allocation into capital-edge labels and uses one terminal Rebalance action", () => {
    const graph = canvas(momentumBootstrap as typeof goldenBootstrap);
    const destination = graph.nodes.find((item) => item.id.startsWith("selected-target:"))!;
    const action = graph.nodes.find((item) => item.data.semanticKind === "action")!;
    expect(graph.edges.find((item) => item.target === destination.id)?.label).toBe("selected · equal weight");
    expect(graph.edges.find((item) => item.source === destination.id && item.target === action.id)?.data?.role).toBe("action");
    expect(graph.nodes.some((item) => item.data.semanticKind === "allocation" && item.id !== "split")).toBe(false);
    expect(graph.nodes.some((item) => item.data.semanticKind === "target")).toBe(false);
  });

  it("compresses Cooldown and independent schedules into badges with exact provenance", () => {
    const cooldown = canvas(cooldownBootstrap as typeof goldenBootstrap);
    expect(cooldown.nodes.some((item) => item.data.semanticKind === "constraint")).toBe(false);
    const cooldownDestination = cooldown.nodes.find((item) => item.id.startsWith("selected-target:"))!;
    expect(cooldownDestination.data.badges).toContain("Wait 10 trading days");
    expect(cooldownDestination.data.provenance?.some((item) => item.role === "cooldown")).toBe(true);

    const scheduled = canvas(independentSchedulesBootstrap as typeof goldenBootstrap);
    expect(scheduled.nodes.some((item) => item.data.semanticKind === "schedule")).toBe(false);
    const scheduledUnits = scheduled.nodes.filter((item) => item.data.badges?.length);
    expect(scheduledUnits.length).toBeGreaterThanOrEqual(2);
    expect(scheduledUnits.flatMap((item) => item.data.provenance ?? []).some((item) => item.role === "schedule")).toBe(true);
  });

  it("projects Predicate true/false routing and no-ELSE retain holdings as capital outcomes", () => {
    const base = projectConceptualFlow(sleevesBootstrap.strategy, sleevesBootstrap.registry);
    const routed: ConceptualFlowProjection = { ...base, predicate: {
      componentId: "market_rule", label: "SPY 126-observation return > 0%",
      thenTarget: base.groups[0].allocationComponentId, otherwiseTarget: base.groups[1].allocationComponentId,
    } };
    const graph = projectFlowCanvas(routed);
    const predicate = graph.nodes.find((item) => item.data.semanticKind === "predicate")!;
    const groups = graph.nodes.filter((item) => item.data.semanticKind === "group");
    expect(graph.edges.find((item) => item.source === predicate.id && item.target === groups[0].id)?.label).toBe("true");
    expect(graph.edges.find((item) => item.source === predicate.id && item.target === groups[1].id)?.label).toBe("false");
    expect(predicate.data.title).toBe("SPY 126-observation return > 0%");

    const noElse = projectFlowCanvas({ ...base, predicate: {
      componentId: "market_rule", label: "SPY 126-observation return > 0%", thenTarget: base.groups[0].allocationComponentId,
    } });
    expect(noElse.nodes.find((item) => item.id === "predicate:retain")?.data.detail).toBe("Keep current exposure");
  });

  it("keeps 70/30 sleeves parallel with concise destinations and one shared action", () => {
    const graph = canvas(sleevesBootstrap as typeof goldenBootstrap);
    const groups = graph.nodes.filter((item) => item.data.semanticKind === "group");
    expect(groups).toHaveLength(2);
    expect(groups[0].position.y).toBe(groups[1].position.y);
    expect(graph.edges.filter((item) => item.source === "split" && groups.some((group) => group.id === item.target)).map((item) => item.label)).toEqual(["70%", "30%"]);
    expect(graph.nodes.filter((item) => item.data.semanticKind === "action")).toHaveLength(1);
    expect(graph.nodes.length).toBeLessThanOrEqual(8);
  });

  it("preserves user positions by stable aggregated semantic identity", () => {
    const projected = canvas(fallbackBootstrap as typeof goldenBootstrap).nodes;
    const selectionId = projected.find((item) => item.data.semanticKind === "selection")!.id;
    const moved = projected.map((item) => item.id === selectionId ? { ...item, position: { x: 901, y: 707 } } : item);
    expect(mergeFlowNodePositions(canvas(fallbackBootstrap as typeof goldenBootstrap).nodes, moved)
      .find((item) => item.id === selectionId)?.position).toEqual({ x: 901, y: 707 });
  });
});
