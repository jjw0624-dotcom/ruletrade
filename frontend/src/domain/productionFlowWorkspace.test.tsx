import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StrategyBuilderWorkspace } from "../components/StrategyBuilderWorkspace";
import { projectConceptualFlow } from "./conceptualFlow";
import { projectProductionFlowCanvas, productionFlowNodeManifest } from "../views/FlowView";
import { semanticSelection } from "./semanticSelection";
import { StrategyEditorProvider } from "../store/editorStore";
import { momentumBootstrap, sleevesBootstrap } from "../test/fixture";
import type { EditorBootstrap } from "./canonical";
import type { StructuralAuthoringCapabilities } from "../structuralAuthoringApi";
import type { StructuralAuthoringController } from "../hooks/useStructuralAuthoring";

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
  options: { selection?: ReturnType<typeof semanticSelection>; addPanel?: boolean } = {},
) {
  const authoring = structural(capabilities);
  const projection = projectConceptualFlow(bootstrap.strategy, bootstrap.registry);
  return renderToStaticMarkup(
    <StrategyEditorProvider
      bootstrap={bootstrap}
      initialView="flow"
      initialSelection={options.selection ?? null}
      initialLeftPanelTab={options.addPanel ? "blocks" : "structure"}
    >
      <StrategyBuilderWorkspace
        name={bootstrap.strategy.metadata.name}
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
  it("passes only minimal capital nodes to ReactFlow and retains Selection detail in the Inspector", () => {
    const projection = projectConceptualFlow(sleevesBootstrap.strategy, sleevesBootstrap.registry);
    const graph = projectProductionFlowCanvas(projection);
    const manifest = productionFlowNodeManifest(graph.nodes);
    expect(manifest.split(";")).toEqual([
      expect.stringMatching(/^portfolio\|portfolio\|Growth 70 \/ Defensive 30 Portfolio$/),
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
    expect(markup).toContain("data-flow-node-manifest=");
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
    };
    const markup = mountedWorkspace(momentumBootstrap, capabilities, { addPanel: true });
    expect(markup).toContain('data-flow-toolbox="true"');
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
    expect(markup).not.toContain("shape-transformation");
  });
});
