import { describe, expect, it, vi } from "vitest";

import { catalogRequestFor } from "./components/CatalogStrategyDialog";
import { strategyCatalogApi } from "./strategyCatalogApi";

describe("strategy catalog creation", () => {
  it("converts Growth and Defensive form values into one versioned request", () => {
    expect(catalogRequestFor("growth_defensive", {
      name: "My split",
      growth_assets: "qqq, VGT, soxx, SCHG",
      growth_weight: "0.7",
      defensive_asset: "ief",
      ranking_lookback: "126",
      fallback_asset: "tlt",
      timeframe: "monthly",
    })).toEqual({
      catalog_id: "growth_defensive",
      version: 1,
      name: "My split",
      growth_assets: ["QQQ", "VGT", "SOXX", "SCHG"],
      growth_weight: "0.7",
      defensive_asset: "IEF",
      ranking_lookback: 126,
      fallback_asset: "TLT",
      timeframe: "monthly",
    });
  });

  it("keeps catalog discovery and creation behind the API contract", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        id: "single_asset_periodic",
        version: 1,
        name: "Single asset periodic",
        description: "Hold one asset.",
        parameters: [],
      }]), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        catalog_id: "single_asset_periodic",
        catalog_version: 1,
        source_hash: "sha256:catalog",
        strategy: { api_version: "ruletrade.dev/strategy/v2", metadata: { name: "QQQ monthly" } },
      }), { status: 200, headers: { "content-type": "application/json" } }));

    const entries = await strategyCatalogApi.list(fetcher);
    expect(entries[0]).toMatchObject({ id: "single_asset_periodic", version: 1 });

    const created = await strategyCatalogApi.create({
      catalog_id: "single_asset_periodic",
      version: 1,
      name: "QQQ monthly",
      asset: "QQQ",
      timeframe: "monthly",
    }, fetcher);
    expect(created).toMatchObject({
      catalog_id: "single_asset_periodic",
      catalog_version: 1,
      source_hash: "sha256:catalog",
    });
    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/v2/strategy-catalog", {});
    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/v2/strategy-catalog/create", expect.objectContaining({ method: "POST" }));
  });

  it("surfaces backend validation messages", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      detail: { code: "trend_asset_outside_universe", message: "Trend asset must belong to the rotation universe." },
    }), { status: 422, headers: { "content-type": "application/json" } }));

    await expect(strategyCatalogApi.create({
      catalog_id: "market_regime_rotation",
      version: 1,
      name: "Invalid",
    }, fetcher)).rejects.toThrow("Trend asset must belong to the rotation universe.");
  });
});
