import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { QualificationAuthoringControl } from "../components/StructuralAuthoringControls";
import type { EditorBootstrap } from "./canonical";
import { structuralAuthoringApi, type StructuralAuthoringCapabilities } from "../structuralAuthoringApi";
import { createEditorState, editorReducer, StrategyEditorProvider, type EditorView } from "../store/editorStore";
import { filterBootstrap, momentumBootstrap, sleevesBootstrap } from "../test/fixture";
import { GuidedView } from "../views/GuidedView";
import { OverviewView } from "../views/OverviewView";
import { FlowView, shapeTransformationTargets } from "../views/FlowView";
import { projectConceptualFlow } from "./conceptualFlow";
import { projectGuided } from "./guided";
import { semanticSelection } from "./semanticSelection";

const capabilities: StructuralAuthoringCapabilities = {
  groups: [],
  qualification_add_targets: ["momentum_rank"],
  qualification_remove_targets: [],
  fallback_remove_targets: [],
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
    expect(flow.groups[0].choose?.condition).toBe("6M return > 0%");
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
});
