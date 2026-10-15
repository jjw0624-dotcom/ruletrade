import { describe, expect, it } from "vitest";

import { compileFinancialIntent, createFinancialIntentDraft, financialIntentReadiness, normalizedIntentMeaning, updateFinancialIntentDraft } from "./intentAuthoring";
import type { CanonicalStrategyV2 } from "./canonicalV2";

describe("intent-first unified authoring", () => {
  it("converges asset-first and timing-first QQQ drafts to one operation", () => {
    let assetFirst = createFinancialIntentDraft("single_asset", "asset_first", "draft-a");
    assetFirst = updateFinancialIntentDraft(assetFirst, { asset: "QQQ" });
    assetFirst = updateFinancialIntentDraft(assetFirst, { timeframe: "monthly" });
    assetFirst = updateFinancialIntentDraft(assetFirst, { timingMeaning: "rebalance" });

    let timingFirst = createFinancialIntentDraft("single_asset", "timing_first", "draft-b");
    timingFirst = updateFinancialIntentDraft(timingFirst, { timingMeaning: "rebalance", timeframe: "monthly" });
    timingFirst = updateFinancialIntentDraft(timingFirst, { asset: "QQQ" });

    expect(financialIntentReadiness(assetFirst).status).toBe("ready");
    expect(compileFinancialIntent(assetFirst)).toEqual(compileFinancialIntent(timingFirst));
  });

  it("keeps monthly contribution distinct and unsupported", () => {
    const draft = updateFinancialIntentDraft(createFinancialIntentDraft("single_asset", "timing_first"), {
      asset: "QQQ", timeframe: "monthly", timingMeaning: "contribution",
    });
    expect(financialIntentReadiness(draft)).toMatchObject({ status: "unsupported" });
    expect(compileFinancialIntent(draft)).toBeNull();
  });

  it.each([
    ["market_regime_rotation", "logic_first", "commit_market_regime_rotation_intent"],
    ["split_portfolio", "flow_first", "commit_split_portfolio_intent"],
    ["weighted_score", "logic_first", "commit_weighted_score_intent"],
    ["temporal_sequence", "logic_first", "commit_temporal_sequence_intent"],
    ["multi_clock_policy", "timing_first", "commit_multi_clock_policy_intent"],
  ] as const)("compiles the complete %s recipe", (recipe, path, operationKind) => {
    const draft = createFinancialIntentDraft(recipe, path);
    expect(financialIntentReadiness(draft)).toMatchObject({ status: "ready", unresolved: [] });
    expect(compileFinancialIntent(draft)?.kind).toBe(operationKind);
  });

  it.each([
    ["market_regime_rotation", "asset_first"],
    ["split_portfolio", "allocation_first"],
    ["weighted_score", "asset_first"],
    ["temporal_sequence", "asset_first"],
    ["multi_clock_policy", "logic_first"],
  ] as const)("preserves unresolved meaning for the alternate %s %s path", (recipe, path) => {
    const draft = createFinancialIntentDraft(recipe, path);
    expect(financialIntentReadiness(draft).status).toBe("incomplete");
    expect(compileFinancialIntent(draft)).toBeNull();
  });

  it.each([
    ["market_regime_rotation", "logic_first", "asset_first"],
    ["split_portfolio", "flow_first", "allocation_first"],
    ["weighted_score", "logic_first", "asset_first"],
    ["temporal_sequence", "logic_first", "asset_first"],
    ["multi_clock_policy", "timing_first", "logic_first"],
  ] as const)("converges complete %s drafts from %s and %s", (recipe, completePath, alternatePath) => {
    const complete = createFinancialIntentDraft(recipe, completePath);
    const alternate = updateFinancialIntentDraft(
      createFinancialIntentDraft(recipe, alternatePath),
      complete.values,
    );
    expect(financialIntentReadiness(alternate).status).toBe("ready");
    expect(compileFinancialIntent(alternate)).toEqual(compileFinancialIntent(complete));
  });

  it("does not treat raw identity or metadata as normalized meaning", () => {
    const strategy = {
      api_version: "ruletrade.dev/strategy/v2", semantic_profile: "profile-a/daily-compositional-core@1",
      metadata: { name: "A", description: "", tags: [] }, operator_lock: {}, selection: null, predicate: null,
      definitions: { asset_sets: [{ id: "assets-a", assets: ["QQQ"] }], groups: [{ id: "group-a", name: "One", asset_set_ref: "assets-a", description: "" }], asset_axis: { name: "asset", domain_id: "group-a", coordinate_policy: "member_identity" } },
      program: { semantic_id: "program-a", clocks: [{ id: "clock-a", timeframe: "monthly", boundary: "close", timezone: "America/New_York", completed_only: true }], initial_state: {}, statements: [{ kind: "allocate", semantic_id: "allocation-a", method: "fixed", legs: [{ semantic_id: "leg-a", target: { semantic_id: "target-a", kind: "asset", ref: "QQQ" }, weight: 1 }], clock_id: "clock-a", minimum_weight: null, maximum_weight: null, cash_remainder_asset: null }] },
    } satisfies CanonicalStrategyV2;
    const renamed = structuredClone(strategy);
    renamed.metadata.name = "B";
    renamed.program.semantic_id = "program-b";
    renamed.program.statements[0]!.semantic_id = "allocation-b";
    expect(normalizedIntentMeaning(strategy)).toEqual(normalizedIntentMeaning(renamed));
  });
});
