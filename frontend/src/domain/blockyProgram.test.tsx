import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BlockyProgramToolbox } from "../components/WorkspaceLeftPanel";
import type { StructuralAuthoringController } from "../hooks/useStructuralAuthoring";
import * as Blockly from "blockly";
import { semanticCompositionApi, type SemanticCompositionProjection, type SemanticFact, type SemanticProjectionRef } from "../semanticCompositionApi";
import { StrategyEditorProvider, createEditorState, editorReducer } from "../store/editorStore";
import type { StructuralAuthoringCapabilities } from "../structuralAuthoringApi";
import { filterBootstrap, momentumBootstrap } from "../test/fixture";
import { projectConceptualFlow } from "./conceptualFlow";
import { projectBlockyProgram, programStatementForSelection } from "./blockyProgram";
import { blockyProgramToolboxEntries } from "./blockyToolbox";
import { hasUnresolvedLogicDraft, logicDraftMessage } from "./logicDraft";
import { semanticSelection } from "./semanticSelection";
import { blockyClickIntent } from "../views/BlockyView";

const ref = (primary: string, role: SemanticProjectionRef["semantic_role"], related: string[] = [], field: string | null = null): SemanticProjectionRef => ({
  primary_component_id: primary,
  related_component_ids: related,
  semantic_role: role,
  field_path: field,
  definition_id: null,
});
const fact = (id: string, category: SemanticFact["category"], kind: string, label: string, reference: SemanticProjectionRef, detail: Record<string, unknown> = {}): SemanticFact => ({ id, category, kind, label, ref: reference, detail });

function selectionProjection(): SemanticCompositionProjection {
  const facts = [
    fact("timing:monthly", "timing", "monthly", "Monthly", ref("monthly", "timing")),
    fact("selection:top_n", "selection", "ranked_selection", "Choose 2 strongest", ref("top_n", "selection", ["assets", "momentum", "positive_return", "rank"], "config.count"), { count: 2 }),
    fact("universe:assets", "universe", "asset_set", "QQQ, VGT", ref("assets", "universe"), { assets: ["QQQ", "VGT"] }),
    fact("measure:momentum", "measure", "trailing_return", "126-bar trailing return", ref("momentum", "measure", [], "config.lookback_bars"), { lookback_bars: 126 }),
    fact("eligibility:positive_return", "eligibility", "candidate_score_threshold", "Candidate trailing return · 126 completed observations > 0", ref("positive_return", "eligibility", [], "condition"), { threshold: "0" }),
    fact("selection-fallback:fallback", "selection", "selection_fallback", "Selection fallback to TLT", ref("fallback", "selection"), { assets: ["TLT"] }),
    fact("constraint:cooldown", "constraint", "cooldown", "Cooldown 10 trading days", ref("cooldown", "constraint", [], "config.duration"), { duration: 10 }),
    fact("allocation:weights", "allocation", "equal_weight", "Equal weight", ref("weights", "allocation")),
    fact("action:rebalance", "action", "rebalance", "Rebalance portfolio", ref("rebalance", "action")),
  ];
  return {
    facts,
    logic: {
      contexts: [{ id: "context:portfolio", kind: "portfolio", label: "Portfolio", ref: ref("portfolio", "portfolio"), fact_ids: [], script_ids: ["script:monthly"] }],
      scripts: [{
        id: "script:monthly", context_id: "context:portfolio",
        trigger: { timing_fact_id: "timing:monthly", ref: ref("monthly", "timing") },
        statements: [
          { id: "statement:selection", family: "selection", kind: "ranked_selection", label: "Choose 2 strongest", ref: ref("top_n", "selection", ["assets", "momentum", "positive_return", "rank"], "config.count"), fact_ids: ["selection:top_n", "universe:assets", "measure:momentum", "eligibility:positive_return"], modifier_fact_ids: ["selection-fallback:fallback", "constraint:cooldown"], then_statement_ids: [], else_statement_ids: [] },
          { id: "statement:allocation", family: "portfolio_operation", kind: "compound_allocation", label: "Allocate capital", ref: ref("weights", "allocation"), fact_ids: ["allocation:weights"], modifier_fact_ids: [], then_statement_ids: [], else_statement_ids: [] },
          { id: "statement:action", family: "action", kind: "rebalance", label: "Rebalance portfolio", ref: ref("rebalance", "action"), fact_ids: ["action:rebalance"], modifier_fact_ids: [], then_statement_ids: [], else_statement_ids: [] },
        ],
        execution_order_semantic: true,
      }],
      placements: [],
    },
  };
}

const capabilities: StructuralAuthoringCapabilities = {
  composition: { primitives: [], mutation_kinds: ["create_component", "connect", "disconnect"], incomplete_working_states: false },
  groups: [], qualification_add_targets: [], qualification_remove_targets: [], cooldown_add_targets: [], cooldown_remove_targets: [], add_group: false, remove_group: false, rename_group: false,
  add_qualification_condition: false, remove_qualification_condition: false, multiple_qualification_conditions: false,
  choose_pipeline_targets: [], fallback_add_targets: [], fallback_remove_targets: [], growth_defensive_targets: [], create_choose_pipeline: false,
  add_fallback_selection: false, remove_fallback_selection: false, transform_to_growth_defensive: false,
  asset_set_targets: [], lookback_targets: [], qualification_threshold_targets: [], selection_count_targets: [], selection_resample_targets: [], sleeve_allocation_targets: [], schedule_targets: [], cooldown_duration_targets: [], fallback_asset_set_targets: [],
};
const structural: StructuralAuthoringController = { capabilities, status: "ready", error: null, apply: async () => true, compose: async () => true };

describe("production Blocky program boundary", () => {
  it("projects Context → Script → Trigger and aggregates ranked selection provenance", () => {
    const program = projectBlockyProgram(selectionProjection());
    expect(program.contexts).toHaveLength(1);
    expect(program.contexts[0].scripts).toHaveLength(1);
    expect(program.contexts[0].scripts[0].triggerLabel).toBe("Monthly");
    const selection = program.contexts[0].scripts[0].statements[0];
    expect(selection.kind).toBe("selection");
    expect(selection.ref.related_component_ids).toEqual(["assets", "momentum", "positive_return", "rank"]);
    expect(selection.modifiers.map((item) => item.kind)).toEqual(["eligibility", "fallback", "constraint"]);
    expect(selection.label).toBe("Choose 2 assets");
    expect(selection.modifiers.find((item) => item.kind === "eligibility")?.label).toBe("trailing return · 126 completed observations > 0");
    expect(selection.modifiers.find((item) => item.kind === "fallback")?.label).toBe("fallback → TLT");
    expect(selection.modifiers.find((item) => item.kind === "constraint")?.value).toBe(10);
    expect(programStatementForSelection(program, semanticSelection("qualification", "positive_return"))).toBe(selection);
  });

  it("keeps independent schedules as separate Scripts instead of inferring XY order", () => {
    const projection = selectionProjection();
    projection.facts.push(fact("timing:daily", "timing", "daily", "Daily", ref("daily", "timing")));
    projection.logic.contexts[0].script_ids.push("script:daily");
    projection.logic.scripts.push({ ...projection.logic.scripts[0], id: "script:daily", trigger: { timing_fact_id: "timing:daily", ref: ref("daily", "timing") } });
    const scripts = projectBlockyProgram(projection).contexts[0].scripts;
    expect(scripts.map((item) => item.triggerLabel)).toEqual(["Monthly", "Daily"]);
  });

  it("nests supported committed Predicate actions without confusing Eligibility or fallback with ELSE", () => {
    const projection = selectionProjection();
    projection.facts.push(fact("predicate:risk_on", "predicate", "control_predicate", "Market is risk-on", ref("risk_on", "predicate", [], "condition")));
    projection.logic.scripts[0].statements.push({ id: "statement:predicate", family: "control", kind: "if", label: "Market is risk-on", ref: ref("risk_on", "predicate", [], "condition"), fact_ids: ["predicate:risk_on"], modifier_fact_ids: [], then_statement_ids: ["statement:action"], else_statement_ids: [] });
    const statements = projectBlockyProgram(projection).contexts[0].scripts[0].statements;
    const control = statements.find((item) => item.kind === "control")!;
    expect(control.thenStatements.map((item) => item.id)).toEqual(["statement:action"]);
    expect(statements.filter((item) => item.id === "statement:action")).toHaveLength(0);
    expect(statements.find((item) => item.kind === "selection")?.modifiers.find((item) => item.kind === "eligibility")).toBeTruthy();
    expect(control.elseStatements).toEqual([]);
  });

  it("does not fabricate IF for a simple investment program", () => {
    const projection = selectionProjection();
    projection.logic.scripts[0].statements = projection.logic.scripts[0].statements.filter((item) => item.family !== "selection");
    const statements = projectBlockyProgram(projection).contexts[0].scripts[0].statements;
    expect(statements.map((item) => item.kind)).toEqual(["allocation", "action"]);
    expect(statements.some((item) => item.kind === "control")).toBe(false);
  });

  it("calls the headless semantic projection endpoint with Canonical, not Blockly state", async () => {
    const projection = selectionProjection();
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(projection), { status: 200 }));
    expect(await semanticCompositionApi.project(momentumBootstrap.strategy, fetcher)).toEqual(projection);
    expect(fetcher).toHaveBeenCalledWith("/api/v1/canonical/strategies/semantic-projections", expect.objectContaining({ method: "POST", body: JSON.stringify(momentumBootstrap.strategy) }));
  });

  it("renders a compact category toolbox without Flow Split, recipes, or primitive boilerplate", () => {
    const entries = blockyProgramToolboxEntries(projectConceptualFlow(filterBootstrap.strategy, filterBootstrap.registry), capabilities, null);
    const markup = renderToStaticMarkup(<StrategyEditorProvider bootstrap={filterBootstrap} initialView="blocky"><BlockyProgramToolbox entries={entries} structural={structural} /></StrategyEditorProvider>);
    expect(entries.map((item) => item.category)).toEqual(expect.arrayContaining(["Control", "Selection", "Action", "Timing", "Behavior"]));
    expect(markup).toContain('data-program-toolbox="true"');
    expect(markup).toContain('aria-label="Block categories"');
    expect(markup).toContain('aria-label="Control blocks"');
    expect(markup).toContain("If / Otherwise");
    expect(markup).toContain('draggable="true"');
    expect(markup).not.toContain("Add If");
    expect(markup).not.toContain("Add Split");
    expect(markup).not.toContain("Growth + Defensive");
    expect(markup).not.toContain(">Metric<");
    expect(markup).not.toContain(">Rank<");
  });

  it("adds IF and IF / Otherwise only as incomplete LogicDraft controls", () => {
    const entries = blockyProgramToolboxEntries(
      projectConceptualFlow(filterBootstrap.strategy, filterBootstrap.registry),
      { ...capabilities, predicate_add_targets: ["rebalance"], predicate_remove_targets: [] },
      null,
    );
    const executable = entries.find((item) => item.id === "if")!;
    const twoBranch = entries.find((item) => item.id === "if-otherwise")!;
    expect(executable).toMatchObject({ status: "draftable", draftKind: "if" });
    expect(executable.predicateTarget).toBeUndefined();
    expect(twoBranch).toMatchObject({ status: "draftable", draftKind: "if_otherwise" });
    const markup = renderToStaticMarkup(
      <StrategyEditorProvider bootstrap={filterBootstrap} initialView="blocky">
        <BlockyProgramToolbox entries={entries} structural={structural} />
      </StrategyEditorProvider>,
    );
    expect(markup).toContain("Create an incomplete Control draft, then set its Predicate and branch topology.");
    expect(markup).toContain("Create an incomplete two-branch Control draft; no Predicate is invented.");
  });

  it("opens Inspector only for native Blockly clicks, not selection or drag events", () => {
    expect(blockyClickIntent({ type: Blockly.Events.CLICK, targetType: Blockly.Events.ClickTarget.BLOCK, blockId: "selection" })).toEqual({ kind: "select", blockId: "selection" });
    expect(blockyClickIntent({ type: Blockly.Events.CLICK, targetType: Blockly.Events.ClickTarget.WORKSPACE })).toEqual({ kind: "clear" });
    expect(blockyClickIntent({ type: Blockly.Events.SELECTED, blockId: "selection" })).toBeNull();
    expect(blockyClickIntent({ type: Blockly.Events.BLOCK_DRAG, blockId: "selection" })).toBeNull();
  });

  it("keeps LogicDraft ephemeral across representation switches and blocks commands until discard", () => {
    const initial = createEditorState(filterBootstrap, "blocky");
    const drafted = editorReducer(initial, { type: "request_logic_control", kind: "if", position: { x: 120, y: 80 } });
    expect(hasUnresolvedLogicDraft(drafted.editor.logicDraft)).toBe(true);
    expect(drafted.editor.logicDraft.pendingControls[0]).toMatchObject({ kind: "if", position: { x: 120, y: 80 } });
    expect(drafted.editor.logicDraft.selectedDraftId).toBe(drafted.editor.logicDraft.pendingControls[0].draftId);
    expect(logicDraftMessage(drafted.editor.logicDraft)).toContain("before saving or testing");
    expect(drafted.canonical).toBe(initial.canonical);
    const rules = editorReducer(drafted, { type: "set_active_view", view: "rules" });
    expect(rules.editor.logicDraft).toEqual(drafted.editor.logicDraft);
    expect(rules.canonical).toBe(initial.canonical);
    const discarded = editorReducer(rules, { type: "restore_logic_program" });
    expect(hasUnresolvedLogicDraft(discarded.editor.logicDraft)).toBe(false);
    expect(discarded.canonical).toBe(initial.canonical);
  });
});
