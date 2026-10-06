import { describe, expect, it } from "vitest";

import { projectConceptualFlow, type ConceptualFlowProjection } from "./conceptualFlow";
import {
  cooldownBootstrap, fallbackBootstrap, filterBootstrap, goldenBootstrap,
  independentSchedulesBootstrap, momentumBootstrap, sleevesBootstrap,
} from "../test/fixture";
import { mergeFlowNodePositions, projectFlowCanvas, type FlowRelationshipRole, type FlowVisualRole } from "../views/FlowView";

function canvas(bootstrap: typeof goldenBootstrap) {
  return projectFlowCanvas(projectConceptualFlow(bootstrap.strategy, bootstrap.registry));
}

const visualRoles: FlowVisualRole[] = ["capital", "routing", "decision-detail", "timing", "constraint", "action"];
const relationshipRoles: FlowRelationshipRole[] = ["capital", "routing", "decision-detail", "timing", "constraint", "action"];

describe("native capital Flow projection", () => {
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
    expect(first.nodes.some((item) => item.data.semanticKind === "action")).toBe(true);
  });

  it("aggregates Universe, Eligibility, and ranking into the Selection mechanism without losing provenance", () => {
    const graph = canvas(filterBootstrap as typeof goldenBootstrap);
    const selection = graph.nodes.find((item) => item.data.semanticKind === "selection")!;
    expect(graph.nodes.some((item) => item.data.semanticKind === "universe")).toBe(false);
    expect(graph.nodes.some((item) => item.data.semanticKind === "eligibility")).toBe(false);
    expect(selection.data.visualRole).toBe("routing");
    expect(selection.data.detail).toContain("eligibility filter");
    expect(selection.data.provenance?.some((item) => item.role === "universe")).toBe(true);
    expect(selection.data.provenance?.some((item) => item.role === "qualification")).toBe(true);
    expect(graph.edges.some((item) => ["candidates", "eligible candidates", "selected candidates"].includes(String(item.label)))).toBe(false);
  });

  it("routes normal Selection and incomplete Selection to distinct capital destinations", () => {
    const graph = canvas(fallbackBootstrap as typeof goldenBootstrap);
    const selection = graph.nodes.find((item) => item.data.semanticKind === "selection")!;
    const selected = graph.nodes.find((item) => item.id.startsWith("selected-target:"))!;
    const fallback = graph.nodes.find((item) => item.data.semanticKind === "fallback")!;
    expect(selected.data).toMatchObject({ title: "Selected assets", visualRole: "capital" });
    expect(fallback.data).toMatchObject({ title: "Fallback exposure", visualRole: "capital" });
    expect(graph.edges.find((item) => item.source === selection.id && item.target === selected.id))
      .toMatchObject({ label: "selected", data: { role: "routing" } });
    expect(graph.edges.find((item) => item.source === selection.id && item.target === fallback.id))
      .toMatchObject({ label: "if incomplete", data: { role: "routing" } });
    expect(graph.edges.some((item) => item.target === fallback.id && item.sourceHandle === "false")).toBe(false);
  });

  it("keeps allocation and action on the capital path without an intermediate portfolio-target node", () => {
    const graph = canvas(momentumBootstrap as typeof goldenBootstrap);
    const selected = graph.nodes.find((item) => item.data.semanticKind === "exposure")!;
    const allocation = graph.nodes.find((item) => item.data.semanticKind === "allocation")!;
    const action = graph.nodes.find((item) => item.data.semanticKind === "action")!;
    expect(graph.nodes.some((item) => item.data.semanticKind === "target")).toBe(false);
    expect(graph.edges.find((item) => item.source === selected.id && item.target === allocation.id))
      .toMatchObject({ label: "equal weight", data: { role: "capital" } });
    expect(graph.edges.find((item) => item.source === allocation.id && item.target === action.id)?.data?.role).toBe("action");
  });

  it("keeps Cooldown and schedules as non-capital attachments", () => {
    const cooldown = canvas(cooldownBootstrap as typeof goldenBootstrap);
    const cooldownNode = cooldown.nodes.find((item) => item.data.semanticKind === "constraint")!;
    expect(cooldownNode.data.visualRole).toBe("constraint");
    expect(cooldown.edges.filter((item) => item.source === cooldownNode.id || item.target === cooldownNode.id)
      .every((item) => item.data?.role === "constraint")).toBe(true);
    const scheduled = canvas(independentSchedulesBootstrap as typeof goldenBootstrap);
    const schedules = scheduled.nodes.filter((item) => item.data.semanticKind === "schedule");
    expect(schedules.length).toBeGreaterThanOrEqual(2);
    expect(scheduled.edges.filter((item) => schedules.some((schedule) => schedule.id === item.source))
      .every((item) => item.data?.role === "timing")).toBe(true);
  });

  it("projects Predicate true/false routing and no-ELSE retain holdings as exposure outcomes", () => {
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
    const noElse = projectFlowCanvas({ ...base, predicate: {
      componentId: "market_rule", label: "SPY 126-observation return > 0%", thenTarget: base.groups[0].allocationComponentId,
    } });
    expect(noElse.nodes.find((item) => item.id === "predicate:retain")?.data.title).toBe("Retain holdings");
  });

  it("keeps sleeves parallel and preserves positions by stable aggregated identity", () => {
    const graph = canvas(sleevesBootstrap as typeof goldenBootstrap);
    const groups = graph.nodes.filter((item) => item.data.semanticKind === "group");
    expect(groups).toHaveLength(2);
    expect(groups[0].position.y).toBe(groups[1].position.y);
    expect(graph.edges.filter((item) => item.source === "split" && groups.some((group) => group.id === item.target)).map((item) => item.label)).toEqual(["70%", "30%"]);
    const projected = canvas(fallbackBootstrap as typeof goldenBootstrap).nodes;
    const selectionId = projected.find((item) => item.data.semanticKind === "selection")!.id;
    const moved = projected.map((item) => item.id === selectionId ? { ...item, position: { x: 901, y: 707 } } : item);
    expect(mergeFlowNodePositions(canvas(fallbackBootstrap as typeof goldenBootstrap).nodes, moved)
      .find((item) => item.id === selectionId)?.position).toEqual({ x: 901, y: 707 });
  });
});
