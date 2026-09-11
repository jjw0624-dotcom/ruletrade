import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { backtestRunApi, type BacktestRunRecord } from "../backtestRunApi";
import { BacktestSetup } from "../components/BacktestSetup";
import type { BacktestConfig } from "./backtest";
import {
  canLaunchPersistedRealDataRun,
  dataReadinessKey,
  freshDataReadiness,
  marketDataReasonMessage,
  readinessFromResult,
  type DataReadiness,
} from "./marketDataReadiness";
import {
  MarketDataApiError,
  marketDataApi,
  type MarketDataPreflight,
  type MarketDataReason,
} from "../marketDataApi";

const config: BacktestConfig = {
  start_date: "2020-01-01",
  end_date: "2025-12-31",
  initial_cash: "100000",
  dataset_id: "us-equity-daily-local",
};

function symbol(
  ticker: string,
  reason: MarketDataReason = "available",
  required = 126,
  available = 200,
) {
  return {
    symbol: ticker,
    status: reason === "available" ? "available" as const : "unavailable" as const,
    reason,
    available_from: "2019-01-02",
    available_to: "2025-12-31",
    warmup_observations_required: required,
    warmup_observations_available: available,
  };
}

function preflight(
  overall: MarketDataPreflight["overall"],
  symbols = [symbol("QQQ")],
): MarketDataPreflight {
  return {
    overall,
    dataset_id: "us-equity-daily-local",
    source_kind: "local_lean_data",
    provider_id: "lean-local-data",
    requirement: {
      dataset_id: "us-equity-daily-local",
      requested_start: config.start_date,
      requested_end: config.end_date,
      normalization_mode: "adjusted",
      symbols: symbols.map((item) => ({
        symbol: item.symbol,
        security_type: "equity",
        market: "usa",
        resolution: "daily",
        warmup_observations: item.warmup_observations_required,
      })),
    },
    symbols,
    cache_hit: overall === "available",
    acquisition_supported: false,
    acquisition_reason: null,
    elapsed_ms: 2,
  };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setup(readiness: DataReadiness, persistence: "historical" | "temporary" = "historical") {
  return renderToStaticMarkup(<BacktestSetup
    config={config}
    onChange={() => undefined}
    onClose={() => undefined}
    onRun={() => undefined}
    onCheckData={() => undefined}
    persistence={persistence}
    readiness={readiness}
  />);
}

describe("Market Data preflight UX", () => {
  it("posts the exact saved Revision and BacktestConfig envelope", async () => {
    let url = "";
    let submitted: unknown;
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      submitted = JSON.parse(String(init?.body));
      return response(preflight("available"));
    }) as typeof fetch;

    await marketDataApi.preflight("revision / 1", config, fetcher);

    expect(url).toBe("/api/v1/revisions/revision%20%2F%201/market-data/preflight");
    expect(submitted).toEqual({ config });
  });

  it("allows the existing persisted Run request only after available preflight", async () => {
    const key = dataReadinessKey("revision-1", config);
    const readiness = readinessFromResult(key, preflight("available"));
    const create = vi.fn(async (_revisionId: string, _config: BacktestConfig) => ({ id: "run-1" }) as BacktestRunRecord);

    if (canLaunchPersistedRealDataRun(readiness, key)) {
      await create("revision-1", config);
    }

    expect(create).toHaveBeenCalledWith("revision-1", config);
  });

  it.each([
    ["unavailable", [symbol("SCHG", "security_master_missing")]],
    ["partial", [symbol("QQQ"), symbol("VGT", "no_data")]],
  ] as const)("blocks the Run API for confirmed %s data", async (overall, symbols) => {
    const key = dataReadinessKey("revision-1", config);
    const readiness = readinessFromResult(key, preflight(overall, [...symbols]));
    const create = vi.fn<typeof backtestRunApi.create>();

    if (canLaunchPersistedRealDataRun(readiness, key)) {
      await create("revision-1", config);
    }

    expect(create).not.toHaveBeenCalled();
  });

  it("renders partial readiness per asset without calling the strategy invalid", () => {
    const key = dataReadinessKey("revision-1", config);
    const markup = setup(readinessFromResult(
      key,
      preflight("partial", [symbol("QQQ"), symbol("VGT", "no_data")]),
    ));

    expect(markup).toContain("Partly ready");
    expect(markup).toContain("QQQ");
    expect(markup).toContain("✓ Ready");
    expect(markup).toContain("VGT");
    expect(markup).toContain("Required market history is unavailable.");
    expect(markup).toContain("Strategy is ready, but historical data is unavailable");
    expect(markup).not.toContain("Invalid strategy");
  });

  it.each([
    ["provider_unavailable", "Historical market data isn&#x27;t available right now."],
    ["security_master_missing", "Complete historical data for this asset isn&#x27;t available."],
    ["requested_period_unavailable", "Historical data doesn&#x27;t cover the full test period."],
    ["corrupt_cache", "Historical data for this asset couldn&#x27;t be read."],
  ] as const)("maps %s to product language and retains its developer code", (reason, message) => {
    const key = dataReadinessKey("revision-1", config);
    const markup = setup(readinessFromResult(key, preflight("unavailable", [symbol("VGT", reason)])));
    expect(markup).toContain(message);
    expect(markup).toContain(`VGT: ${reason}`);
  });

  it("uses backend warm-up observations without calling them calendar days", () => {
    const key = dataReadinessKey("revision-1", config);
    const markup = setup(readinessFromResult(
      key,
      preflight("unavailable", [symbol("VGT", "insufficient_history", 126, 80)]),
    ));
    expect(markup).toContain("earlier market history");
    expect(markup).toContain("126 earlier trading observations required · 80 available");
    expect(markup).not.toContain("126 days");
  });

  it("distinguishes a preflight request failure from unavailable data", async () => {
    const fetcher = (async () => response(
      { detail: { code: "request_failed", message: "offline" } },
      503,
    )) as typeof fetch;
    await expect(marketDataApi.preflight("revision-1", config, fetcher))
      .rejects.toBeInstanceOf(MarketDataApiError);
    const markup = setup({
      status: "error",
      key: dataReadinessKey("revision-1", config),
      message: "offline",
    });
    expect(markup).toContain("We couldn&#x27;t check historical data right now.");
    expect(markup).not.toContain("Historical data is unavailable.");
  });

  it("invalidates readiness after either Revision or date changes", () => {
    const key = dataReadinessKey("revision-1", config);
    const readiness = readinessFromResult(key, preflight("available"));
    expect(freshDataReadiness(readiness, dataReadinessKey("revision-2", config)).status)
      .toBe("not_checked");
    expect(freshDataReadiness(
      readiness,
      dataReadinessKey("revision-1", { ...config, start_date: "2021-01-01" }),
    ).status).toBe("not_checked");
  });

  it("does not claim saved-Revision preflight for an unsaved working copy", () => {
    const markup = setup({ status: "not_checked" }, "temporary");
    expect(markup).toContain("Data readiness will be checked when this temporary test starts.");
    expect(markup).toContain("won&#x27;t use the saved Revision");
  });

  it("preserves synthetic setup without real-data readiness UI", () => {
    const markup = renderToStaticMarkup(<BacktestSetup
      config={{ ...config, dataset_id: "filter-synthetic" }}
      onChange={() => undefined}
      onClose={() => undefined}
      onRun={() => undefined}
      persistence="historical"
      readiness={{ status: "not_checked" }}
    />);
    expect(markup).toContain("Run and save result");
    expect(markup).not.toContain("Historical data will be checked");
  });

  it("keeps all structured reason distinctions deterministic", () => {
    expect(marketDataReasonMessage("no_data")).not.toBe(
      marketDataReasonMessage("security_master_missing"),
    );
    expect(marketDataReasonMessage("insufficient_history")).not.toBe(
      marketDataReasonMessage("requested_period_unavailable"),
    );
  });
});
