import { describe, expect, it } from "vitest";

import type { ChallengeSubmissionRecord } from "./challengeApi";
import { challengeProgress } from "./challengeProgress";

const attempt = (
  id: string,
  strategyId: string,
  score: string,
  direction: "maximize" | "minimize",
  createdAt: string,
  parameters: Record<string, unknown>,
): ChallengeSubmissionRecord => ({
  id,
  challenge_id: "challenge-1",
  challenge_version: 1,
  policy_version: 1,
  revision_id: `revision-${id}`,
  strategy_id: strategyId,
  run_id: `run-${id}`,
  catalog_id: "single_asset_periodic",
  catalog_parameters: { catalog_id: "single_asset_periodic", version: 1, name: id, ...parameters },
  eligible: true,
  violations: [],
  feedback: [],
  score,
  objective: { metric: "total_return", direction },
  created_at: createdAt,
});

describe("challenge attempt progress", () => {
  it("compares only the same Strategy and reports changed behavior inputs", () => {
    const previous = attempt("previous", "strategy-1", "0.10", "maximize", "2026-11-20T00:00:00Z", { asset: "SPY", timeframe: "monthly" });
    const other = attempt("other", "strategy-2", "0.50", "maximize", "2026-11-20T00:30:00Z", { asset: "QQQ", timeframe: "daily" });
    const latest = attempt("latest", "strategy-1", "0.14", "maximize", "2026-11-20T01:00:00Z", { asset: "QQQ", timeframe: "monthly" });

    const progress = challengeProgress(latest, [latest, other, previous]);

    expect(progress?.previous.id).toBe("previous");
    expect(progress?.outcome).toBe("improved");
    expect(progress?.delta).toBeCloseTo(0.04);
    expect(progress?.changes).toEqual([{ parameter: "asset", before: "SPY", after: "QQQ" }]);
  });

  it("interprets a lower score as improvement for minimize objectives", () => {
    const previous = attempt("previous", "strategy-1", "-0.10", "minimize", "2026-11-20T00:00:00Z", { asset: "SPY" });
    const latest = attempt("latest", "strategy-1", "-0.20", "minimize", "2026-11-20T01:00:00Z", { asset: "SPY" });

    expect(challengeProgress(latest, [previous, latest])).toMatchObject({
      outcome: "improved",
      delta: -0.1,
      changes: [],
    });
  });

  it("does not invent progress without verified Strategy lineage", () => {
    const latest = { ...attempt("latest", "strategy-1", "0.1", "maximize", "2026-11-20T01:00:00Z", {}), strategy_id: null };
    expect(challengeProgress(latest, [])).toBeNull();
  });
});
