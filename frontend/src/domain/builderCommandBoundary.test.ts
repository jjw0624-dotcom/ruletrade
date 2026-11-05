import { describe, expect, it } from "vitest";

import { planV2BuilderCommand } from "./builderCommandBoundary";
import type { CanonicalStrategyV2 } from "./canonicalV2";

const blank: CanonicalStrategyV2 = {
  api_version: "ruletrade.dev/strategy/v2",
  semantic_profile: "profile-a/daily-compositional-core@1",
  metadata: { name: "Command boundary", description: "", tags: [] },
  definitions: {
    asset_sets: [{ id: "initial-assets", assets: [] }],
    groups: [],
    asset_axis: { name: "asset", domain_id: "initial-assets", coordinate_policy: "member_identity" },
  },
  operator_lock: { compare: "1", "daily.trailing_return": "1" },
  selection: null,
  predicate: null,
  program: {
    semantic_id: "program",
    clocks: [{ id: "daily-close", timeframe: "daily", boundary: "close", timezone: "UTC", completed_only: true }],
    initial_state: {},
    formalizations: [],
    statements: [],
  },
};

describe("Builder command boundary", () => {
  it("returns one explicit atomic operation when the authoring context is complete", () => {
    expect(planV2BuilderCommand(
      blank,
      { kind: "setAssets", assets: ["QQQ"] },
      { assetSetId: "initial-assets", clockId: "daily-close" },
    )).toEqual({
      status: "ready",
      operation: { kind: "set_program_asset_set", asset_set_id: "initial-assets", assets: ["QQQ"] },
    });
  });

  it("classifies missing context instead of silently succeeding with no operation", () => {
    expect(planV2BuilderCommand(
      blank,
      { kind: "setAssets", assets: ["QQQ"] },
      { clockId: "daily-close" },
    )).toEqual({
      status: "incomplete",
      code: "missing_authoring_context",
      productMessage: "Choose the Group whose assets you want to edit.",
      technicalDetail: "No V2 authoring operation was produced for setAssets.",
    });
  });

  it("keeps Selection prerequisites in product language while retaining diagnostics", () => {
    const plan = planV2BuilderCommand(
      blank,
      { kind: "setFallback", asset: "TLT" },
      { clockId: "daily-close" },
    );
    expect(plan).toMatchObject({
      status: "incomplete",
      code: "missing_authoring_context",
      productMessage: "Create or choose a Selection before adding Fallback.",
    });
    expect(plan).toHaveProperty("technicalDetail", "No V2 authoring operation was produced for setFallback.");
  });
});
