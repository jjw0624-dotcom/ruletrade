import React, { useState } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";
import type { CanonicalStrategyV2, V2AuthoringOperation } from "./domain/canonicalV2";
import { emptyProgramWorkingDraft, type ProgramWorkingDraft } from "./domain/programWorkingDraft";
import { SemanticProgramBuilderAdapter } from "./components/SemanticProgramBuilderAdapter";
import { V2StrategyEditor } from "./components/V2StrategyEditor";
import { ResultWorkspace } from "./components/ResultWorkspace";
import type { StrategyDetailV2 } from "./strategyApi";
import type { BacktestRunRecord } from "./backtestRunApi";

const assets = [
  ["QQQ", "Invesco QQQ Trust", "ETF"], ["VGT", "Vanguard Information Technology ETF", "ETF"],
  ["SOXX", "iShares Semiconductor ETF", "ETF"], ["SCHG", "Schwab U.S. Large-Cap Growth ETF", "ETF"],
  ["TLT", "iShares 20+ Year Treasury Bond ETF", "ETF"], ["AAPL", "Apple Inc.", "Equity"],
] as const;

const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = String(input);
  const browserWindow = window as typeof window & { __RULETRADE_BROWSER_REQUESTS__?: Array<{ url: string; method: string }> };
  browserWindow.__RULETRADE_BROWSER_REQUESTS__ = [...(browserWindow.__RULETRADE_BROWSER_REQUESTS__ ?? []), { url, method: init?.method ?? "GET" }];
  if (url.startsWith("/api/v2/canonical/strategies/execution-capability")) return new Response(JSON.stringify({ authoring_state: "committed", semantic_state: "valid", execution_state: "executable", provider_state: "available", runtime_state: "available", product_message: "Ready to test.", technical_detail: null, authorable: true, reference_valid: true, backend_lowerable: true, production_executable: true, reason: null }), { headers: { "content-type": "application/json" } });
  if (url === `/api/v2/revisions/${persistedRun.revision_id}/backtest-runs`) return new Response(JSON.stringify(init?.method === "POST" ? persistedRun : { items: [persistedRun] }), { status: init?.method === "POST" ? 201 : 200, headers: { "content-type": "application/json" } });
  if (url === `/api/v2/backtest-runs/${persistedRun.id}/decision-events`) return new Response(JSON.stringify({ items: [evidenceSummary] }), { headers: { "content-type": "application/json" } });
  if (url === `/api/v2/backtest-runs/${persistedRun.id}/decision-events/${evidenceSummary.id}`) return new Response(JSON.stringify({ ...evidenceSummary, evidence: { kind: "final_targets", selected: ["QQQ"], targets: { QQQ: "1" } } }), { headers: { "content-type": "application/json" } });
  if (url.startsWith("/api/v1/assets/compare")) return new Response(JSON.stringify({ as_of: "2026-10-24", items: [] }), { headers: { "content-type": "application/json" } });
  if (url.startsWith("/api/v1/assets/")) {
    const symbol = decodeURIComponent(url.split("/api/v1/assets/")[1]!.split("?")[0]!);
    const row = assets.find((item) => item[0] === symbol) ?? assets[0];
    const series = Array.from({ length: 40 }, (_, index) => { const day = new Date(Date.UTC(2026, 8, 1 + index)); return { date: day.toISOString().slice(0, 10), adjusted_close: String(100 + index) }; });
    return new Response(JSON.stringify({ asset: { symbol: row[0], name: row[1], asset_type: row[2], data_status: "available", available_from: "2025-01-01", available_to: "2026-10-24" }, as_of: "2026-10-24", mode: "current", series, metrics: [{ id: "price", label: "Adjusted close", status: "available", value: "139", value_type: "money.usd" }, { id: "return", label: "126-observation return", status: "insufficient_history", reason: "Harness history is intentionally bounded." }], memberships: [], capabilities: [] }), { headers: { "content-type": "application/json" } });
  }
  if (url.startsWith("/api/v1/assets")) return new Response(JSON.stringify({ items: assets.map(([symbol, name, asset_type]) => ({ symbol, name, asset_type, data_status: "available", available_from: "2025-01-01", available_to: "2026-10-24" })) }), { headers: { "content-type": "application/json" } });
  return originalFetch(input, init);
};

const blank: CanonicalStrategyV2 = {
  api_version: "ruletrade.dev/strategy/v2", semantic_profile: "profile-a/daily-compositional-core@1",
  metadata: { name: "Browser Acceptance", description: "", tags: [] },
  definitions: { asset_sets: [{ id: "initial-assets", assets: [] }], groups: [], asset_axis: { name: "asset", domain_id: "initial-assets", coordinate_policy: "member_identity" } },
  operator_lock: {}, selection: null, predicate: null,
  program: { semantic_id: "program", clocks: [], initial_state: {}, formalizations: [], statements: [] },
};

const persistedCanonical: CanonicalStrategyV2 = {
  ...blank,
  metadata: { ...blank.metadata, name: "Persisted V2 Journey" },
  definitions: {
    ...blank.definitions,
    asset_sets: [{ id: "growth-assets", assets: ["QQQ"] }],
    groups: [{ id: "growth", name: "Growth", asset_set_ref: "growth-assets", description: "" }],
    asset_axis: { name: "asset", domain_id: "growth", coordinate_policy: "member_identity" },
  },
  program: {
    semantic_id: "program", initial_state: {}, formalizations: [],
    clocks: [{ id: "monthly-close", timeframe: "monthly", boundary: "close", timezone: "UTC", completed_only: true }],
    statements: [{ kind: "allocate", semantic_id: "growth-allocation", method: "fixed", clock_id: "monthly-close", legs: [{ semantic_id: "growth-leg", target: { semantic_id: "growth-target", kind: "asset", ref: "QQQ" }, weight: 1 }], minimum_weight: null, maximum_weight: null, cash_remainder_asset: null }],
  },
};

const persistedDetail: StrategyDetailV2 = {
  strategy: { id: "strategy-v2-browser", name: "Persisted V2 Journey", created_at: "2026-11-02T00:00:00Z", updated_at: "2026-11-02T00:00:00Z", current_revision_id: "revision-v2-browser", archived_at: null },
  current_revision: { id: "revision-v2-browser", strategy_id: "strategy-v2-browser", parent_revision_id: null, canonical_strategy: persistedCanonical, source_hash: "sha256:browser-v2", schema_version: persistedCanonical.api_version, created_at: "2026-11-02T00:00:00Z" },
};

const persistedRun: BacktestRunRecord = {
  id: "run-v2-browser", revision_id: "revision-v2-browser", status: "succeeded", run_config: { start_date: "2024-01-01", end_date: "2024-02-29", initial_cash: "100000", dataset_id: "filter-synthetic" },
  result: { initial_value: "100000", final_value: "110000", total_return: "0.1", total_orders: 1, total_fees: "1", equity_curve: [{ timestamp: "2024-01-01T00:00:00Z", value: "100000" }, { timestamp: "2024-02-29T00:00:00Z", value: "110000" }] }, error: null,
  provenance: { source_hash: "sha256:browser-v2", strategy_schema_version: persistedCanonical.api_version, application_version: "browser", build_commit: "browser-head", backend_id: "lean", engine_image: "lean:browser", dataset_id: "filter-synthetic", dataset_version: "browser-v1" },
  timings: { source_load_ms: 1, validation_ms: 1, compiler_ms: 1, codegen_ms: 1, csharp_compile_ms: 1, lean_execution_ms: 1, result_load_ms: 1, normalization_ms: 1, total_ms: 8 }, created_at: "2026-11-02T00:00:00Z", started_at: "2026-11-02T00:00:01Z", completed_at: "2026-11-02T00:00:08Z",
};

const evidenceSummary = { id: "decision-v2-browser", run_id: persistedRun.id, ordinal: 1, schema_version: 2 as const, session_id: "2024-02-29", phase: "portfolio_execution", kind: "final_targets", source_components: [{ role: "rebalance", component_id: "growth-allocation" }] };

function Harness() {
  const [canonical, setCanonical] = useState<CanonicalStrategyV2>(blank);
  const [draft, setDraft] = useState<ProgramWorkingDraft>(() => emptyProgramWorkingDraft("browser-acceptance"));
  const apply = (operation: V2AuthoringOperation) => {
    if (operation.kind !== "add_program_group") return;
    setCanonical((current) => ({
      ...current,
      definitions: {
        ...current.definitions,
        asset_sets: [...current.definitions.asset_sets.filter((item) => item.id !== operation.asset_set_id), { id: operation.asset_set_id, assets: operation.assets }],
        groups: [...current.definitions.groups.filter((item) => item.id !== operation.group_id), { id: operation.group_id, name: operation.name, asset_set_ref: operation.asset_set_id, description: "" }],
      },
    }));
  };
  return <SemanticProgramBuilderAdapter canonical={canonical} dirty={false} status="saved" message="Saved" initialView="blocky"
    onHome={() => undefined} apply={apply} save={() => undefined} undo={() => undefined} redo={() => undefined}
    canUndo={false} canRedo={false} working={() => undefined} run={() => undefined} executionCapability={null}
    workingDraft={draft} onWorkingDraftChange={(next) => { (window as typeof window & { __RULETRADE_BROWSER_DRAFT__?: ProgramWorkingDraft }).__RULETRADE_BROWSER_DRAFT__ = next; setDraft(next); }} />;
}

function PersistedJourneyHarness() {
  const [run, setRun] = useState<BacktestRunRecord | null>(null);
  if (run) return <ResultWorkspace run={run} strategyName="Persisted V2 Journey" onBack={() => setRun(null)} />;
  return <V2StrategyEditor persisted={persistedDetail} onHome={() => undefined} onOpenRun={() => setRun(persistedRun)} />;
}

createRoot(document.getElementById("root")!).render(new URLSearchParams(window.location.search).get("journey") === "persisted-v2" ? <PersistedJourneyHarness /> : <Harness />);
