import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { structuralAuthoringApi } from "../structuralAuthoringApi";
import { projectConceptualFlow } from "./conceptualFlow";
import { projectGuided } from "./guided";
import { editorReducer, StrategyEditorProvider } from "../store/editorStore";
import { filterBootstrap, momentumBootstrap, sleevesBootstrap } from "../test/fixture";
import { GuidedView } from "../views/GuidedView";
import { OverviewView } from "../views/OverviewView";

const noGroups = {
  groups: [], qualification_add_targets: ["momentum_rank"],
  qualification_remove_targets: [], add_group: false, remove_group: false,
  rename_group: false, add_qualification_condition: true,
  remove_qualification_condition: false,
  multiple_qualification_conditions: false, create_choose_pipeline: false,
} as const;

afterEach(() => vi.restoreAllMocks());

describe("Structural Authoring Guide and Flow integration", () => {
  it("sends the exact capability and apply requests", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(noGroups), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ strategy: filterBootstrap.strategy }), { status: 200 }));
    await structuralAuthoringApi.capabilities(momentumBootstrap.strategy, fetcher);
    await structuralAuthoringApi.apply(momentumBootstrap.strategy, {
      kind: "add_qualification_condition", rank_component_id: "momentum_rank",
    }, fetcher);
    expect(fetcher.mock.calls[0]).toEqual([
      "/api/v1/canonical/strategies/authoring/capabilities",
      expect.objectContaining({ method: "POST", body: JSON.stringify(momentumBootstrap.strategy) }),
    ]);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      strategy: momentumBootstrap.strategy,
      operation: { kind: "add_qualification_condition", rank_component_id: "momentum_rank" },
    });
  });

  it("shows only capability-supported Guide controls and reprojects an added condition", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(noGroups), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ strategy: filterBootstrap.strategy }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...noGroups,
        qualification_add_targets: [],
        qualification_remove_targets: ["positive_return"],
        add_qualification_condition: false,
        remove_qualification_condition: true,
      }), { status: 200 }));
    render(<StrategyEditorProvider bootstrap={momentumBootstrap} initialView="guided"><GuidedView /></StrategyEditorProvider>);
    expect(await screen.findByRole("button", { name: "+ Add condition" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add group/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Add condition" }));
    await waitFor(() => expect(screen.getByDisplayValue("0")).toBeInTheDocument());
    expect(screen.getByText("6M return > 0%")).toBeInTheDocument();
  });

  it("renames a group through the backend and Summary sees the same Canonical", () => {
    const renamed = structuredClone(sleevesBootstrap.strategy);
    const group = renamed.graph.components.find((item) => item.id === "growth_sleeve")!;
    group.config.name = "Opportunity";
    const state = editorReducer(
      {
        canonical: sleevesBootstrap.strategy,
        registry: sleevesBootstrap.registry,
        editor: { activeView: "guided", nodePositions: {}, viewport: {x:0,y:0,zoom:1}, selectedNodeId: "growth_sleeve", selectedFieldPath: null, selectedConceptId: "group:growth_sleeve", openGroupId: null },
        validation: { status: "valid", issues: [] },
      },
      { type: "replace_canonical_dirty", canonical: renamed },
    );
    const guided = projectGuided(state.canonical, state.registry);
    const flow = projectConceptualFlow(state.canonical, state.registry);
    expect(state.validation.status).toBe("dirty");
    expect(state.editor.selectedNodeId).toBe("growth_sleeve");
    expect(guided.kind === "portfolio" && guided.growth.sleeveName).toBe("Opportunity");
    expect(flow.groups[0].label).toBe("Opportunity");
    const markup = render(<StrategyEditorProvider bootstrap={{...sleevesBootstrap,strategy:renamed}}><OverviewView onTest={() => undefined}/></StrategyEditorProvider>);
    expect(markup.getByText(/Opportunity when conditions/)).toBeInTheDocument();
  });

  it("removes a condition without partial state and clears a deleted component selection", () => {
    const state = {
      canonical: filterBootstrap.strategy,
      registry: filterBootstrap.registry,
      editor: { activeView: "flow" as const, nodePositions: {}, viewport: {x:0,y:0,zoom:1}, selectedNodeId: "positive_return", selectedFieldPath: "config.threshold", selectedConceptId: "choose", openGroupId: "strategy" },
      validation: { status: "valid" as const, issues: [] },
    };
    const removed = editorReducer(state, {
      type: "replace_canonical_dirty",
      canonical: momentumBootstrap.strategy,
      selectedNodeId: "momentum_rank",
      selectedConceptId: "choose",
    });
    expect(projectGuided(removed.canonical, removed.registry).kind).toBe("momentum");
    expect(projectConceptualFlow(removed.canonical, removed.registry).groups[0].choose?.condition).toBeUndefined();
    expect(removed.editor).toMatchObject({ selectedNodeId: "momentum_rank", selectedConceptId: "choose" });
    expect(removed.validation.status).toBe("dirty");
  });

  it("keeps Canonical unchanged when structural replacement never succeeds", () => {
    const state = {
      canonical: filterBootstrap.strategy,
      registry: filterBootstrap.registry,
      editor: { activeView: "guided" as const, nodePositions: {}, viewport: {x:0,y:0,zoom:1}, selectedNodeId: null, selectedFieldPath: null, selectedConceptId: null, openGroupId: null },
      validation: { status: "valid" as const, issues: [] },
    };
    const failed = editorReducer(state, {
      type: "validation_finished", valid: false,
      issues: [{ path: "graph", message: "This condition is required." }],
    });
    expect(failed.canonical).toBe(state.canonical);
  });
});
