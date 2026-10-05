import { describe, expect, it } from "vitest";

import { projectConceptualFlow, type ConceptualFlowProjection } from "./conceptualFlow";
import {
  cooldownBootstrap, fallbackBootstrap, filterBootstrap, goldenBootstrap,
  independentSchedulesBootstrap, momentumBootstrap, sleevesBootstrap,
} from "../test/fixture";
import {
  mergeFlowNodePositions, projectFlowCanvas,
  type FlowRelationshipRole, type FlowVisualRole,
} from "../views/FlowView";

function canvas(bootstrap: typeof goldenBootstrap) {
  return projectFlowCanvas(projectConceptualFlow(bootstrap.strategy, bootstrap.registry));
}

const visualRoles: FlowVisualRole[] = ["capital", "routing", "decision-detail", "timing", "constraint", "action"];
const relationshipRoles: FlowRelationshipRole[] = ["capital", "routing", "decision-detail", "timing", "constraint", "action"];

describe("capital-first Flow projection", () => {
  it.each([
    ["one investment", goldenBootstrap],
    ["momentum selection", momentumBootstrap],
    ["eligibility filter", filterBootstrap],
    ["selection fallback", fallbackBootstrap],
    ["cooldown constraint", cooldownBootstrap],
    ["parallel sleeves", sleevesBootstrap],
    ["independent schedules", independentSchedulesBootstrap],
  ])("projects %s deterministically with explicit visual grammar", (_name, bootstrap) => {
    const first = canvas(bootstrap as typeof goldenBootstrap);
    const second = canvas(bootstrap as typeof goldenBootstrap);
    expect(first).toEqual(second);
    expect(first.nodes.every((item) => visualRoles.includes(item.data.visualRole))).toBe(true);
    expect(first.edges.every((item) => relationshipRoles.includes(item.data!.role))).toBe(true);
    expect(first.nodes.some((item) => item.data.semanticKind === "allocation")).toBe(true);
    expect(first.nodes.some((item) => item.data.semanticKind === "action")).toBe(true);
  });

  it("classifies capital, routing, decision detail, timing, and constraint independently", () => {
    const graphs = [
      canvas(fallbackBootstrap as typeof goldenBootstrap),
      canvas(cooldownBootstrap as typeof goldenBootstrap),
      canvas(independentSchedulesBootstrap as typeof goldenBootstrap),
    ];
    const nodeRoles = new Set(graphs.flatMap((graph) => graph.nodes.map((item) => item.data.visualRole)));
    const edgeRoles = new Set(graphs.flatMap((graph) => graph.edges.map((item) => item.data!.role)));
    for (const role of ["capital", "routing", "decision-detail", "timing", "constraint"] as const) {
      expect(nodeRoles.has(role)).toBe(true);
      expect(edgeRoles.has(role)).toBe(true);
    }
  });

  it("keeps Universe and Eligibility off the primary Momentum capital path", () => {
    const graph = canvas(filterBootstrap as typeof goldenBootstrap);
    const universe = graph.nodes.find((item) => item.data.semanticKind === "universe")!;
    const eligibility = graph.nodes.find((item) => item.data.semanticKind === "eligibility")!;
    const selection = graph.nodes.find((item) => item.data.semanticKind === "selection")!;
    const selected = graph.nodes.find((item) => item.data.semanticKind === "exposure")!;
    const allocation = graph.nodes.find((item) => item.data.semanticKind === "allocation")!;

    expect(universe.data.visualRole).toBe("decision-detail");
    expect(eligibility.data.visualRole).toBe("decision-detail");
    expect(selection.data.visualRole).toBe("routing");
    expect(selected.data.visualRole).toBe("capital");
    expect(allocation.data.visualRole).toBe("capital");
    expect(graph.edges.filter((item) => [universe.id, eligibility.id].includes(item.source) || [universe.id, eligibility.id].includes(item.target))
      .some((item) => item.data?.role === "capital" || item.data?.role === "routing")).toBe(false);
    expect(graph.edges.find((item) => item.source === universe.id && item.target === selection.id)?.data?.role).toBe("decision-detail");
    expect(graph.edges.find((item) => item.source === eligibility.id && item.target === selection.id)?.data?.role).toBe("decision-detail");
    expect(graph.edges.some((item) => ["candidates", "eligible candidates", "selected candidates"].includes(String(item.label)))).toBe(false);
  });

  it("routes normal Selection and incomplete Selection to distinct capital destinations", () => {
    const graph = canvas(fallbackBootstrap as typeof goldenBootstrap);
    const selection = graph.nodes.find((item) => item.data.semanticKind === "selection")!;
    const selected = graph.nodes.find((item) => item.id.startsWith("selected-target:"))!;
    const fallback = graph.nodes.find((item) => item.data.semanticKind === "fallback")!;
    const target = graph.nodes.find((item) => item.data.semanticKind === "target")!;

    expect(selected.data.visualRole).toBe("capital");
    expect(fallback.data).toMatchObject({ title: "Fallback exposure", visualRole: "capital" });
    expect(graph.edges.find((item) => item.source === selection.id && item.target === selected.id))
      .toMatchObject({ label: "selection succeeds", data: { role: "routing" } });
    expect(graph.edges.find((item) => item.source === selection.id && item.target === fallback.id))
      .toMatchObject({ label: "if incomplete", data: { role: "routing" } });
    expect(graph.edges.find((item) => item.source === fallback.id && item.target === target.id)?.data?.role).toBe("capital");
    expect(graph.edges.some((item) => item.target === fallback.id && item.sourceHandle === "false")).toBe(false);
  });

  it("makes equal allocation and target realization explicit capital semantics", () => {
    const graph = canvas(momentumBootstrap as typeof goldenBootstrap);
    const selected = graph.nodes.find((item) => item.data.semanticKind === "exposure")!;
    const allocation = graph.nodes.find((item) => item.data.semanticKind === "allocation")!;
    const target = graph.nodes.find((item) => item.data.semanticKind === "target")!;
    const action = graph.nodes.find((item) => item.data.semanticKind === "action")!;
    expect(graph.edges.find((item) => item.source === selected.id && item.target === allocation.id))
      .toMatchObject({ label: "equal weight", data: { role: "capital" } });
    expect(graph.edges.find((item) => item.source === allocation.id && item.target === target.id)?.data?.role).toBe("capital");
    expect(graph.edges.find((item) => item.source === target.id && item.target === action.id)?.data?.role).toBe("action");
  });

  it("keeps Cooldown attached as a constraint instead of putting it on the capital spine", () => {
    const graph = canvas(cooldownBootstrap as typeof goldenBootstrap);
    const cooldown = graph.nodes.find((item) => item.data.semanticKind === "constraint")!;
    expect(cooldown.data.visualRole).toBe("constraint");
    expect(graph.edges.filter((item) => item.source === cooldown.id || item.target === cooldown.id)
      .every((item) => item.data?.role === "constraint")).toBe(true);
  });

  it("projects Predicate true/false as primary capital routing rather than program order", () => {
    const base = projectConceptualFlow(sleevesBootstrap.strategy, sleevesBootstrap.registry);
    const routed: ConceptualFlowProjection = { ...base, predicate: {
      componentId: "market_rule", label: "SPY 126-observation return > 0%",
      thenTarget: base.groups[0].allocationComponentId,
      otherwiseTarget: base.groups[1].allocationComponentId,
    } };
    const graph = projectFlowCanvas(routed);
    const predicate = graph.nodes.find((item) => item.data.semanticKind === "predicate")!;
    const groups = graph.nodes.filter((item) => item.data.semanticKind === "group");
    expect(predicate.data.visualRole).toBe("routing");
    expect(graph.edges.find((item) => item.source === predicate.id && item.target === groups[0].id))
      .toMatchObject({ label: "true", data: { role: "routing" } });
    expect(graph.edges.find((item) => item.source === predicate.id && item.target === groups[1].id))
      .toMatchObject({ label: "false", data: { role: "routing" } });
    expect(graph.nodes.some((item) => item.data.title.includes("program"))).toBe(false);
  });

  it("projects no-ELSE false as retain-holdings exposure outcome", () => {
    const base = projectConceptualFlow(goldenBootstrap.strategy, goldenBootstrap.registry);
    const graph = projectFlowCanvas({ ...base, predicate: {
      componentId: "market_rule", label: "SPY 126-observation return > 0%",
      thenTarget: base.groups[0].allocationComponentId,
    } });
    const retain = graph.nodes.find((item) => item.id === "predicate:retain")!;
    expect(retain.data).toMatchObject({ title: "Retain holdings", visualRole: "capital" });
    expect(retain.data.detail).toContain("no branch mutation");
    expect(graph.edges.find((item) => item.target === retain.id))
      .toMatchObject({ label: "false · retain holdings", data: { role: "routing" } });
  });

  it("keeps 70/30 sleeves parallel under the same Split parent", () => {
    const graph = canvas(sleevesBootstrap as typeof goldenBootstrap);
    const groups = graph.nodes.filter((item) => item.data.semanticKind === "group");
    expect(groups).toHaveLength(2);
    expect(groups[0].position.y).toBe(groups[1].position.y);
    expect(groups[0].position.x).not.toBe(groups[1].position.x);
    const ownership = graph.edges.filter((item) => item.source === "split" && groups.some((group) => group.id === item.target));
    expect(ownership.map((item) => item.label)).toEqual(["70%", "30%"]);
    expect(ownership.every((item) => item.data?.role === "routing")).toBe(true);
    expect(graph.edges.some((item) => item.source === groups[0].id && item.target === groups[1].id)).toBe(false);
  });

  it("attaches independent schedules with non-capital timing relationships", () => {
    const graph = canvas(independentSchedulesBootstrap as typeof goldenBootstrap);
    const schedules = graph.nodes.filter((item) => item.data.semanticKind === "schedule");
    expect(schedules.length).toBeGreaterThanOrEqual(2);
    expect(schedules.every((item) => item.data.visualRole === "timing")).toBe(true);
    const scheduleIds = new Set(schedules.map((item) => item.id));
    const attachments = graph.edges.filter((item) => scheduleIds.has(item.source));
    expect(attachments.every((item) => item.data?.role === "timing" && item.label === "evaluates")).toBe(true);
    expect(attachments.every((item) => item.markerEnd === undefined)).toBe(true);
  });

  it("preserves local positions by deterministic aggregated semantic identity", () => {
    const projected = canvas(fallbackBootstrap as typeof goldenBootstrap).nodes;
    const selectionId = projected.find((item) => item.data.semanticKind === "selection")!.id;
    const targetId = projected.find((item) => item.data.semanticKind === "target")!.id;
    const moved = projected.map((item) => item.id === selectionId
      ? { ...item, position: { x: 901, y: 707 } } : item);
    const reprojected = canvas(fallbackBootstrap as typeof goldenBootstrap).nodes;
    const merged = mergeFlowNodePositions(reprojected, moved);
    expect(merged.find((item) => item.id === selectionId)?.position).toEqual({ x: 901, y: 707 });
    expect(targetId).toMatch(/^portfolio-target:/);
    expect(reprojected.find((item) => item.id === selectionId)?.data.selection.componentId).toBe("top_n");
  });
});
