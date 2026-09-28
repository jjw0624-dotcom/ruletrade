import { describe, expect, it, vi } from "vitest";

import type { BacktestRunRecord } from "../backtestRunApi";
import type { SaveRevisionResponse } from "../strategyApi";
import { momentumBootstrap } from "../test/fixture";
import { createPersistedTest } from "./persistedTest";

const config = { backend_id: "lean" as const, dataset_id: "golden-synthetic" as const, start_date: "2025-01-01", end_date: "2025-12-31", initial_cash: "100000" };
const saved = { created: true, strategy: { id: "strategy", name: "Strategy", created_at: "", updated_at: "", current_revision_id: "revision-new", archived_at: null }, revision: { id: "revision-new", strategy_id: "strategy", parent_revision_id: "revision-old", canonical_strategy: momentumBootstrap.strategy, source_hash: "hash", schema_version: "1", created_at: "" } } satisfies SaveRevisionResponse;
const run = { id: "run", revision_id: "revision-new" } as BacktestRunRecord;

describe("persisted Test lifecycle", () => {
  it("saves a dirty Strategy once and creates the Run from the exact returned Revision", async () => {
    const order: string[] = [];
    const save = vi.fn().mockResolvedValue(saved);
    const ready = vi.fn().mockResolvedValue(true);
    const onRunStart = vi.fn((revisionId: string) => order.push(`start:${revisionId}`));
    const createRun = vi.fn().mockImplementation(async () => { order.push("create"); return run; });
    expect(await createPersistedTest({ strategyId: "strategy", baseRevisionId: "revision-old", canonical: momentumBootstrap.strategy, dirty: true, config, save, ready, onRunStart, createRun })).toEqual({ saved, run });
    expect(save).toHaveBeenCalledOnce();
    expect(ready).toHaveBeenCalledWith("revision-new");
    expect(onRunStart).toHaveBeenCalledWith("revision-new");
    expect(order).toEqual(["start:revision-new", "create"]);
    expect(createRun).toHaveBeenCalledWith("revision-new", config);
  });

  it("reuses a clean Revision without creating another", async () => {
    const save = vi.fn();
    const createRun = vi.fn().mockResolvedValue({ ...run, revision_id: "revision-old" });
    await createPersistedTest({ strategyId: "strategy", baseRevisionId: "revision-old", canonical: momentumBootstrap.strategy, dirty: false, config, save, ready: async () => true, createRun });
    expect(save).not.toHaveBeenCalled();
    expect(createRun).toHaveBeenCalledWith("revision-old", config);
  });

  it("creates no Run when Save fails or readiness rejects the exact Revision", async () => {
    const createRun = vi.fn();
    const onRunStart = vi.fn();
    await expect(createPersistedTest({ strategyId: "strategy", baseRevisionId: "revision-old", canonical: momentumBootstrap.strategy, dirty: true, config, save: async () => { throw new Error("stale"); }, ready: async () => true, onRunStart, createRun })).rejects.toThrow("stale");
    expect(createRun).not.toHaveBeenCalled();
    const result = await createPersistedTest({ strategyId: "strategy", baseRevisionId: "revision-old", canonical: momentumBootstrap.strategy, dirty: false, config, save: vi.fn(), ready: async () => false, onRunStart, createRun });
    expect(result.run).toBeNull();
    expect(createRun).not.toHaveBeenCalled();
    expect(onRunStart).not.toHaveBeenCalled();
  });

  it("signals accepted execution before awaiting the persisted Run response", async () => {
    const onRunStart = vi.fn();
    const createRun = vi.fn().mockRejectedValue(new Error("engine unavailable"));
    await expect(createPersistedTest({ strategyId: "strategy", baseRevisionId: "revision-old", canonical: momentumBootstrap.strategy, dirty: false, config, save: vi.fn(), ready: async () => true, onRunStart, createRun })).rejects.toThrow("engine unavailable");
    expect(onRunStart).toHaveBeenCalledWith("revision-old");
    expect(createRun).toHaveBeenCalledOnce();
  });
});
