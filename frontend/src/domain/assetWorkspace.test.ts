import { describe, expect, it } from "vitest";
import { workbenchResearchReducer, INITIAL_WORKBENCH_RESEARCH, researchTitle } from "./workbenchResearch";

describe("Asset Workspace research destination", () => {
  it("opens inside the bounded Builder research surface", () => {
    const state = workbenchResearchReducer(INITIAL_WORKBENCH_RESEARCH, { type: "open_asset", symbol: "QQQ" });
    expect(state.researchOpen).toBe(true);
    expect(state.destination).toEqual({ kind: "asset", symbol: "QQQ", historical: undefined });
    expect(researchTitle(state.destination)).toBe("QQQ · Asset research");
  });
  it("preserves an immutable historical decision address", () => {
    const historical = { runId: "run", eventId: "event", revisionId: "revision", asOf: "2024-06-28" };
    const state = workbenchResearchReducer(INITIAL_WORKBENCH_RESEARCH, { type: "open_asset", symbol: "SPY", historical });
    expect(state.destination).toEqual({ kind: "asset", symbol: "SPY", historical });
  });
});
