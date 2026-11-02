import React, { useState } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";
import type { CanonicalStrategyV2, V2AuthoringOperation } from "./domain/canonicalV2";
import { emptyProgramWorkingDraft, type ProgramWorkingDraft } from "./domain/programWorkingDraft";
import { SemanticProgramBuilderAdapter } from "./components/SemanticProgramBuilderAdapter";

const assets = [
  ["QQQ", "Invesco QQQ Trust", "ETF"], ["VGT", "Vanguard Information Technology ETF", "ETF"],
  ["SOXX", "iShares Semiconductor ETF", "ETF"], ["SCHG", "Schwab U.S. Large-Cap Growth ETF", "ETF"],
  ["TLT", "iShares 20+ Year Treasury Bond ETF", "ETF"], ["AAPL", "Apple Inc.", "Equity"],
] as const;

const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = String(input);
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

createRoot(document.getElementById("root")!).render(<Harness />);
