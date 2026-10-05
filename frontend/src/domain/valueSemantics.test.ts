import { describe, expect, it } from "vitest";

import type { CanonicalStrategyV1, ValueExpression } from "./canonical";
import {
  compactConditionExpression,
  describeConditionExpression,
  describeSelectionSummary,
  describeUniverse,
  describeValueExpression,
} from "./valueSemantics";

const candidateReturn: ValueExpression = {
  kind: "indicator", indicator_id: "trailing_return_indicator@1",
  asset: { kind: "candidate" }, parameters: { lookback_bars: 252 },
};

describe("shared semantic Value, Condition, and Selection summaries", () => {
  it("formats complete financial Values without raw AST language", () => {
    expect(describeValueExpression({
      kind: "indicator", indicator_id: "trailing_return_indicator@1",
      asset: { kind: "literal", value_type: "asset", value: "SPY" }, parameters: { lookback_bars: 126 },
    })).toBe("SPY's 126-observation return");
    expect(describeValueExpression({
      kind: "current", series: { kind: "market_series", field: "price", subject: { kind: "candidate" } },
    })).toBe("Candidate's current adjusted price");
    expect(describeValueExpression({
      kind: "rolling_aggregate", operator: "mean", window_observations: 63,
      series: { kind: "market_series", field: "price", subject: { kind: "literal", value_type: "asset", value: "QQQ" } },
    })).toBe("QQQ's 63-observation mean adjusted price");
    expect(describeValueExpression({
      kind: "arithmetic", operator: "multiply", left: candidateReturn,
      right: { kind: "literal", value_type: "decimal", value: 2.5 },
    })).toBe("Candidate's 252-observation return × 2.5");
  });

  it("uses the same grammar for conditions, bounded ALL, Selection, and fallback-sized canvas labels", () => {
    const first = { kind: "comparison", operator: "gt", left: candidateReturn, right: { kind: "literal", value_type: "percentage", value: 0 } } as const;
    const second = { kind: "comparison", operator: "gte", left: { kind: "current", series: { kind: "market_series", field: "price", subject: { kind: "candidate" } } }, right: { kind: "literal", value_type: "money_per_share", value: 5 } } as const;
    expect(describeConditionExpression(first)).toBe("Candidate's 252-observation return > 0%");
    expect(describeConditionExpression({ kind: "boolean", operator: "and", operands: [first, second] })).toContain(" AND ");
    expect(compactConditionExpression({ kind: "boolean", operator: "and", operands: [first, second] })).toBe("2 eligibility conditions");
    expect(describeSelectionSummary(10, 2, candidateReturn, "descending")).toBe("Choose 10 assets · 2 filters · highest 252-observation return");
  });

  it("keeps Universe identity distinct from its asset-set storage", () => {
    const strategy = {
      definitions: {
        asset_sets: [{ id: "growth_assets", assets: ["QQQ", "VGT"] }],
        groups: [{ id: "growth", name: "Growth", asset_set_ref: "growth_assets", description: "" }],
        universes: [{ id: "growth_universe", name: "Growth candidates", source: "group", group_ref: "growth" }],
        parameters: [], state: [],
      },
      graph: { components: [{ id: "universe", primitive: "universe@1", config: { universe_ref: "growth_universe" }, condition: null, actions: [] }], connections: [] },
    } as unknown as CanonicalStrategyV1;
    expect(describeUniverse(strategy, "universe")).toBe("Growth candidates · Static Group universe");
  });
});
