import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { V2StrategyEditor } from "../components/V2StrategyEditor";
import type { CanonicalStrategyV2, DailyValueNode } from "./canonicalV2";
import { describeConditionV2, describeDailyValue } from "./v2Semantics";
import type { StrategyDetailV2 } from "../strategyApi";

const close: DailyValueNode = {
  semantic_id: "candidate-close", kind: "observe", operands: [],
  subject_kind: "candidate", binding_id: "candidate", subject_id: null,
  field: "close", basis: "adjusted", skip: 0,
  missing_policy: "require_all", minimum_count: 1, minimum_fraction: 1,
};

const candidateReturn: DailyValueNode = {
  semantic_id: "candidate-return", kind: "trailing_return", operands: [close],
  observations: 126, skip: 0, missing_policy: "require_all",
  minimum_count: 1, minimum_fraction: 1,
};

const strategy: CanonicalStrategyV2 = {
  api_version: "ruletrade.dev/strategy/v2",
  semantic_profile: "profile-a/daily-compositional-core@1",
  metadata: { name: "Profile A selection", description: "", tags: [] },
  definitions: {
    asset_sets: [{ id: "growth_assets", assets: ["QQQ", "VGT", "SOXX"] }],
    groups: [{ id: "growth", name: "Growth", asset_set_ref: "growth_assets", description: "" }],
    asset_axis: { name: "asset", domain_id: "growth", coordinate_policy: "member_identity" },
  },
  operator_lock: { compare: "1", "daily.trailing_return": "1" },
  selection: {
    semantic_id: "selection",
    universe_id: "growth",
    binding: { id: "candidate", domain_id: "growth" },
    eligibility: {
      kind: "all", semantic_id: "all", children: [{
        kind: "comparison", semantic_id: "positive", operator: "gt",
        left: candidateReturn,
        right: {
          semantic_id: "zero", kind: "literal", operands: [], quantity: "return",
          unit: "ratio", refinement: "trailing_return:adjusted_close", value: 0,
          skip: 0, missing_policy: "require_all", minimum_count: 1, minimum_fraction: 1,
        },
      }],
    },
    ranking: candidateReturn,
    direction: "descending",
    count: 2,
    shortage_policy: "require_full",
    fallback_asset: "TLT",
  },
  predicate: null,
};

const detail: StrategyDetailV2 = {
  strategy: {
    id: "strategy-v2", name: "Profile A selection",
    created_at: "2026-10-07T00:00:00Z", updated_at: "2026-10-07T00:00:00Z",
    current_revision_id: "revision-v2", archived_at: null,
  },
  current_revision: {
    id: "revision-v2", strategy_id: "strategy-v2", parent_revision_id: null,
    canonical_strategy: strategy, source_hash: "sha256:v2",
    schema_version: "ruletrade.dev/strategy/v2", created_at: "2026-10-07T00:00:00Z",
  },
};

describe("mounted v2 production editor", () => {
  it("renders one coherent semantic Selection inspector without schema-form actions", () => {
    const markup = renderToStaticMarkup(<V2StrategyEditor persisted={detail} onHome={() => undefined} />);
    for (const label of ["FROM", "WHERE", "ORDER BY", "DIRECTION", "TAKE", "WHEN FEWER QUALIFY", "SELECTION FALLBACK"]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain("QQQ · VGT · SOXX");
    expect(markup).toContain("126-observation return");
    expect(markup).toContain("TLT");
    expect(markup).not.toContain("Update condition");
    expect(markup).not.toContain("Apply condition");
    expect(markup).not.toContain("Return period");
    expect(markup).not.toContain("Scale = 1");
    expect(markup).toContain('data-canonical-version="v2"');
  });

  it("uses the shared semantic formatter for Value and nested Condition summaries", () => {
    expect(describeDailyValue(candidateReturn)).toContain("126-observation return");
    expect(describeConditionV2(strategy.selection.eligibility!)).toBe("ALL · 1 conditions");
  });
});
