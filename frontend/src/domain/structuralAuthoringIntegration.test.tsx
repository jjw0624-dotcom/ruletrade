import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { QualificationAuthoringControl } from "../components/StructuralAuthoringControls";
import type { EditorBootstrap } from "./canonical";
import { structuralAuthoringApi, type StructuralAuthoringCapabilities, type StructuralAuthoringOperation } from "../structuralAuthoringApi";
import { createEditorState, editorReducer, StrategyEditorProvider, type EditorView } from "../store/editorStore";
import { filterBootstrap, momentumBootstrap, sleevesBootstrap } from "../test/fixture";
import { GuidedView } from "../views/GuidedView";
import { OverviewView } from "../views/OverviewView";
import { FlowView, createFlowDraftNode, isCommitReadyFlowConnection, shapeTransformationTargets } from "../views/FlowView";
import { projectConceptualFlow } from "./conceptualFlow";
import { projectGuided } from "./guided";
import { semanticSelection, type SemanticSelection } from "./semanticSelection";
import { isLatestAuthoringRequest, type StructuralAuthoringController } from "../hooks/useStructuralAuthoring";
import { conditionAutoApplyOperation } from "../components/SemanticInspector";
import { constructionOptions, semanticToolboxEntries } from "./builderProjection";
import { FlowCapitalToolbox } from "../components/WorkspaceLeftPanel";
import { dispatchSplitConstruction } from "./constructionDispatch";

const capabilities: StructuralAuthoringCapabilities = {
  groups: [],
  qualification_add_targets: ["momentum_rank"],
  qualification_remove_targets: [],
  fallback_remove_targets: [],
  cooldown_add_targets: [], cooldown_remove_targets: [],
  add_group: false,
  remove_group: false,
  rename_group: false,
  add_qualification_condition: true,
  remove_qualification_condition: false,
  remove_fallback_selection: false,
  multiple_qualification_conditions: false,
  choose_pipeline_targets: [],
  fallback_add_targets: [],
  growth_defensive_targets: [],
  create_choose_pipeline: false,
  add_fallback_selection: false,
  transform_to_growth_defensive: false,
  asset_set_targets: [], lookback_targets: [], qualification_threshold_targets: [],
  selection_count_targets: [], selection_resample_targets: [],
  sleeve_allocation_targets: [], schedule_targets: [], cooldown_duration_targets: [],
  fallback_asset_set_targets: [],
};

function stateFor(
  bootstrap: EditorBootstrap,
  view: EditorView,
) {
  return createEditorState(bootstrap, view);
}

function renamedSleeves() {
  const renamed = structuredClone(sleevesBootstrap.strategy);
  renamed.graph.components.find((item) => item.id === "growth_sleeve")!.config.name = "Opportunity";
  return renamed;
}

describe("Structural Authoring Guide and Flow integration", () => {
  it("sends exact capability and apply requests and accepts backend-returned Canonical", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(capabilities), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ strategy: filterBootstrap.strategy }), { status: 200 }));
    await structuralAuthoringApi.capabilities(momentumBootstrap.strategy, fetcher);
    const returned = await structuralAuthoringApi.apply(momentumBootstrap.strategy, {
      kind: "add_qualification_condition",
      rank_component_id: "momentum_rank",
    }, fetcher);
    expect(fetcher.mock.calls[0][0]).toBe("/api/v1/canonical/strategies/authoring/capabilities");
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify(momentumBootstrap.strategy),
    });
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      strategy: momentumBootstrap.strategy,
      operation: {
        kind: "add_qualification_condition",
        rank_component_id: "momentum_rank",
      },
    });
    expect(returned).toEqual(filterBootstrap.strategy);
  });

  it("sends exact backend-owned valid-shape transformation requests", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ strategy: momentumBootstrap.strategy }), { status: 200 }),
    );
    await structuralAuthoringApi.apply(sleevesBootstrap.strategy, {
      kind: "transform_to_choose_assets",
      weight_component_id: "weights",
      lookback_observations: 63,
      count: 1,
    }, fetcher);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      strategy: sleevesBootstrap.strategy,
      operation: {
        kind: "transform_to_choose_assets",
        weight_component_id: "weights",
        lookback_observations: 63,
        count: 1,
      },
    });
  });

  it("sends typed edits through the same backend authoring boundary", async () => {
    const returned = structuredClone(filterBootstrap.strategy);
    returned.graph.components.find((item) => item.id === "monthly")!.primitive = "daily@1";
    returned.graph.components.find((item) => item.id === "monthly")!.config = {};
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ strategy: returned }), { status: 200 }),
    );
    const result = await structuralAuthoringApi.apply(filterBootstrap.strategy, {
      kind: "update_schedule",
      component_id: "monthly",
      cadence: "daily",
      day: null,
    }, fetcher);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      strategy: filterBootstrap.strategy,
      operation: { kind: "update_schedule", component_id: "monthly", cadence: "daily", day: null },
    });
    expect(result).toEqual(returned);
    expect(filterBootstrap.strategy.graph.components.find((item) => item.id === "monthly")?.primitive)
      .toBe("monthly@1");
  });

  it("sends Predicate creation through the backend Authoring Contract", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ strategy: filterBootstrap.strategy }), { status: 200 }),
    );
    await structuralAuthoringApi.apply(filterBootstrap.strategy, {
      kind: "add_predicate", rebalance_component_id: "rebalance", asset: "SPY",
      lookback_bars: 126, operator: "gt", threshold: "0",
    }, fetcher);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).operation).toEqual({
      kind: "add_predicate", rebalance_component_id: "rebalance", asset: "SPY",
      lookback_bars: 126, operator: "gt", threshold: "0",
    });
  });

  it("exposes transformations only from backend capability targets", () => {
    expect(shapeTransformationTargets(capabilities)).toEqual({
      choose: undefined,
      fallback: undefined,
      growthDefensive: undefined,
    });
    expect(shapeTransformationTargets({
      ...capabilities,
      choose_pipeline_targets: ["weights"],
      fallback_add_targets: ["weights"],
      growth_defensive_targets: ["fallback"],
    })).toEqual({ choose: "weights", fallback: "weights", growthDefensive: "fallback" });
  });

  it("renders Flow through xyflow while Canonical remains the projection source", () => {
    const markup = renderToStaticMarkup(
      <StrategyEditorProvider bootstrap={sleevesBootstrap} initialView="flow">
        <FlowView />
      </StrategyEditorProvider>,
    );
    expect(markup).toContain("react-flow");
    expect(markup).toContain("Growth");
    expect(markup).toContain("Defensive");
    expect(markup).toContain("70%");
    expect(markup).toContain("30%");
    expect(markup).toContain("Rebalance");
    expect(markup).not.toContain("Selection universe");
    expect(markup).not.toContain(">Eligibility<");
    expect(markup).not.toContain("Asset universe");
    expect(markup).not.toContain("Portfolio target");
  });


  it("projects generated portfolio identities from connections rather than starter IDs", () => {
    const bootstrap = structuredClone(sleevesBootstrap);
    const renames = new Map([
      ["growth_sleeve", "generated_growth"],
      ["defensive_sleeve", "generated_defensive"],
      ["defensive_assets", "generated_defensive_assets"],
    ]);
    for (const component of bootstrap.strategy.graph.components) {
      component.id = renames.get(component.id) ?? component.id;
    }
    for (const connection of bootstrap.strategy.graph.connections) {
      connection.source.component_id = renames.get(connection.source.component_id) ?? connection.source.component_id;
      connection.target.component_id = renames.get(connection.target.component_id) ?? connection.target.component_id;
    }
    for (const entrypoint of bootstrap.strategy.entrypoints) {
      entrypoint.target_component_id = renames.get(entrypoint.target_component_id) ?? entrypoint.target_component_id;
    }

    const guided = projectGuided(bootstrap.strategy, bootstrap.registry);
    expect(guided.kind).toBe("portfolio");
    if (guided.kind !== "portfolio") return;
    expect(guided.growth.sleeveComponentId).toBe("generated_growth");
    expect(guided.defensive.sleeveComponentId).toBe("generated_defensive");
    expect(guided.defensive.assets).toEqual(["TLT", "IEF"]);
    const flow = projectConceptualFlow(bootstrap.strategy, bootstrap.registry);
    expect(flow.groups.map((group) => group.id)).toEqual(["generated_growth", "generated_defensive"]);
  });

  it("follows target capabilities instead of independently recognizing a Choose shape", () => {
    const props = {
      rankComponentId: "momentum_rank",
      lookbackBars: 126,
      capabilities: { ...capabilities, qualification_add_targets: [] },
      busy: false,
      onAdd: async () => true,
      onRemove: async () => true,
    };
    expect(renderToStaticMarkup(<QualificationAuthoringControl {...props} />))
      .not.toContain("Add condition");
    expect(renderToStaticMarkup(
      <QualificationAuthoringControl
        {...props}
        capabilities={{ ...capabilities, qualification_add_targets: ["momentum_rank"] }}
      />,
    )).toContain("Add condition");
  });

  it("omits unsupported structural controls", () => {
    const markup = renderToStaticMarkup(
      <StrategyEditorProvider bootstrap={momentumBootstrap} initialView="guided">
        <GuidedView />
      </StrategyEditorProvider>,
    );
    expect(markup).not.toMatch(/Add group|Remove group|Create Choose|\+ Add condition/);
  });

  it("keeps high-level shape recipes in Guide rather than the Composer toolbox", () => {
    const guideStructural: StructuralAuthoringController = {
      capabilities: { ...capabilities, growth_defensive_targets: ["weights"], transform_to_growth_defensive: true },
      status: "ready", error: null, apply: async () => true, compose: async () => true,
    };
    const markup = renderToStaticMarkup(<StrategyEditorProvider bootstrap={momentumBootstrap} initialView="guided"><GuidedView structural={guideStructural} /></StrategyEditorProvider>);
    expect(markup).toContain("Guided recipes");
    expect(markup).toContain("Add Split");
  });

  it("Guide rename updates Canonical and the Flow projection with stable identity", () => {
    const initial = stateFor(sleevesBootstrap, "guided");
    initial.editor.selection = semanticSelection("group", "growth_sleeve", { groupId: "growth_sleeve" });
    const changed = editorReducer(initial, {
      type: "replace_canonical_dirty",
      canonical: renamedSleeves(),
      selection: initial.editor.selection,
    });
    expect(changed.canonical.graph.components.find((item) => item.id === "growth_sleeve")?.config.name)
      .toBe("Opportunity");
    expect(projectConceptualFlow(changed.canonical, changed.registry).groups[0].label)
      .toBe("Opportunity");
    expect(changed.editor.selection).toMatchObject({ componentId: "growth_sleeve", groupId: "growth_sleeve" });
    expect(changed.validation.status).toBe("dirty");
  });

  it("Flow rename updates Canonical and the Guide and Summary projections", () => {
    const initial = stateFor(sleevesBootstrap, "flow");
    const changed = editorReducer(initial, {
      type: "replace_canonical_dirty",
      canonical: renamedSleeves(),
      selection: semanticSelection("group", "growth_sleeve", { groupId: "growth_sleeve" }),
    });
    const guide = projectGuided(changed.canonical, changed.registry);
    expect(guide.kind === "portfolio" && guide.growth.sleeveName).toBe("Opportunity");
    expect(renderToStaticMarkup(
      <StrategyEditorProvider bootstrap={{ ...sleevesBootstrap, strategy: changed.canonical }}>
        <OverviewView onTest={() => undefined} />
      </StrategyEditorProvider>,
    )).toContain("Opportunity when conditions");
  });

  it("adding qualification uses the backend result for both projections and focuses it", () => {
    const initial = stateFor(momentumBootstrap, "guided");
    const added = editorReducer(initial, {
      type: "replace_canonical_dirty",
      canonical: filterBootstrap.strategy,
      selection: semanticSelection("qualification", "positive_return", { fieldPath: "config.threshold", groupId: "weights" }),
    });
    const guide = projectGuided(added.canonical, added.registry);
    const flow = projectConceptualFlow(added.canonical, added.registry);
    expect(guide.kind === "momentum" && guide.momentum.threshold).toBe("0");
    expect(flow.groups[0].choose?.condition).toBe("Candidate\'s 126-observation return > 0%");
    expect(added.editor.selection).toMatchObject({ componentId: "positive_return", fieldPath: "config.threshold" });
  });

  it("removing qualification uses the backend result and preserves the Choose context", () => {
    const initial = stateFor(filterBootstrap, "flow");
    initial.editor.selection = semanticSelection("qualification", "positive_return", { fieldPath: "config.threshold", groupId: "weights" });
    const removed = editorReducer(initial, {
      type: "replace_canonical_dirty",
      canonical: momentumBootstrap.strategy,
      selection: semanticSelection("selection", "momentum_rank", { groupId: "weights" }),
    });
    expect(projectGuided(removed.canonical, removed.registry).kind).toBe("momentum");
    expect(projectConceptualFlow(removed.canonical, removed.registry).groups[0].choose?.condition)
      .toBeUndefined();
    expect(removed.editor.selection).toMatchObject({ componentId: "momentum_rank", fieldPath: null });
  });

  it("a rejected operation leaves the authoritative Canonical unchanged", () => {
    const initial = stateFor(filterBootstrap, "flow");
    const failed = editorReducer(initial, {
      type: "validation_finished",
      valid: false,
      issues: [{ path: "graph", message: "This condition is required." }],
    });
    expect(failed.canonical).toBe(initial.canonical);
  });
  it("auto-applies complete conditions through the backend boundary and ignores stale responses", async () => {
    const condition = {
      kind: "comparison", operator: "gt",
      left: { kind: "indicator", indicator_id: "trailing_return_indicator@1", asset: { kind: "literal", value_type: "asset", value: "SPY" }, parameters: { lookback_bars: 63 } },
      right: { kind: "literal", value_type: "percentage", value: 0 },
    } as const;
    const operation = conditionAutoApplyOperation("risk_on", "predicate", condition);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ strategy: filterBootstrap.strategy }), { status: 200 }));
    await structuralAuthoringApi.apply(filterBootstrap.strategy, operation, fetcher);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).operation).toEqual(operation);
    expect(isLatestAuthoringRequest(1, 2)).toBe(false);
    expect(isLatestAuthoringRequest(2, 2)).toBe(true);
  });

  it("preserves committed Canonical when automatic semantic authoring is rejected", async () => {
    const canonical = structuredClone(filterBootstrap.strategy);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      detail: { code: "result_invalid", message: "Invalid condition", path: "graph.components" },
    }), { status: 422, headers: { "content-type": "application/json" } }));
    await expect(structuralAuthoringApi.apply(canonical, {
      kind: "update_condition_expression", component_id: "positive_return", role: "eligibility",
      condition: { kind: "comparison", operator: "gt", left: { kind: "literal", value_type: "decimal", value: 1 }, right: { kind: "literal", value_type: "decimal", value: 0 } },
    }, fetcher)).rejects.toThrow("Invalid condition");
    expect(canonical).toEqual(filterBootstrap.strategy);
  });


  it("connects the advertised Flow Split action to atomic backend authoring and parallel reprojection", async () => {
    const splitCapabilities = {
      ...capabilities,
      growth_defensive_targets: ["weights"],
      transform_to_growth_defensive: true,
      composition: {
        primitives: ["asset_set@1", "equal_weight@1", "portfolio_sleeve@1", "portfolio@1"].map((primitive) => ({ primitive, category: "transform", create_supported: true, reason: null })),
        mutation_kinds: ["create_component", "create_asset_set", "connect", "disconnect"],
        incomplete_working_states: false as const,
      },
    };
    const sourceProjection = projectConceptualFlow(momentumBootstrap.strategy, momentumBootstrap.registry);
    const option = constructionOptions(sourceProjection, splitCapabilities, null)
      .find((item) => item.kind === "split");
    expect(option).toBeDefined();

    const toolbox = renderToStaticMarkup(
      <StrategyEditorProvider bootstrap={momentumBootstrap} initialView="flow">
        <FlowCapitalToolbox entries={semanticToolboxEntries(sourceProjection, momentumBootstrap.registry, splitCapabilities, null, "flow")} structural={{
          capabilities: splitCapabilities, status: "ready", error: null, apply: async () => true, compose: async () => true,
        }} />
      </StrategyEditorProvider>,
    );
    expect(toolbox).toContain("flow-capital-toolbox");
    expect(toolbox).toContain("flow-toolbox-library");
    expect(toolbox).toContain("Capital");
    expect(toolbox).toContain("Destination");
    expect(toolbox).toContain("Routing");
    expect(toolbox).toContain("Allocation");
    expect(toolbox).not.toContain("shape-transformation");

    const draftNode = createFlowDraftNode(option!, { x: 320, y: 180 });
    expect(draftNode).toMatchObject({ type: "semantic", deletable: true, data: { semanticKind: "allocation" } });
    expect(isCommitReadyFlowConnection(option!, "portfolio", "allocation")).toBe(true);

    let editor = createEditorState(momentumBootstrap, "flow");
    editor = editorReducer(editor, { type: "begin_flow_draft", intent: {
      kind: option!.kind, targetComponentId: option!.targetComponentId, targetLabel: option!.targetLabel, groupId: option!.groupId,
    } });
    expect(editor.editor.flowDraft.status).toBe("incomplete");
    expect(editor.canonical).toBe(momentumBootstrap.strategy);
    editor = editorReducer(editor, { type: "set_flow_draft_connection", connection: {
      sourceId: "portfolio:root", targetId: draftNode.id, sourceKind: "portfolio", targetKind: "allocation", compatible: true,
    }, status: "commit_ready", message: "Ready to create Split." });
    expect(editor.editor.flowDraft.status).toBe("commit_ready");
    const backendCanonical = structuredClone(sleevesBootstrap.strategy);
    for (const component of backendCanonical.graph.components) {
      if (component.primitive === "portfolio_sleeve@1") component.config.allocation = "0.5";
    }
    const apply = vi.fn(async (operation: StructuralAuthoringOperation, selection?: SemanticSelection | null) => {
      editor = editorReducer(editor, {
        type: "replace_canonical_dirty",
        canonical: backendCanonical,
        selection,
      });
      return true;
    });
    const structural: StructuralAuthoringController = {
      capabilities: splitCapabilities,
      status: "ready",
      error: null,
      apply,
      compose: async () => false,
    };

    expect(await dispatchSplitConstruction(option!, structural)).toBe(true);
    editor = editorReducer(editor, { type: "clear_flow_draft" });
    expect(apply).toHaveBeenCalledWith({
      kind: "transform_to_growth_defensive",
      target_component_id: "weights",
      growth_allocation: "0.5",
      defensive_assets: ["IEF"],
    }, semanticSelection("split", "weights_portfolio"));

    const projected = projectConceptualFlow(editor.canonical, editor.registry);
    expect(projected.groups).toHaveLength(2);
    expect(projected.groups.map((group) => group.allocation)).toEqual(["50%", "50%"]);
    expect(projected.groups.map((group) => group.sleeveComponentId)).toEqual(
      expect.arrayContaining(["growth_sleeve", "defensive_sleeve"]),
    );
    expect(editor.validation.status).toBe("dirty");
    expect(editor.editor.flowDraft.status).toBe("clean");
  });

});
