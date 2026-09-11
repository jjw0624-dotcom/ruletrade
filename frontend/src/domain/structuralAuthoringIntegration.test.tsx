import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { structuralAuthoringApi } from "../structuralAuthoringApi";
import { projectConceptualFlow } from "./conceptualFlow";
import { projectGuided } from "./guided";
import { editorReducer, StrategyEditorProvider } from "../store/editorStore";
import { filterBootstrap, momentumBootstrap, sleevesBootstrap } from "../test/fixture";
import { GuidedView } from "../views/GuidedView";
import { OverviewView } from "../views/OverviewView";

const capabilities = {
  groups: [], qualification_add_targets: ["momentum_rank"],
  qualification_remove_targets: [], add_group: false, remove_group: false,
  rename_group: false, add_qualification_condition: true,
  remove_qualification_condition: false,
  multiple_qualification_conditions: false, create_choose_pipeline: false,
} as const;

describe("Structural Authoring Guide and Flow integration", () => {
  it("sends exact capability and apply requests", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(capabilities), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ strategy: filterBootstrap.strategy }), { status: 200 }));
    await structuralAuthoringApi.capabilities(momentumBootstrap.strategy, fetcher);
    await structuralAuthoringApi.apply(momentumBootstrap.strategy, {
      kind: "add_qualification_condition", rank_component_id: "momentum_rank",
    }, fetcher);
    expect(fetcher.mock.calls[0][0]).toBe("/api/v1/canonical/strategies/authoring/capabilities");
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: "POST", body: JSON.stringify(momentumBootstrap.strategy),
    });
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      strategy: momentumBootstrap.strategy,
      operation: { kind: "add_qualification_condition", rank_component_id: "momentum_rank" },
    });
  });

  it("omits unsupported controls until the backend lists a target", () => {
    const markup = renderToStaticMarkup(
      <StrategyEditorProvider bootstrap={momentumBootstrap} initialView="guided">
        <GuidedView />
      </StrategyEditorProvider>,
    );
    expect(markup).not.toMatch(/Add group|Remove group|Create Choose|\+ Add condition/);
  });

  it("backend-returned Canonical synchronizes Guide and Flow and becomes dirty", () => {
    const initial = {
      canonical: momentumBootstrap.strategy, registry: momentumBootstrap.registry,
      editor: { activeView: "guided" as const, nodePositions: {}, viewport: {x:0,y:0,zoom:1},
        selectedNodeId: "momentum_rank", selectedFieldPath: null,
        selectedConceptId: "choose", openGroupId: null },
      validation: { status: "valid" as const, issues: [] },
    };
    const added = editorReducer(initial, {
      type: "replace_canonical_dirty", canonical: filterBootstrap.strategy,
      selectedNodeId: "positive_return", selectedConceptId: "choose",
    });
    const guide = projectGuided(added.canonical, added.registry);
    const flow = projectConceptualFlow(added.canonical, added.registry);
    expect(guide.kind === "momentum" && guide.momentum.threshold).toBe("0");
    expect(flow.groups[0].choose?.condition).toBe("6M return > 0%");
    expect(added.validation.status).toBe("dirty");
    expect(added.editor).toMatchObject({
      selectedNodeId: "positive_return", selectedConceptId: "choose",
    });
  });

  it("group rename reaches Summary, Guide, and Flow with stable identity", () => {
    const renamed = structuredClone(sleevesBootstrap.strategy);
    renamed.graph.components.find((item) => item.id === "growth_sleeve")!.config.name = "Opportunity";
    const initial = {
      canonical: sleevesBootstrap.strategy, registry: sleevesBootstrap.registry,
      editor: { activeView: "guided" as const, nodePositions: {}, viewport: {x:0,y:0,zoom:1},
        selectedNodeId: "growth_sleeve", selectedFieldPath: null,
        selectedConceptId: "group:growth_sleeve", openGroupId: null },
      validation: { status: "valid" as const, issues: [] },
    };
    const state = editorReducer(initial, { type: "replace_canonical_dirty", canonical: renamed });
    const guide = projectGuided(state.canonical, state.registry);
    const flow = projectConceptualFlow(state.canonical, state.registry);
    expect(state.editor.selectedNodeId).toBe("growth_sleeve");
    expect(guide.kind === "portfolio" && guide.growth.sleeveName).toBe("Opportunity");
    expect(flow.groups[0].label).toBe("Opportunity");
    expect(renderToStaticMarkup(
      <StrategyEditorProvider bootstrap={{...sleevesBootstrap, strategy: renamed}}>
        <OverviewView onTest={() => undefined} />
      </StrategyEditorProvider>,
    )).toContain("Opportunity when conditions");
  });

  it("removal preserves Choose selection and failed edits preserve Canonical", () => {
    const initial = {
      canonical: filterBootstrap.strategy, registry: filterBootstrap.registry,
      editor: { activeView: "flow" as const, nodePositions: {}, viewport: {x:0,y:0,zoom:1},
        selectedNodeId: "positive_return", selectedFieldPath: "config.threshold",
        selectedConceptId: "choose", openGroupId: "strategy" },
      validation: { status: "valid" as const, issues: [] },
    };
    const removed = editorReducer(initial, {
      type: "replace_canonical_dirty", canonical: momentumBootstrap.strategy,
      selectedNodeId: "momentum_rank", selectedConceptId: "choose",
    });
    expect(projectConceptualFlow(removed.canonical, removed.registry).groups[0].choose?.condition)
      .toBeUndefined();
    expect(removed.editor).toMatchObject({
      selectedNodeId: "momentum_rank", selectedConceptId: "choose",
    });
    const failed = editorReducer(initial, {
      type: "validation_finished", valid: false,
      issues: [{ path: "graph", message: "This condition is required." }],
    });
    expect(failed.canonical).toBe(initial.canonical);
  });
});
