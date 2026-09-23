import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { projectLogicRepresentation, logicStepForSelection } from "./logicRepresentation";
import { projectConceptualFlow } from "./conceptualFlow";
import { projectFlowCanvas, flowNodeIdForSelection } from "../views/FlowView";
import { projectBuilderStructure } from "./builderProjection";
import { semanticSelection } from "./semanticSelection";
import { authoringApi, type StructuralAuthoringCapabilities } from "../structuralAuthoringApi";
import { aiContext, parseChangeProposal, describeChange } from "./aiHandoff";
import { blockFieldOperation, qualificationDropOperation } from "./blockyAuthoring";
import { createEditorState, editorReducer, StrategyEditorProvider } from "../store/editorStore";
import { RulesView } from "../views/RulesView";
import { GuidedView } from "../views/GuidedView";
import { OverviewView } from "../views/OverviewView";
import { CodeView } from "../views/CodeView";
import { filterBootstrap, momentumBootstrap } from "../test/fixture";
import type { StructuralAuthoringController } from "../hooks/useStructuralAuthoring";

const cap: StructuralAuthoringCapabilities = {
  groups: [], qualification_add_targets: ["momentum_rank"], qualification_remove_targets: ["positive_return"],
  cooldown_add_targets: [], cooldown_remove_targets: [], add_group: false, remove_group: false,
  rename_group: false, add_qualification_condition: true, remove_qualification_condition: true,
  multiple_qualification_conditions: false, choose_pipeline_targets: [], fallback_add_targets: [], fallback_remove_targets: [],
  growth_defensive_targets: [], create_choose_pipeline: false, add_fallback_selection: false,
  remove_fallback_selection: false, transform_to_growth_defensive: false,
  asset_set_targets: [], lookback_targets: [{ component_id: "momentum", value: 126, minimum: 1, maximum: null }],
  qualification_threshold_targets: [{ component_id: "positive_return", value: "0" }],
  selection_count_targets: [{ component_id: "top_n", value: 2, minimum: 1, maximum: 4 }],
  selection_resample_targets: [], sleeve_allocation_targets: [], schedule_targets: [],
  cooldown_duration_targets: [], fallback_asset_set_targets: [],
};
const structural: StructuralAuthoringController = { capabilities: cap, status: "ready", error: null, apply: async () => true };

describe("one Canonical, distinct editable perspectives", () => {
  it("maps Flow qualification to the same Blocky and Rules identity across switches", () => {
    const canonical = filterBootstrap.strategy;
    const flow = projectConceptualFlow(canonical, filterBootstrap.registry);
    const flowNode = projectFlowCanvas(flow).nodes.find((item) => item.data.selection.componentId === "positive_return")!;
    const selected = flowNode.data.selection;
    const state = editorReducer(createEditorState(filterBootstrap, "flow"), { type: "select_semantic", selection: selected });
    const blocky = editorReducer(state, { type: "set_active_view", view: "blocky" });
    expect(blocky.canonical).toBe(state.canonical);
    expect(blocky.validation).toEqual(state.validation);
    expect(logicStepForSelection(projectLogicRepresentation(blocky.canonical, filterBootstrap.registry), blocky.editor.selection)?.kind).toBe("condition");
    const rules = editorReducer(blocky, { type: "set_active_view", view: "rules" });
    expect(rules.editor.selection).toEqual(selected);
    expect(renderToStaticMarkup(<StrategyEditorProvider bootstrap={filterBootstrap} initialView="rules"><RulesView structural={structural} /></StrategyEditorProvider>)).toContain("Only keep assets");
    expect(flowNodeIdForSelection(projectFlowCanvas(flow).nodes, selected)).toBe(flowNode.id);
    expect(projectBuilderStructure(flow).children[0].children[0].children.find((item) => item.label === "Qualification")?.selection.componentId).toBe(selected.componentId);
  });

  it("takes backend-returned Canonical through Blocky, Rules, Guide, Summary, and Code", async () => {
    const changed = structuredClone(filterBootstrap.strategy);
    changed.graph.components.find((item) => item.id === "positive_return")!.config.threshold = "0.05";
    changed.graph.components.find((item) => item.id === "momentum")!.config.lookback_bars = 63;
    changed.graph.components.find((item) => item.id === "top_n")!.config.count = 1;
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ strategy: changed }), { status: 200 }));
    const returned = await authoringApi.apply(filterBootstrap.strategy, { kind: "update_qualification_threshold", component_id: "positive_return", threshold: "0.05" }, fetcher);
    const state = editorReducer(createEditorState(filterBootstrap, "flow"), { type: "replace_canonical_dirty", canonical: returned });
    const logic = projectLogicRepresentation(state.canonical, filterBootstrap.registry);
    expect(logic.groups[0].steps.find((step) => step.kind === "condition")?.value).toBe(5);
    expect(logic.groups[0].steps.find((step) => step.kind === "score")?.value).toBe(63);
    expect(logic.groups[0].steps.find((step) => step.kind === "choose")?.value).toBe(1);
    expect(projectConceptualFlow(state.canonical, filterBootstrap.registry).groups[0].choose?.threshold).toBe("0.05");
    const bootstrap = { ...filterBootstrap, strategy: state.canonical };
    const rules = renderToStaticMarkup(<StrategyEditorProvider bootstrap={bootstrap} initialView="rules"><RulesView structural={structural} /></StrategyEditorProvider>);
    expect(rules).toContain("Return lookback observations");
    expect(rules).toContain("Qualification threshold percent");
    expect(renderToStaticMarkup(<StrategyEditorProvider bootstrap={bootstrap} initialView="guided"><GuidedView /></StrategyEditorProvider>)).toContain("63 trading observations");
    expect(renderToStaticMarkup(<StrategyEditorProvider bootstrap={bootstrap}><OverviewView onTest={() => undefined} /></StrategyEditorProvider>)).toContain("strongest");
    expect(renderToStaticMarkup(<StrategyEditorProvider bootstrap={bootstrap} initialView="code"><CodeView /></StrategyEditorProvider>)).toContain("0.05");
    expect(state.validation.status).toBe("dirty");
  });

  it("rejects unsupported AI targets and preserves the working copy on backend rejection", async () => {
    expect(() => parseChangeProposal(JSON.stringify({ format: "ruletrade.change-proposal/v0", operations: [{ kind: "update_qualification_threshold", component_id: "wrong", threshold: "0.05" }] }), cap)).toThrow(/unavailable/);
    const proposal = parseChangeProposal(JSON.stringify({ format: "ruletrade.change-proposal/v0", operations: [{ kind: "update_qualification_threshold", component_id: "positive_return", threshold: "0.05" }] }), cap);
    const before = createEditorState(filterBootstrap, "flow");
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: { code: "result_invalid", message: "Invalid" } }), { status: 422 }));
    await expect(authoringApi.apply(before.canonical, proposal.operations[0], fetcher)).rejects.toThrow();
    expect(before.canonical).toBe(filterBootstrap.strategy);
    expect(before.validation.status).toBe("valid");
    const selected = semanticSelection("rule", "positive_return", { fieldPath: "config.threshold" });
    expect(aiContext(before.canonical, filterBootstrap.registry, cap, selected, "revision-1").selected?.component?.id).toBe("positive_return");
    expect(describeChange(before.canonical, before.canonical, proposal.operations[0])).toHaveLength(1);
  });

  it("keeps Blockly toolbox and field intents gated by exact backend targets", () => {
    const logic = projectLogicRepresentation(filterBootstrap.strategy, filterBootstrap.registry);
    const condition = logic.groups[0].steps.find((step) => step.kind === "condition")!;
    expect(qualificationDropOperation("unrelated", cap)).toBeNull();
    expect(qualificationDropOperation("momentum_rank", { ...cap, qualification_add_targets: [] })).toBeNull();
    expect(qualificationDropOperation("momentum_rank", cap)).toEqual({ kind: "add_qualification_condition", rank_component_id: "momentum_rank" });
    expect(blockFieldOperation(condition, 5, cap)).toEqual({ kind: "update_qualification_threshold", component_id: "positive_return", threshold: "0.05" });
    expect(blockFieldOperation(condition, 5, { ...cap, qualification_threshold_targets: [] })).toBeNull();
    expect(blockFieldOperation(condition, Number.NaN, cap)).toBeNull();
  });

  it("degrades explicitly instead of inventing a decision order", () => {
    const invalid = structuredClone(momentumBootstrap.strategy);
    invalid.graph.connections = invalid.graph.connections.filter((item) => item.target.component_id !== "momentum_rank");
    expect(projectLogicRepresentation(invalid, momentumBootstrap.registry).unsupportedReason).toBeTruthy();
  });
});
