import { describe, expect, it } from "vitest";

import type { CanonicalStrategyV1 } from "./canonical";
import { describeUniverse, describeValueExpression } from "./valueSemantics";

describe("shared semantic subject and value projection", () => {
  it("describes Candidate rolling values in user language", () => {
    expect(describeValueExpression({
      kind: "rolling_aggregate",
      operator: "mean",
      window_observations: 252,
      series: { kind: "market_series", field: "volume", subject: { kind: "candidate" } },
    })).toBe("Candidate volume · mean over 252 completed observations");
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
