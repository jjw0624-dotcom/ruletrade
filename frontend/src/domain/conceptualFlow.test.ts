import { describe, expect, it } from "vitest";
import { conceptualOnlyAllocationExample, projectConceptualFlow } from "./conceptualFlow";
import { cooldownBootstrap, fallbackBootstrap, filterBootstrap, goldenBootstrap, independentSchedulesBootstrap, momentumBootstrap, sleevesBootstrap } from "../test/fixture";
import { createEditorState, editorReducer } from "../store/editorStore";
import { authoringResponse } from "../test/authoringResponse";

function backendFallbackRemoval() {
  const canonical = structuredClone(fallbackBootstrap.strategy);
  canonical.graph.components = canonical.graph.components.filter((item) => item.id !== "fallback");
  canonical.graph.connections = canonical.graph.connections.flatMap((connection) => {
    if (connection.source.component_id === "weights" && connection.target.component_id === "fallback") return [{ source: connection.source, target: { component_id: "rebalance", port: "targets" } }];
    return connection.source.component_id === "fallback" ? [] : [connection];
  });
  canonical.definitions.asset_sets = canonical.definitions.asset_sets.filter((item) => item.id !== "fallback_tlt");
  return canonical;
}

describe("Conceptual Flow v2 projection", () => {
  it("continues to project the backend result after Fallback removal", () => {
    const flow = projectConceptualFlow(backendFallbackRemoval(), fallbackBootstrap.registry);
    expect(flow.unsupportedReason).toBeUndefined();
    expect(flow.groups[0].choose?.fallbackComponentId).toBeUndefined();
    expect(flow.groups[0].choose?.otherwise).toBeUndefined();
  });
  it.each([
    ["golden", goldenBootstrap],
    ["momentum", momentumBootstrap],
    ["filter", filterBootstrap],
    ["fallback", fallbackBootstrap],
    ["sleeves", sleevesBootstrap],
    ["independent schedules", independentSchedulesBootstrap],
    ["cooldown", cooldownBootstrap],
  ])("projects %s deterministically without changing Canonical", (_name, bootstrap) => {
    const before = JSON.stringify(bootstrap.strategy);
    const first = projectConceptualFlow(bootstrap.strategy, bootstrap.registry);
    const second = projectConceptualFlow(bootstrap.strategy, bootstrap.registry);
    expect(first).toEqual(second);
    expect(JSON.stringify(bootstrap.strategy)).toBe(before);
    expect(first.groups.length).toBeGreaterThan(0);
    expect(first.sourceComponentIds.length).toBeGreaterThan(0);
  });

  it("compresses selection primitives into one Choose while retaining provenance", () => {
    const flow = projectConceptualFlow(fallbackBootstrap.strategy, fallbackBootstrap.registry);
    const choose = flow.groups[0].choose!;
    expect(choose.label).toBe("Choose 2");
    expect(choose.condition).toBe("6M return > 0%");
    expect(choose.ranking).toBe("Strongest first");
    expect(choose.otherwise).toBe("Otherwise → TLT");
    expect(choose.sourceComponentIds).toEqual(expect.arrayContaining(["momentum", "positive_return", "top_n", "fallback"]));
  });

  it("projects sleeve hierarchy, split, and independent timing as properties", () => {
    const flow = projectConceptualFlow(independentSchedulesBootstrap.strategy, independentSchedulesBootstrap.registry);
    expect(flow.kind).toBe("portfolio");
    expect(flow.groups.map((group) => [group.label, group.allocation])).toEqual([["Growth", "70%"], ["Defensive", "30%"]]);
    expect(flow.groups[0].timing).toBe("Monthly");
    expect(flow.groups[1].timing).toBe("Quarterly");
    expect(flow.rebalance).toBe("Quarterly");
  });

  it("keeps Cooldown inside Choose intent", () => {
    const flow = projectConceptualFlow(cooldownBootstrap.strategy, cooldownBootstrap.registry);
    expect(flow.groups[0].choose?.cooldown).toContain("trading days");
    expect(flow.groups[0].choose?.sourceComponentIds).toContain("cooldown");
  });

  it("marks unsupported conditional allocation instead of fabricating execution", () => {
    expect(conceptualOnlyAllocationExample.supported).toBe(false);
    expect(conceptualOnlyAllocationExample.reason).toContain("do not express");
  });

  it("retains editable component and asset-set identities", () => {
    const flow = projectConceptualFlow(sleevesBootstrap.strategy, sleevesBootstrap.registry);
    expect(flow.split?.groups.map((group) => group.componentId)).toEqual(["growth_sleeve", "defensive_sleeve"]);
    expect(flow.groups[0].assetSetId).toBe("universe");
    expect(flow.groups[0].choose).toMatchObject({ filterComponentId: "positive_return", selectionComponentId: "top_n", fallbackComponentId: "fallback" });
  });

  it("reprojects a backend-authored Choose response", () => {
    const initial = createEditorState(fallbackBootstrap);
    const threshold = editorReducer(initial, { type: "replace_canonical_dirty", canonical: authoringResponse(initial.canonical, "positive_return", { threshold: "-0.05" }) });
    const count = editorReducer(threshold, { type: "replace_canonical_dirty", canonical: authoringResponse(threshold.canonical, "top_n", { count: 3 }) });
    expect(projectConceptualFlow(count.canonical,count.registry).groups[0].choose).toMatchObject({ threshold:"-0.05", topN:3, label:"Choose 3" });
  });

  it("reprojects a backend-authored asset group", () => {
    const initial = createEditorState(goldenBootstrap);
    const canonical = structuredClone(initial.canonical);
    canonical.definitions.asset_sets.find((item) => item.id === "growth")!.assets.push("VTI");
    const added = editorReducer(initial, { type: "replace_canonical_dirty", canonical });
    expect(projectConceptualFlow(added.canonical,added.registry).groups[0].assets).toContain("VTI");
  });

  it("keeps semantic selection editor-only", () => {
    const initial=createEditorState(sleevesBootstrap); const before=JSON.stringify(initial.canonical);
    const selected=editorReducer(initial,{type:"select_semantic",selection:{role:"split",componentId:"portfolio",fieldPath:null,groupId:null}});
    expect(selected.editor.selection).toMatchObject({role:"split",componentId:"portfolio"});
    expect(JSON.stringify(selected.canonical)).toBe(before);
  });
});
