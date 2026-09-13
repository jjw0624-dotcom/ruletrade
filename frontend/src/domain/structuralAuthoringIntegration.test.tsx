import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { QualificationAuthoringControl } from "../components/StructuralAuthoringControls";
import type { EditorBootstrap } from "./canonical";
import { structuralAuthoringApi, type StructuralAuthoringCapabilities } from "../structuralAuthoringApi";
import { createEditorState, editorReducer, StrategyEditorProvider, type EditorView } from "../store/editorStore";
import { filterBootstrap, momentumBootstrap, sleevesBootstrap } from "../test/fixture";
import { GuidedView } from "../views/GuidedView";
import { OverviewView } from "../views/OverviewView";
import { projectConceptualFlow } from "./conceptualFlow";
import { projectGuided } from "./guided";

const capabilities: StructuralAuthoringCapabilities = {
  groups: [],
  qualification_add_targets: ["momentum_rank"],
  qualification_remove_targets: [],
  add_group: false,
  remove_group: false,
  rename_group: false,
  add_qualification_condition: true,
  remove_qualification_condition: false,
  multiple_qualification_conditions: false,
  create_choose_pipeline: false,
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
    initial.editor.selectedNodeId = "growth_sleeve";
    initial.editor.selectedConceptId = "group:growth_sleeve";
    const changed = editorReducer(initial, {
      type: "replace_canonical_dirty",
      canonical: renamedSleeves(),
      selectedNodeId: "growth_sleeve",
      selectedConceptId: "group:growth_sleeve",
    });
    expect(changed.canonical.graph.components.find((item) => item.id === "growth_sleeve")?.config.name)
      .toBe("Opportunity");
    expect(projectConceptualFlow(changed.canonical, changed.registry).groups[0].label)
      .toBe("Opportunity");
    expect(changed.editor).toMatchObject({
      selectedNodeId: "growth_sleeve",
      selectedConceptId: "group:growth_sleeve",
    });
    expect(changed.validation.status).toBe("dirty");
  });

  it("Flow rename updates Canonical and the Guide and Summary projections", () => {
    const initial = stateFor(sleevesBootstrap, "flow");
    const changed = editorReducer(initial, {
      type: "replace_canonical_dirty",
      canonical: renamedSleeves(),
      selectedNodeId: "growth_sleeve",
      selectedConceptId: "group:growth_sleeve",
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
      selectedNodeId: "positive_return",
      selectedConceptId: "choose",
    });
    const guide = projectGuided(added.canonical, added.registry);
    const flow = projectConceptualFlow(added.canonical, added.registry);
    expect(guide.kind === "momentum" && guide.momentum.threshold).toBe("0");
    expect(flow.groups[0].choose?.condition).toBe("6M return > 0%");
    expect(added.editor).toMatchObject({
      selectedNodeId: "positive_return",
      selectedConceptId: "choose",
    });
  });

  it("removing qualification uses the backend result and preserves the Choose context", () => {
    const initial = stateFor(filterBootstrap, "flow");
    initial.editor.selectedNodeId = "positive_return";
    initial.editor.selectedFieldPath = "config.threshold";
    initial.editor.selectedConceptId = "choose";
    const removed = editorReducer(initial, {
      type: "replace_canonical_dirty",
      canonical: momentumBootstrap.strategy,
      selectedNodeId: "momentum_rank",
      selectedConceptId: "choose",
    });
    expect(projectGuided(removed.canonical, removed.registry).kind).toBe("momentum");
    expect(projectConceptualFlow(removed.canonical, removed.registry).groups[0].choose?.condition)
      .toBeUndefined();
    expect(removed.editor).toMatchObject({
      selectedNodeId: "momentum_rank",
      selectedConceptId: "choose",
      selectedFieldPath: null,
    });
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
