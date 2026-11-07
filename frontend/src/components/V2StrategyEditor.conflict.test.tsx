// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonicalStrategyV2, V2AuthoringOperation } from "../domain/canonicalV2";
import type { StrategyDetailV2 } from "../strategyApi";

vi.mock("./SemanticProgramBuilderAdapter", () => ({
  SemanticProgramBuilderAdapter: ({ canonical, status, apply, save, prepareTest, testPanel }: { canonical: CanonicalStrategyV2; status: string; apply: (operation: V2AuthoringOperation) => void; save: () => void; prepareTest?: (operation: V2AuthoringOperation) => void; testPanel?: React.ReactNode }) => <div data-testid="adapter" data-status={status} data-assets={canonical.definitions.asset_sets[0]?.assets.join(",")} data-description={canonical.metadata.description} data-test-panel={String(Boolean(testPanel))}>
    <button type="button" onClick={() => apply({ kind: "set_program_asset_set", asset_set_id: "assets", assets: ["QQQ"] })}>Make local edit</button>
    <button type="button" onClick={save}>Save</button>
    <button type="button" onClick={() => prepareTest?.({ kind: "commit_single_asset_intent", investment_id: "investment-draft-start", investment_name: "QQQ Investment", asset_set_id: "assets-draft-start", asset: "QQQ", timeframe: "monthly", timing_meaning: "rebalance" })}>Prepare Blocky Test</button>
  </div>,
}));

import { V2StrategyEditor } from "./V2StrategyEditor";

const base: CanonicalStrategyV2 = {
  api_version: "ruletrade.dev/strategy/v2", semantic_profile: "profile-a/daily-compositional-core@1",
  metadata: { name: "Base", description: "", tags: [] }, operator_lock: {}, selection: null, predicate: null,
  definitions: { asset_sets: [{ id: "assets", assets: [] }], groups: [], asset_axis: { name: "asset", domain_id: "assets", coordinate_policy: "member_identity" } },
  program: { semantic_id: "program", clocks: [], initial_state: {}, formalizations: [], statements: [] },
};
const persisted: StrategyDetailV2 = {
  strategy: { id: "strategy-1", name: "Base", current_revision_id: "revision-1", created_at: "", updated_at: "", archived_at: null },
  current_revision: { id: "revision-1", strategy_id: "strategy-1", parent_revision_id: null, canonical_strategy: base, source_hash: "hash-1", schema_version: base.api_version, created_at: "" },
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("V2 revision conflict lifecycle", () => {
  let container: HTMLDivElement; let root: Root;
  beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); localStorage.clear(); });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

  it("validates the visible Start graph, saves its exact revision, then opens Quick Test", async () => {
    const authored = structuredClone(base);
    authored.metadata.description = "Visible monthly QQQ graph";
    authored.definitions.asset_sets[0]!.assets = ["QQQ"];
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v2/revisions/revision-1/backtest-runs") return json({ items: [] });
      if (url === "/api/v2/canonical/strategies/execution-capability") return json({ authoring_state: "committed", semantic_state: "valid", execution_state: "incomplete", provider_state: "not_checked", runtime_state: "not_checked", product_message: "Incomplete", technical_detail: null, authorable: true, reference_valid: true, backend_lowerable: false, production_executable: false, reason: "Incomplete" });
      if (url === "/api/v2/canonical/authoring/apply") {
        requests.push("authoring");
        const request = JSON.parse(String(init?.body));
        expect(request.operation).toMatchObject({ kind: "commit_single_asset_intent", asset: "QQQ", timeframe: "monthly" });
        return json({ strategy: authored, source_hash: "hash-authored" });
      }
      if (url === "/api/v1/strategies/strategy-1/revisions") {
        requests.push("revision");
        const request = JSON.parse(String(init?.body));
        expect(request.expected_parent_revision_id).toBe("revision-1");
        expect(request.canonical_strategy).toEqual(authored);
        return json({ created: true, strategy: { ...persisted.strategy, current_revision_id: "revision-2" }, revision: { ...persisted.current_revision, id: "revision-2", parent_revision_id: "revision-1", canonical_strategy: authored, source_hash: "hash-saved" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    await act(async () => root.render(<V2StrategyEditor persisted={persisted} onHome={() => undefined} />));
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Prepare Blocky Test")!.click());
    expect(requests).toEqual(["authoring", "revision"]);
    expect(container.querySelector('[data-testid="adapter"]')).toMatchObject({ dataset: expect.objectContaining({ assets: "QQQ", status: "saved", testPanel: "true" }) });
  });

  it("preserves the visible graph and does not open Test when revision CAS is stale", async () => {
    const remote = structuredClone(base); remote.metadata.description = "Remote";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/v2/revisions/revision-1/backtest-runs") return json({ items: [] });
      if (url === "/api/v2/canonical/strategies/execution-capability") return json({ authoring_state: "committed", semantic_state: "valid", execution_state: "incomplete", provider_state: "not_checked", runtime_state: "not_checked", product_message: "Incomplete", technical_detail: null, authorable: true, reference_valid: true, backend_lowerable: false, production_executable: false, reason: "Incomplete" });
      if (url === "/api/v2/canonical/authoring/apply") return json({ strategy: { ...base, metadata: { ...base.metadata, description: "Visible graph" } }, source_hash: "hash-authored" });
      if (url === "/api/v1/strategies/strategy-1/revisions") return json({ detail: { code: "stale_revision", message: "stale", current_revision_id: "revision-2" } }, 409);
      if (url === "/api/v1/strategies/strategy-1") return json({ strategy: { ...persisted.strategy, current_revision_id: "revision-2" }, current_revision: { ...persisted.current_revision, id: "revision-2", canonical_strategy: remote, source_hash: "hash-2" } });
      throw new Error(`Unexpected request: ${url}`);
    }));
    await act(async () => root.render(<V2StrategyEditor persisted={persisted} onHome={() => undefined} />));
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Prepare Blocky Test")!.click());
    expect(container.querySelector('[aria-label="Revision conflict"]')?.textContent).toContain("visible Blocky graph");
    expect(container.querySelector('[data-testid="adapter"]')?.getAttribute("data-test-panel")).toBe("false");
  });

  it("surfaces base/current revisions and reapplies only compatible changes", async () => {
    const remote = structuredClone(base); remote.metadata.description = "Remote description";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v2/revisions/revision-1/backtest-runs") return json({ items: [] });
      if (url === "/api/v2/canonical/strategies/execution-capability") return json({ authoring_state: "committed", semantic_state: "valid", execution_state: "incomplete", provider_state: "not_checked", runtime_state: "not_checked", product_message: "Incomplete", technical_detail: null, authorable: true, reference_valid: true, backend_lowerable: false, production_executable: false, reason: "Incomplete" });
      if (url === "/api/v2/canonical/authoring/apply") {
        const request = JSON.parse(String(init?.body)); const next = structuredClone(base); next.definitions.asset_sets[0]!.assets = request.operation.assets;
        return json({ strategy: next, source_hash: "hash-local" });
      }
      if (url === "/api/v1/strategies/strategy-1/revisions") return json({ detail: { code: "stale_revision", message: "stale", current_revision_id: "revision-2" } }, 409);
      if (url === "/api/v1/strategies/strategy-1") return json({ strategy: { ...persisted.strategy, current_revision_id: "revision-2" }, current_revision: { ...persisted.current_revision, id: "revision-2", canonical_strategy: remote, source_hash: "hash-2" } });
      throw new Error(`Unexpected request: ${url}`);
    }));
    await act(async () => root.render(<V2StrategyEditor persisted={persisted} onHome={() => undefined} />));
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Save")!.click());
    const banner = container.querySelector('[aria-label="Revision conflict"]')!;
    expect(banner.textContent).toContain("revision-1"); expect(banner.textContent).toContain("revision-2");
    expect(banner.textContent).toContain("different semantic addresses");
    await act(async () => [...banner.querySelectorAll("button")].find((button) => button.textContent === "Reapply my changes")!.click());
    expect(container.querySelector('[aria-label="Revision conflict"]')).toBeNull();
    expect(container.querySelector('[data-testid="adapter"]')).toMatchObject({ dataset: expect.objectContaining({ assets: "QQQ", description: "Remote description", status: "saved" }) });
  });

  it("does not offer automatic reapply for the same semantic address", async () => {
    const remote = structuredClone(base); remote.definitions.asset_sets[0]!.assets = ["SPY"];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("backtest-runs")) return json({ items: [] });
      if (url.includes("execution-capability")) return json({ authoring_state: "committed", semantic_state: "valid", execution_state: "incomplete", provider_state: "not_checked", runtime_state: "not_checked", product_message: "Incomplete", technical_detail: null, authorable: true, reference_valid: true, backend_lowerable: false, production_executable: false, reason: "Incomplete" });
      if (url.includes("authoring/apply")) { const next = structuredClone(base); next.definitions.asset_sets[0]!.assets = ["QQQ"]; return json({ strategy: next, source_hash: "hash-local" }); }
      if (url.endsWith("/revisions")) return json({ detail: { code: "stale_revision", message: "stale", current_revision_id: "revision-2" } }, 409);
      if (url.endsWith("strategy-1")) return json({ strategy: { ...persisted.strategy, current_revision_id: "revision-2" }, current_revision: { ...persisted.current_revision, id: "revision-2", canonical_strategy: remote, source_hash: "hash-2" } });
      throw new Error(`Unexpected request: ${url} ${String(init?.method)}`);
    }));
    await act(async () => root.render(<V2StrategyEditor persisted={persisted} onHome={() => undefined} />));
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Save")!.click());
    const reapply = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Reapply my changes")!;
    expect(reapply.disabled).toBe(true);
    expect(container.querySelector('[aria-label="Revision conflict"]')?.textContent).toContain("strategy/definitions/asset_sets/assets/assets");
  });
});
