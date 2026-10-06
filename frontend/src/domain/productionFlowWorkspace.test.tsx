import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StrategyBuilderWorkspace } from "../components/StrategyBuilderWorkspace";
import { workspaceFromPersistedStrategy } from "../App";
import { projectConceptualFlow } from "./conceptualFlow";
import { projectProductionFlowCanvas, productionFlowGeometry, productionFlowNodeManifest } from "../views/FlowView";
import { semanticSelection } from "./semanticSelection";
import { StrategyEditorProvider } from "../store/editorStore";
import { fallbackBootstrap, momentumBootstrap, sleevesBootstrap } from "../test/fixture";
import type { EditorBootstrap } from "./canonical";
import type { StructuralAuthoringCapabilities } from "../structuralAuthoringApi";
import type { StructuralAuthoringController } from "../hooks/useStructuralAuthoring";
import type { StrategyDetail } from "../strategyApi";

const baseCapabilities: StructuralAuthoringCapabilities = {
  groups: [],
  qualification_add_targets: [],
  qualification_remove_targets: ["positive_return"],
  fallback_remove_targets: ["fallback"],
  cooldown_add_targets: [],
  cooldown_remove_targets: [],
  add_group: false,
  remove_group: false,
  rename_group: false,
  add_qualification_condition: false,
  remove_qualification_condition: true,
  multiple_qualification_conditions: false,
  choose_pipeline_targets: [],
  fallback_add_targets: [],
  growth_defensive_targets: [],
  create_choose_pipeline: false,
  add_fallback_selection: false,
  remove_fallback_selection: true,
  transform_to_growth_defensive: false,
  asset_set_targets: [],
  lookback_targets: [],
  qualification_threshold_targets: [],
  selection_count_targets: [{ component_id: "top_n", value: 2, minimum: 1, maximum: 20 }],
  selection_resample_targets: [],
  sleeve_allocation_targets: [],
  schedule_targets: [],
  cooldown_duration_targets: [],
  fallback_asset_set_targets: [],
};

function persistedApiDetail(bootstrap: EditorBootstrap): StrategyDetail {
  return {
    strategy: {
      id: "strategy-growth-defensive",
      name: bootstrap.strategy.metadata.name,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      current_revision_id: "revision-growth-defensive",
      archived_at: null,
    },
    current_revision: {
      id: "revision-growth-defensive",
      strategy_id: "strategy-growth-defensive",
      parent_revision_id: null,
      canonical_strategy: bootstrap.strategy,
      source_hash: "backend-owned-fixture",
      schema_version: "ruletrade.dev/strategy/v1",
      created_at: "2026-01-01T00:00:00Z",
    },
  };
}

function structural(capabilities: StructuralAuthoringCapabilities): StructuralAuthoringController {
  return {
    capabilities,
    status: "ready",
    error: null,
    apply: vi.fn(async () => true),
    compose: vi.fn(async () => false),
  };
}

function mountedWorkspace(
  bootstrap: EditorBootstrap,
  capabilities: StructuralAuthoringCapabilities,
  options: { selection?: ReturnType<typeof semanticSelection>; addPanel?: boolean; view?: "overview" | "flow" } = {},
) {
  const authoring = structural(capabilities);
  // Follow the same persisted API detail + registry bootstrap construction used by App.
  const runtimeWorkspace = workspaceFromPersistedStrategy(persistedApiDetail(bootstrap), bootstrap);
  const runtimeBootstrap = runtimeWorkspace.bootstrap;
  const projection = projectConceptualFlow(runtimeBootstrap.strategy, runtimeBootstrap.registry);
  return renderToStaticMarkup(
    <StrategyEditorProvider
      bootstrap={runtimeBootstrap}
      initialView={options.view ?? "flow"}
      initialSelection={options.selection ?? null}
      initialLeftPanelTab={options.addPanel ? "blocks" : "structure"}
    >
      <StrategyBuilderWorkspace
        name={runtimeBootstrap.strategy.metadata.name}
        dirty={false}
        saving={false}
        persisted
        projection={projection}
        structural={authoring}
        onHome={() => undefined}
        onRename={() => undefined}
        onSave={() => undefined}
        onTest={() => undefined}
      />
    </StrategyEditorProvider>,
  );
}

describe("mounted production Flow workspace", () => {
  it("hydrates persisted Canonical and first mounts xyflow only through the visible Flow transition", () => {
    const runtimeWorkspace = workspaceFromPersistedStrategy(persistedApiDetail(sleevesBootstrap), sleevesBootstrap);
    expect(runtimeWorkspace.bootstrap.strategy.graph.components.length).toBeGreaterThan(0);

    const graph = projectProductionFlowCanvas(projectConceptualFlow(
      runtimeWorkspace.bootstrap.strategy,
      runtimeWorkspace.bootstrap.registry,
    ));
    const manifest = productionFlowNodeManifest(graph.nodes);
    const geometry = productionFlowGeometry(graph.nodes, graph.edges);
    expect(geometry).toMatchObject({ nodeCount: 9, edgeCount: 10, finitePositions: true });
    expect(manifest).not.toBe("");
    expect(graph.edges.filter((item) => item.source === "split").map((item) => item.label)).toEqual(["70%", "30%"]);

    // Persisted workspaces start in overview. ReactFlow must not initialize in that hidden layer.
    const initiallyOverview = mountedWorkspace(sleevesBootstrap, baseCapabilities, { view: "overview" });
    expect(initiallyOverview).not.toContain("data-flow-runtime-contract");
    expect(initiallyOverview).not.toContain("data-flow-reactflow-boundary");

    // Selecting Flow mounts the real production boundary with the exact supplied manifest.
    const activated = mountedWorkspace(sleevesBootstrap, baseCapabilities, { view: "flow" });
    expect(activated).toContain('data-flow-canvas-mounted="true"');
    expect(activated).toContain('data-flow-projected-node-count="9"');
    expect(activated).toContain('data-flow-supplied-node-count="9"');
    expect(activated).toContain("data-flow-reactflow-boundary");
    expect(activated).toContain('data-flow-reactflow-node-manifest="' + manifest + '"');
    for (const required of ["Portfolio", "Split", "Growth", "Defensive"]) expect(manifest).toContain(required);
    for (const forbidden of ["Selection universe", "Eligibility", "Ranking", "Asset universe", "Equal allocation", "Portfolio target"]) {
      expect(manifest).not.toContain(forbidden);
    }
  });

  it("supplies a finite, non-empty persisted Momentum/Fallback graph to the real ReactFlow boundary", () => {
    const runtimeWorkspace = workspaceFromPersistedStrategy(persistedApiDetail(fallbackBootstrap), fallbackBootstrap);
    expect(runtimeWorkspace.bootstrap.strategy.graph.components.length).toBe(9);
    const graph = projectProductionFlowCanvas(projectConceptualFlow(
      runtimeWorkspace.bootstrap.strategy,
      runtimeWorkspace.bootstrap.registry,
    ));
    const geometry = productionFlowGeometry(graph.nodes, graph.edges);
    const manifest = productionFlowNodeManifest(graph.nodes);
    expect(geometry).toMatchObject({ nodeCount: 6, edgeCount: 6, finitePositions: true });
    expect(geometry.ids).toEqual(expect.arrayContaining([
      "portfolio", "selected-target:investment", "fallback:investment", "action:portfolio",
    ]));
    expect(geometry.kinds).toEqual(expect.arrayContaining(["portfolio", "group", "selection", "exposure", "fallback", "action"]));

    const activated = mountedWorkspace(fallbackBootstrap, baseCapabilities, { view: "flow" });
    expect(activated).toContain('data-flow-projection-manifest="' + manifest + '"');
    expect(activated).toContain('data-flow-node-manifest="' + manifest + '"');
    expect(activated).toContain('data-flow-reactflow-node-manifest="' + manifest + '"');
    expect(activated).toContain('data-flow-projected-node-count="6"');
    expect(activated).toContain('data-flow-supplied-node-count="6"');
    for (const required of ["Choose 2 assets", "Selected assets", "TLT", "Rebalance"]) expect(manifest).toContain(required);
    for (const forbidden of ["Selection universe", "Eligibility", "Ranking", "Asset universe", "Equal allocation", "Portfolio target"]) {
      expect(manifest).not.toContain(forbidden);
    }
  });

  it("passes only minimal capital nodes to ReactFlow and retains Selection detail in the Inspector", () => {
    const projection = projectConceptualFlow(sleevesBootstrap.strategy, sleevesBootstrap.registry);
    const graph = projectProductionFlowCanvas(projection);
    const manifest = productionFlowNodeManifest(graph.nodes);
    expect(manifest.split(";")).toEqual([
      "portfolio|portfolio|Portfolio",
      "split|allocation|Split",
      "group:growth_sleeve|group|Growth",
      expect.stringMatching(/^selection:growth_sleeve\|selection\|Choose 2 assets/),
      "selected-target:growth_sleeve|exposure|Selected assets",
      "fallback:growth_sleeve|fallback|TLT",
      "group:defensive_sleeve|group|Defensive",
      "asset-target:defensive_sleeve|exposure|Asset basket",
      "action:portfolio|action|Rebalance",
    ]);
    for (const forbidden of ["Selection universe", "Eligibility", "Asset universe", "Portfolio target", "Equal allocation"]) {
      expect(manifest).not.toContain(forbidden);
    }
    expect(manifest).not.toContain("|universe|");
    expect(manifest).not.toContain("|eligibility|");
    expect(manifest).not.toContain("|target|");

    const markup = mountedWorkspace(sleevesBootstrap, baseCapabilities, {
      selection: semanticSelection("selection", "top_n", { groupId: "growth_sleeve" }),
    });
    expect(markup).toContain('data-workspace-runtime-contract="capital-flow-minimal-v2"');
    expect(markup).toContain('data-flow-runtime-contract="minimal-capital-v2"');
    expect(markup).toContain(`data-flow-projection-manifest="${manifest}"`);
    expect(markup).toContain(`data-flow-node-manifest="${manifest}"`);
    expect(markup).toContain("Growth");
    expect(markup).toContain("Defensive");
    expect(markup).toContain("70%");
    expect(markup).toContain("30%");
    expect(markup).toContain(">FROM<");
    expect(markup).toContain(">WHERE<");
    expect(markup).toContain(">ORDER BY<");
    expect(markup).toContain(">TAKE<");
    expect(markup).toContain("WHEN FEWER QUALIFY");
    expect(markup).toContain("SELECTION FALLBACK");
    expect(markup).toContain("TLT");
  });

  it("mounts the real compact, bounded Flow Add library with a supported Split gesture", () => {
    const capabilities: StructuralAuthoringCapabilities = {
      ...baseCapabilities,
      growth_defensive_targets: ["weights"],
      transform_to_growth_defensive: true,
      composition: {
        primitives: ["asset_set@1", "equal_weight@1", "portfolio_sleeve@1", "portfolio@1"].map((primitive) => ({
          primitive, category: "transform", create_supported: true, reason: null,
        })),
        mutation_kinds: ["create_component", "create_asset_set", "connect", "disconnect"],
        incomplete_working_states: false,
      },
    };
    const markup = mountedWorkspace(momentumBootstrap, capabilities, { addPanel: true });
    expect(markup).toContain('data-flow-toolbox="true"');
    expect(markup).toContain('data-flow-toolbox-contract="compact-capital-v1"');
    expect(markup).toContain('data-flow-toolbox-mode="Capital"');
    expect(markup).toContain('aria-label="Flow categories"');
    for (const category of ["Capital", "Destination", "Routing", "Allocation", "Timing", "Behavior"]) {
      expect(markup).toContain(`>${category}<`);
    }
    expect(markup).toContain('data-scroll-container="bounded"');
    expect(markup).toContain('data-toolbox-concept="split"');
    expect(markup).toContain('draggable="true"');
    expect(markup).not.toContain("Executable primitive; standalone insertion");
    expect(markup).not.toContain("Needs a compatible Strategy location");
    expect(markup).not.toContain("<article");
  });
});
