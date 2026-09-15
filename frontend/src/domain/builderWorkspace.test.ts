import { describe, expect, it } from "vitest";
import { constructionOptions, projectBuilderStructure, semanticDeleteOperation } from "./builderProjection";
import { projectConceptualFlow } from "./conceptualFlow";
import { sameSemanticSelection, semanticSelection } from "./semanticSelection";
import { createEditorState, editorReducer } from "../store/editorStore";
import type { StructuralAuthoringCapabilities } from "../structuralAuthoringApi";
import { filterBootstrap, momentumBootstrap, sleevesBootstrap } from "../test/fixture";
import { projectFlowCanvas } from "../views/FlowView";

const none: StructuralAuthoringCapabilities = {
  groups: [], qualification_add_targets: [], qualification_remove_targets: [],
  choose_pipeline_targets: [], fallback_add_targets: [], fallback_remove_targets: [],
  growth_defensive_targets: [], add_group: false, remove_group: false,
  rename_group: false, add_qualification_condition: false,
  remove_qualification_condition: false, multiple_qualification_conditions: false,
  create_choose_pipeline: false, add_fallback_selection: false,
  remove_fallback_selection: false, transform_to_growth_defensive: false,
};

describe("shared Strategy Builder workspace boundaries", () => {
  it("uses one semantic selection across representation switches without dirtying Canonical", () => {
    const initial = createEditorState(filterBootstrap, "flow");
    const selected = editorReducer(initial, { type: "select_semantic", selection: semanticSelection("qualification", "positive_return", { fieldPath: "config.threshold", groupId: "growth_sleeve" }) });
    const guide = editorReducer(selected, { type: "set_active_view", view: "guided" });
    expect(guide.canonical).toBe(initial.canonical);
    expect(guide.validation.status).toBe("valid");
    expect(guide.editor.selection).toEqual(selected.editor.selection);
  });

  it("projects Structure and Flow from the same component identities", () => {
    const projection = projectConceptualFlow(filterBootstrap.strategy, filterBootstrap.registry);
    const structure = projectBuilderStructure(projection);
    const flow = projectFlowCanvas(projection);
    const qualification = structure.children[0].children[0].children.find((item) => item.label === "Qualification")!;
    const flowQualification = flow.nodes.find((item) => item.id.startsWith("qualification:"))!;
    expect(sameSemanticSelection(qualification.selection, flowQualification.data.selection)).toBe(true);
  });

  it("offers insertion only from backend capability targets", () => {
    const projection = projectConceptualFlow(momentumBootstrap.strategy, momentumBootstrap.registry);
    const selected = semanticSelection("selection", "top_n", { groupId: "strategy" });
    expect(constructionOptions(projection, none, selected)).toEqual([]);
    expect(constructionOptions(projection, { ...none, qualification_add_targets: ["momentum_rank"], add_qualification_condition: true }, selected).map((item) => item.kind)).toEqual(["qualification"]);
  });

  it("maps Delete only to supported semantic inverse operations", () => {
    expect(semanticDeleteOperation(semanticSelection("qualification", "positive_return"), { ...none, qualification_remove_targets: ["positive_return"], remove_qualification_condition: true })).toEqual({ kind: "remove_qualification_condition", condition_component_id: "positive_return" });
    expect(semanticDeleteOperation(semanticSelection("group", "growth_sleeve"), none)).toBeNull();
  });

  it("keeps visual movement and workspace panels out of Canonical dirty state", () => {
    const initial = createEditorState(sleevesBootstrap, "flow");
    const moved = editorReducer(initial, { type: "move_node", componentId: "visual", position: { x: 90, y: 50 } });
    const dashboard = editorReducer(moved, { type: "set_dashboard_open", open: true });
    expect(dashboard.canonical).toBe(initial.canonical);
    expect(dashboard.validation.status).toBe("valid");
  });

  it("preserves a surviving semantic selection after a backend-returned Canonical", () => {
    const initial = editorReducer(createEditorState(momentumBootstrap), { type: "select_semantic", selection: semanticSelection("selection", "top_n", { fieldPath: "config.count", groupId: "strategy" }) });
    const replaced = editorReducer(initial, { type: "replace_canonical_dirty", canonical: filterBootstrap.strategy });
    expect(replaced.editor.selection).toEqual(initial.editor.selection);
    expect(replaced.validation.status).toBe("dirty");
  });

  it("drops selection when a backend structural result removes its component", () => {
    const initial = editorReducer(createEditorState(filterBootstrap), { type: "select_semantic", selection: semanticSelection("qualification", "positive_return") });
    const replaced = editorReducer(initial, { type: "replace_canonical_dirty", canonical: momentumBootstrap.strategy });
    expect(replaced.editor.selection).toBeNull();
  });

  it("does not mutate working Canonical for unsupported insertion", () => {
    const initial = createEditorState(momentumBootstrap);
    constructionOptions(projectConceptualFlow(initial.canonical, initial.registry), none, semanticSelection("portfolio", null));
    expect(initial.canonical).toBe(momentumBootstrap.strategy);
    expect(initial.validation.status).toBe("valid");
  });
});
