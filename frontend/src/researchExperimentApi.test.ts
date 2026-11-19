import { describe, expect, it, vi } from "vitest";

import type { CanonicalStrategyV2 } from "./domain/canonicalV2";
import { catalogBaseFromStrategy, researchExperimentApi } from "./researchExperimentApi";

const canonical = {
  api_version: "ruletrade.dev/strategy/v2",
  semantic_profile: "profile-a/daily-compositional-core@1",
  metadata: {
    name: "QQQ monthly",
    description: "",
    tags: ['ruletrade.catalog.v1:{"asset":"QQQ","catalog_id":"single_asset_periodic","name":"QQQ monthly","timeframe":"monthly","version":1}'],
  },
  definitions: { asset_sets: [], groups: [], asset_axis: { name: "asset", domain_id: "assets", coordinate_policy: "member_identity" } },
  operator_lock: {},
  selection: null,
  predicate: null,
  program: null,
} as CanonicalStrategyV2;

describe("Research Experiment API", () => {
  it("recovers the backend-owned catalog parameters from saved Canonical metadata", () => {
    expect(catalogBaseFromStrategy(canonical)).toEqual({
      asset: "QQQ",
      catalog_id: "single_asset_periodic",
      name: "QQQ monthly",
      timeframe: "monthly",
      version: 1,
    });
  });

  it("posts a Detail BT matrix against the immutable Revision", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ experiment: { id: "e1", candidates: [] }, runs: [] }), { status: 201, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    await researchExperimentApi.createDetail("revision 1", {
      name: "Asset sweep",
      base: catalogBaseFromStrategy(canonical)!,
      dimensions: [{ parameter_id: "asset", values: ["QQQ", "SPY"] }],
      config: { start_date: "2024-01-01", end_date: "2024-02-01", initial_cash: "100000", dataset_id: "filter-synthetic" },
    }, fetcher);
    expect(fetcher).toHaveBeenCalledWith("/api/v2/revisions/revision%201/research-experiments/detail", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse(String((fetcher as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body));
    expect(body.dimensions).toEqual([{ parameter_id: "asset", values: ["QQQ", "SPY"] }]);
  });
});
