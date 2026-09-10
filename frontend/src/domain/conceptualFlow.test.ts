import { describe, expect, it } from "vitest";
import { conceptualOnlyAllocationExample, projectConceptualFlow } from "./conceptualFlow";
import { cooldownBootstrap, fallbackBootstrap, filterBootstrap, goldenBootstrap, independentSchedulesBootstrap, momentumBootstrap, sleevesBootstrap } from "../test/fixture";
import { createEditorState, editorReducer } from "../store/editorStore";

describe("Conceptual Flow v2 projection", () => {
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
    expect(choose.ranking).toBe("Weakest first");
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

  it("edits Choose through Canonical and immediately reprojects", () => {
    const initial = createEditorState(fallbackBootstrap);
    const threshold = editorReducer(initial, { type:"apply_semantic_patch", operation:{kind:"update_component_config",componentId:"positive_return",field:"threshold",value:"-0.05"} });
    const count = editorReducer(threshold, { type:"apply_semantic_patch", operation:{kind:"update_component_config",componentId:"top_n",field:"count",value:3} });
    expect(projectConceptualFlow(count.canonical,count.registry).groups[0].choose).toMatchObject({ threshold:"-0.05", topN:3, label:"Choose 3" });
  });

  it("updates a supported asset group but rejects empty or duplicate groups", () => {
    const initial = createEditorState(goldenBootstrap);
    const added = editorReducer(initial,{type:"apply_semantic_patch",operation:{kind:"update_asset_set_assets",assetSetId:"growth",assets:["QQQ","VGT","SOXX","SCHG","VTI"]}});
    expect(projectConceptualFlow(added.canonical,added.registry).groups[0].assets).toContain("VTI");
    const duplicate = editorReducer(initial,{type:"apply_semantic_patch",operation:{kind:"update_asset_set_assets",assetSetId:"growth",assets:["QQQ","QQQ"]}});
    expect(duplicate.canonical).toBe(initial.canonical);
    expect(duplicate.validation.status).toBe("invalid");
  });

  it("keeps conceptual selection, hierarchy, and layout editor-only", () => {
    const initial=createEditorState(sleevesBootstrap); const before=JSON.stringify(initial.canonical);
    const selected=editorReducer(initial,{type:"select_concept",conceptId:"split"});
    const opened=editorReducer(selected,{type:"open_group",groupId:"growth_sleeve"});
    const moved=editorReducer(opened,{type:"move_node",componentId:"concept:choose",position:{x:321,y:222}});
    expect(moved.editor).toMatchObject({selectedConceptId:null,openGroupId:"growth_sleeve",nodePositions:{"concept:choose":{x:321,y:222}}});
    expect(JSON.stringify(moved.canonical)).toBe(before);
  });
});
