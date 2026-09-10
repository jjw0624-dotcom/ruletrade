import { describe, expect, it } from "vitest";
import { createEditorState, editorReducer } from "../store/editorStore";
import { cooldownBootstrap, fallbackBootstrap, goldenBootstrap, independentSchedulesBootstrap, sleevesBootstrap } from "../test/fixture";
import { projectConceptualFlow } from "./conceptualFlow";
import { projectGuided } from "./guided";

describe("Guided and intuitive Flow authoring parity",()=>{
  it("derives actual operator and ranking limits from Registry",()=>{
    const registry=sleevesBootstrap.registry.primitives;
    expect(registry.find(item=>item.id==="filter@1")?.fields.find(field=>field.name==="operator")?.choices).toEqual(["gt"]);
    expect(registry.find(item=>item.id==="rank@1")?.fields.find(field=>field.name==="direction")?.choices).toEqual(["descending"]);
    expect(registry.filter(item=>item.id.includes("weight")).map(item=>item.id)).toEqual(["equal_weight@1"]);
  });

  it("keeps asset membership, lookback, threshold, Top N and fallback in one Canonical",()=>{
    let state=createEditorState(fallbackBootstrap);
    state=editorReducer(state,{type:"apply_semantic_patch",operation:{kind:"update_asset_set_assets",assetSetId:"universe",assets:["QQQ","VGT","SOXX","SCHG","VTI"]}});
    state=editorReducer(state,{type:"apply_semantic_patch",operation:{kind:"update_component_config",componentId:"momentum",field:"lookback_bars",value:63}});
    state=editorReducer(state,{type:"apply_semantic_patch",operation:{kind:"update_component_config",componentId:"positive_return",field:"threshold",value:"0.05"}});
    state=editorReducer(state,{type:"apply_semantic_patch",operation:{kind:"update_component_config",componentId:"top_n",field:"count",value:3}});
    state=editorReducer(state,{type:"apply_semantic_patch",operation:{kind:"update_component_config",componentId:"fallback",field:"fallback_asset_set_ref",value:"fallback_ief"}});
    const guided=projectGuided(state.canonical,state.registry); const flow=projectConceptualFlow(state.canonical,state.registry);
    expect(guided.kind==="momentum"&&guided.momentum).toMatchObject({assets:["QQQ","VGT","SOXX","SCHG","VTI"],lookbackBars:63,threshold:"0.05",topN:3,fallbackAsset:"IEF"});
    expect(flow.groups[0].choose).toMatchObject({lookbackBars:63,threshold:"0.05",topN:3,otherwise:"Otherwise → IEF"});
  });

  it("keeps Cooldown and schedules in both projections",()=>{
    let state=createEditorState(cooldownBootstrap);
    state=editorReducer(state,{type:"apply_semantic_patch",operation:{kind:"update_component_config",componentId:"cooldown",field:"duration",value:30}});
    state=editorReducer(state,{type:"apply_semantic_patch",operation:{kind:"update_schedule",componentId:"daily",cadence:"quarterly"}});
    const guided=projectGuided(state.canonical,state.registry); const flow=projectConceptualFlow(state.canonical,state.registry);
    expect(guided.kind==="momentum"&&guided.momentum).toMatchObject({cooldownDuration:30,schedule:"Quarterly"});
    expect(flow.groups[0].choose).toMatchObject({cooldownDuration:30,timing:"Quarterly"});
  });

  it("updates independent sleeve and portfolio timing without conflating them",()=>{
    let state=createEditorState(independentSchedulesBootstrap);
    state=editorReducer(state,{type:"apply_semantic_patch",operation:{kind:"update_schedule",componentId:"growth_monthly",cadence:"quarterly"}});
    const guided=projectGuided(state.canonical,state.registry); const flow=projectConceptualFlow(state.canonical,state.registry);
    expect(guided.kind==="portfolio"&&guided.growth.refreshSchedule).toBe("Quarterly");
    expect(flow.groups[0].timing).toBe("Quarterly");
    expect(flow.rebalance).toBe("Quarterly");
  });

  it("updates sleeve allocation atomically and rejects an invalid total",()=>{
    const initial=createEditorState(sleevesBootstrap);
    const valid=editorReducer(initial,{type:"apply_semantic_patch",operation:{kind:"update_sleeve_allocations",allocations:[{componentId:"growth_sleeve",value:"0.6"},{componentId:"defensive_sleeve",value:"0.4"}]}});
    expect(projectConceptualFlow(valid.canonical,valid.registry).groups.map(group=>group.allocation)).toEqual(["60%","40%"]);
    const invalid=editorReducer(initial,{type:"apply_semantic_patch",operation:{kind:"update_sleeve_allocations",allocations:[{componentId:"growth_sleeve",value:"0.8"},{componentId:"defensive_sleeve",value:"0.4"}]}});
    expect(invalid.canonical).toBe(initial.canonical);
  });

  it("exposes random resampling in the same conceptual Choose",()=>{
    const state=editorReducer(createEditorState(goldenBootstrap),{type:"apply_semantic_patch",operation:{kind:"update_component_config",componentId:"growth_random",field:"resample",value:"once"}});
    expect(projectGuided(state.canonical,state.registry).kind).toBe("golden");
    expect(projectConceptualFlow(state.canonical,state.registry).groups[0].choose).toMatchObject({selectionMode:"random",resample:"once"});
  });
});
