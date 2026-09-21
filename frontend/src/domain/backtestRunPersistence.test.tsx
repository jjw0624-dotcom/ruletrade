import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { backtestRunApi, type BacktestRunRecord } from "../backtestRunApi";
import { ResultWorkspace } from "../components/ResultWorkspace";
import { BacktestSetup } from "../components/BacktestSetup";
import { pathForRoute, routeFromPath } from "./navigation";

const config = { start_date: "2020-01-01", end_date: "2025-12-31", initial_cash: "100000", dataset_id: "filter-synthetic" as const };
const timings = { source_load_ms: 1, validation_ms: 2, compiler_ms: 3, codegen_ms: 4, csharp_compile_ms: 5, lean_execution_ms: 6, result_load_ms: 7, normalization_ms: 8, total_ms: 36 };
const run: BacktestRunRecord = { id: "run-1", revision_id: "revision-1", status: "succeeded", run_config: config, result: { initial_value: "100000", final_value: "131400", total_return: "0.314", total_orders: 12, total_fees: "18", equity_curve: [{ timestamp: "2020-01-01T00:00:00Z", value: "100000" }, { timestamp: "2025-12-31T00:00:00Z", value: "131400" }] }, error: null, provenance: { source_hash: "sha256:source", strategy_schema_version: "ruletrade.dev/strategy/v1", application_version: "0.1.0", build_commit: null, backend_id: "lean", engine_image: null, dataset_id: "filter-synthetic", dataset_version: null }, timings, created_at: "2026-09-09T10:00:00Z", started_at: "2026-09-09T10:00:01Z", completed_at: "2026-09-09T10:00:37Z" };

function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }

describe("persistent BacktestRun frontend", () => {
  it("creates a Run for exactly one saved Revision with the real config envelope", async () => {
    let url = "", submitted: unknown;
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => { url = String(input); submitted = JSON.parse(String(init?.body)); return response(run, 201); }) as typeof fetch;
    expect((await backtestRunApi.create("revision-1", config, fetcher)).revision_id).toBe("revision-1");
    expect(url).toBe("/api/v1/revisions/revision-1/backtest-runs");
    expect(submitted).toEqual({ config });
  });

  it("lists independent Runs without mutating their configuration", async () => {
    const second = { ...run, id: "run-2", run_config: { ...config, start_date: "2015-01-01" } };
    const fetcher = (async () => response({ items: [second, run] })) as typeof fetch;
    const original = structuredClone(run);
    expect((await backtestRunApi.list("revision-1", fetcher)).items).toHaveLength(2);
    expect(run).toEqual(original);
  });

  it("reopens an existing Run with GET and no execution request", async () => {
    const calls: Array<[string, string | undefined]> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => { calls.push([String(input), init?.method]); return response(run); }) as typeof fetch;
    await backtestRunApi.get("run-1", fetcher);
    expect(calls).toEqual([["/api/v1/backtest-runs/run-1", undefined]]);
    expect(routeFromPath("/backtest-runs/run-1")).toEqual({ page: "run", runId: "run-1" });
    expect(pathForRoute({ page: "run", runId: "run 1" })).toBe("/backtest-runs/run%201");
  });

  it("renders a successful historical result and real provenance details", () => {
    const markup = renderToStaticMarkup(<ResultWorkspace run={run} strategyName="Historical backtest" onBack={() => undefined} />);
    expect(markup).toContain("Saved in Backtests"); expect(markup).toContain("31.40%"); expect(markup).toContain("RuleTrade version"); expect(markup).toContain("36 ms");
  });

  it.each(["daily", "monthly"])(
    "treats a successful persisted %s-schedule Run as a saved Result with chart and Analysis",
    (cadence) => {
      const persisted = { ...run, id: `run-${cadence}` };
      const markup = renderToStaticMarkup(
        <ResultWorkspace run={persisted} strategyName={`${cadence} strategy`} onBack={() => undefined} />,
      );

      expect(markup).toContain("Saved in Backtests");
      expect(markup).toContain("Portfolio value equity curve");
      expect(markup).toContain("Decision analysis");
      expect(markup).not.toContain("Save this strategy and create a saved test");
    },
  );

  it("renders a failed artifact without stale success metrics", () => {
    const failed = { ...run, status: "failed" as const, result: null, error: { code: "execution_failed", message: "Backtest execution failed." } };
    const markup = renderToStaticMarkup(<ResultWorkspace run={failed} strategyName="Historical backtest" onBack={() => undefined} />);
    expect(markup).toContain("did not produce a result"); expect(markup).toContain("Backtest execution failed."); expect(markup).not.toContain("$131,400.00");
  });

  it("labels clean runs as historical and unsaved working-copy tests as temporary", () => {
    const saved = renderToStaticMarkup(<BacktestSetup config={config} onChange={() => undefined} onClose={() => undefined} onRun={() => undefined} persistence="historical" />);
    const draft = renderToStaticMarkup(<BacktestSetup config={config} onChange={() => undefined} onClose={() => undefined} onRun={() => undefined} persistence="temporary" />);
    expect(saved).toContain("Saved test"); expect(saved).toContain("Run and save result");
    expect(draft).toContain("Testing current changes"); expect(draft).toContain("Test current changes");
  });
});
