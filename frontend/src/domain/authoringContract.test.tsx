import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AssetMembershipEditor, ScheduleControl } from "../components/AuthoringControls";
import type { StructuralAuthoringController } from "../hooks/useStructuralAuthoring";
import {
  structuralAuthoringApi,
  type StructuralAuthoringCapabilities,
  type StructuralAuthoringOperation,
} from "../structuralAuthoringApi";
import { createEditorState, editorReducer } from "../store/editorStore";
import { filterBootstrap } from "../test/fixture";
import { authoringResponse } from "../test/authoringResponse";
import { projectConceptualFlow } from "./conceptualFlow";
import { projectGuided } from "./guided";
import { semanticSelection } from "./semanticSelection";

const emptyCapabilities: StructuralAuthoringCapabilities = {
  groups: [], qualification_add_targets: [], qualification_remove_targets: [],
  add_group: false, remove_group: false, rename_group: false,
  add_qualification_condition: false, remove_qualification_condition: false,
  multiple_qualification_conditions: false, choose_pipeline_targets: [],
  fallback_add_targets: [], fallback_remove_targets: [], cooldown_add_targets: [], cooldown_remove_targets: [], growth_defensive_targets: [],
  create_choose_pipeline: false, add_fallback_selection: false,
  remove_fallback_selection: false, transform_to_growth_defensive: false,
  asset_set_targets: [], lookback_targets: [], qualification_threshold_targets: [],
  selection_count_targets: [], selection_resample_targets: [], sleeve_allocation_targets: [],
  schedule_targets: [], cooldown_duration_targets: [], fallback_asset_set_targets: [],
};

function controller(capabilities: StructuralAuthoringCapabilities): StructuralAuthoringController {
  return { capabilities, status: "ready", error: null, apply: vi.fn() };
}

describe("backend-authoritative typed authoring", () => {
  it.each<StructuralAuthoringOperation>([
    { kind: "update_asset_set", asset_set_id: "universe", assets: ["QQQ", "IEF"] },
    { kind: "update_lookback", component_id: "momentum", lookback_bars: 63 },
    { kind: "update_qualification_threshold", component_id: "positive_return", threshold: "0.03" },
    { kind: "update_selection_count", component_id: "top_n", count: 1 },
    { kind: "update_sleeve_allocations", allocations: [{ component_id: "growth", allocation: "0.6" }, { component_id: "safe", allocation: "0.4" }] },
    { kind: "update_schedule", component_id: "monthly", cadence: "daily", day: null },
    { kind: "update_cooldown_duration", component_id: "cooldown", duration: 30 },
  ])("sends $kind as explicit intent without changing the source", async (operation) => {
    const source = filterBootstrap.strategy;
    const fetcher = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ strategy: source }), { status: 200 },
    ));
    await structuralAuthoringApi.apply(source, operation, fetcher);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ strategy: source, operation });
    expect(source).toBe(filterBootstrap.strategy);
  });

  it("shows typed controls only for backend capability targets", () => {
    const hidden = renderToStaticMarkup(<AssetMembershipEditor authoring={controller(emptyCapabilities)} assetSetId="universe" assets={["QQQ"]} />);
    expect(hidden).toBe("");
    const capabilities = {
      ...emptyCapabilities,
      asset_set_targets: [{ asset_set_id: "universe", assets: ["QQQ"] }],
      schedule_targets: [{ component_id: "monthly", cadence: "monthly" as const, day: 1, choices: [{ cadence: "daily" as const, requires_day: false, default_day: null }, { cadence: "monthly" as const, requires_day: true, default_day: 1 }] }],
    };
    expect(renderToStaticMarkup(<AssetMembershipEditor authoring={controller(capabilities)} assetSetId="universe" assets={["QQQ"]} />)).toContain("Add asset");
    expect(renderToStaticMarkup(<ScheduleControl authoring={controller(capabilities)} label="When?" componentId="monthly" />)).toContain("Daily");
  });

  it("replaces Canonical only with the returned document and preserves selection", () => {
    const initial = createEditorState(filterBootstrap, "guided");
    initial.editor.selection = semanticSelection("selection", "top_n", { groupId: "strategy" });
    const returned = authoringResponse(initial.canonical, "top_n", { count: 1 });
    const edited = editorReducer(initial, { type: "replace_canonical_dirty", canonical: returned });
    expect(edited.validation.status).toBe("dirty");
    expect(edited.editor.selection).toEqual(initial.editor.selection);
    expect(projectGuided(edited.canonical, edited.registry).kind).toBe("momentum");
    expect(projectConceptualFlow(edited.canonical, edited.registry).groups[0].choose?.topN).toBe(1);
  });

  it("leaves Canonical and dirty state untouched when no validated response is dispatched", () => {
    const initial = createEditorState(filterBootstrap);
    expect(initial.canonical).toBe(filterBootstrap.strategy);
    expect(initial.validation.status).toBe("valid");
  });
});
