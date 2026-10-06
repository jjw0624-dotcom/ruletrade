import { describe, expect, it } from "vitest";
import { workbenchResearchReducer, INITIAL_WORKBENCH_RESEARCH, researchTitle } from "./workbenchResearch";
import { assetMembershipAuthoringTargets, historicalRuleReferences } from "./assetWorkspaceAuthoring";
import { momentumBootstrap } from "../test/fixture";
import type { StructuralAuthoringCapabilities } from "../structuralAuthoringApi";

describe("Asset Workspace research destination", () => {
  it("opens inside the bounded Builder research surface", () => {
    const state = workbenchResearchReducer(INITIAL_WORKBENCH_RESEARCH, { type: "open_asset", symbol: "QQQ" });
    expect(state.researchOpen).toBe(true);
    expect(state.destination).toEqual({ kind: "asset", symbol: "QQQ", historical: undefined });
    expect(researchTitle(state.destination)).toBe("QQQ · Asset research");
  });
  it("preserves an immutable historical decision address", () => {
    const historical = { runId: "run", eventId: "event", revisionId: "revision", asOf: "2024-06-28" };
    const state = workbenchResearchReducer(INITIAL_WORKBENCH_RESEARCH, { type: "open_asset", symbol: "SPY", historical });
    expect(state.destination).toEqual({ kind: "asset", symbol: "SPY", historical });
  });

  it("derives membership editing only from backend-advertised asset-set targets", () => {
    const capabilities = {
      asset_set_targets: [{ asset_set_id: "universe", assets: ["QQQ", "VGT", "SOXX", "SCHG"] }],
    } as StructuralAuthoringCapabilities;
    expect(assetMembershipAuthoringTargets(momentumBootstrap.strategy, null)).toEqual([]);
    expect(assetMembershipAuthoringTargets(momentumBootstrap.strategy, capabilities)).toEqual([{
      assetSetId: "universe",
      semanticId: "universe",
      componentId: "universe_assets",
      kind: "asset_set",
      label: "universe",
      assets: ["QQQ", "VGT", "SOXX", "SCHG"],
    }]);
  });

  it("keeps exact historical Evidence provenance for View rule", () => {
    const evidence = [{
      details: [
        { source_components: [{ component_id: "eligibility", field_path: "condition" }] },
        { source_components: [{ component_id: "rank", field_path: "value_expression" }] },
        { source_components: [{ component_id: "eligibility", field_path: "condition" }] },
      ],
    }];
    expect(historicalRuleReferences(evidence)).toEqual([
      { componentId: "eligibility", fieldPath: "condition" },
      { componentId: "rank", fieldPath: "value_expression" },
    ]);
  });
});
