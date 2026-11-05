// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonicalStrategyV2, V2AuthoringOperation } from "../domain/canonicalV2";
import type { StrategyDetailV2 } from "../strategyApi";

vi.mock("./SemanticProgramBuilderAdapter", () => ({
  SemanticProgramBuilderAdapter: ({ apply, run, testPanel }: {
    apply: (operation: V2AuthoringOperation) => void;
    run: () => void;
    testPanel: React.ReactNode;
  }) => <div>
    <button type="button" onClick={() => apply({ kind: "set_program_asset_set", asset_set_id: "assets", assets: ["QQQ", "SPY"] })}>Edit committed semantics</button>
    <button type="button" onClick={run}>Test</button>
    {testPanel}
  </div>,
}));

import { V2StrategyEditor } from "./V2StrategyEditor";

const canonical: CanonicalStrategyV2 = {
  api_version: "ruletrade.dev/strategy/v2",
  semantic_profile: "profile-a/daily-compositional-core@1",
  metadata: { name: "Quick Test", description: "", tags: [] },
  operator_lock: {}, selection: null, predicate: null,
  definitions: {
    asset_sets: [{ id: "assets", assets: ["QQQ"] }],
    groups: [{ id: "investment", name: "Investment", description: "", asset_set_ref: "assets" }],
    asset_axis: { name: "asset", domain_id: "investment", coordinate_policy: "member_identity" },
  },
  program: {
    semantic_id: "program", initial_state: {}, formalizations: [],
    clocks: [{ id: "monthly", timeframe: "monthly", boundary: "close", timezone: "UTC", completed_only: true }],
    statements: [{ kind: "allocate", semantic_id: "allocate", method: "fixed", clock_id: "monthly", minimum_weight: null, maximum_weight: null, cash_remainder_asset: null, legs: [{ semantic_id: "leg", target: { semantic_id: "target", kind: "asset", ref: "QQQ" }, weight: 1 }] }],
  },
};

const persisted: StrategyDetailV2 = {
  strategy: { id: "strategy-1", name: "Quick Test", current_revision_id: "revision-1", created_at: "", updated_at: "", archived_at: null },
  current_revision: { id: "revision-1", strategy_id: "strategy-1", parent_revision_id: null, canonical_strategy: canonical, source_hash: "hash-1", schema_version: canonical.api_version, created_at: "" },
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const executable = { authoring_state: "committed", semantic_state: "valid", execution_state: "executable", provider_state: "available", runtime_state: "available", product_message: "Ready", technical_detail: null, authorable: true, reference_valid: true, backend_lowerable: true, production_executable: true, reason: "Ready" };

describe("V2 Quick Test revision ownership", () => {
  let container: HTMLDivElement; let root: Root;
  beforeEach(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement("div"); document.body.append(container); root = createRoot(container); localStorage.clear(); });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

  it("CAS-saves dirty committed semantics and runs the exact returned revision", async () => {
    const calls: string[] = [];
    const saved = structuredClone(canonical); saved.definitions.asset_sets[0]!.assets = ["QQQ", "SPY"];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = init?.method ?? "GET"; calls.push(`${method} ${url}`);
      if (url === "/api/v2/revisions/revision-1/backtest-runs") return json({ items: [] });
      if (url === "/api/v2/canonical/strategies/execution-capability") return json(executable);
      if (url === "/api/v2/canonical/authoring/apply") return json({ strategy: saved, source_hash: "hash-dirty" });
      if (url === "/api/v1/strategies/strategy-1/revisions") return json({ created: true, strategy: { ...persisted.strategy, current_revision_id: "revision-2" }, revision: { ...persisted.current_revision, id: "revision-2", parent_revision_id: "revision-1", canonical_strategy: saved, source_hash: "hash-2" } }, 201);
      if (url === "/api/v2/revisions/revision-2/backtest-runs") return json({ id: "run-2", revision_id: "revision-2", status: "succeeded", run_config: {}, result: { total_return: "0.1", final_value: "110000", total_orders: 1 }, provenance: {}, timings: {}, created_at: "" }, 201);
      throw new Error(`Unexpected request: ${method} ${url}`);
    }));

    await act(async () => root.render(<V2StrategyEditor persisted={persisted} onHome={() => undefined} />));
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Edit committed semantics")!.click());
    await vi.waitFor(() => expect(calls).toContain("POST /api/v2/canonical/authoring/apply"));
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Test")!.click());
    await vi.waitFor(() => expect([...container.querySelectorAll<HTMLButtonElement>("button")].some((button) => button.textContent === "Run Quick Test")).toBe(true));
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Run Quick Test")!.click());
    await vi.waitFor(() => expect(calls).toContain("POST /api/v2/revisions/revision-2/backtest-runs"));

    const saveIndex = calls.indexOf("POST /api/v1/strategies/strategy-1/revisions");
    const runIndex = calls.indexOf("POST /api/v2/revisions/revision-2/backtest-runs");
    expect(saveIndex).toBeGreaterThan(-1);
    expect(runIndex).toBeGreaterThan(saveIndex);
    expect(calls).not.toContain("POST /api/v2/revisions/revision-1/backtest-runs");
    expect(container.textContent).toContain("Backtest complete");
    expect(container.textContent).toContain("revision-2");
  });
});
