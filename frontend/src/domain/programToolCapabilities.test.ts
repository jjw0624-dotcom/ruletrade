import { describe, expect, it } from "vitest";

import { deriveProgramToolCapabilities, type ProgramToolContext } from "./programToolCapabilities";

const blank: ProgramToolContext = {
  hasDraft: false,
  groupCount: 0,
  hasGroup: false,
  hasGroupAssets: false,
  groupAssetCount: 0,
  hasSelection: false,
  selectionMatchesGroup: false,
  hasSelectionAllocation: false,
  hasPortfolioSplit: false,
  hasAllocationRoot: false,
  hasGuardedAllocation: false,
  allocationDescription: "",
};

describe("Program tool capabilities", () => {
  it("derives Blank availability without invoking authoring callbacks", () => {
    const tools = deriveProgramToolCapabilities(blank);
    expect(tools).toHaveLength(29);
    expect(tools.find(({ id }) => id === "investment")).toMatchObject({ availability: "draftable", disabled: false });
    expect(tools.find(({ id }) => id === "split")).toMatchObject({ availability: "needs_context", disabled: true });
    expect(tools.find(({ id }) => id === "cooldown")).toMatchObject({ availability: "unsupported_execution", disabled: true });
  });

  it("enables Split only when two Groups exist and no Split is committed", () => {
    const ready = deriveProgramToolCapabilities({ ...blank, groupCount: 2, hasGroup: true });
    expect(ready.find(({ id }) => id === "split")).toMatchObject({ availability: "ready", disabled: false });
    const committed = deriveProgramToolCapabilities({ ...blank, groupCount: 2, hasGroup: true, hasPortfolioSplit: true });
    expect(committed.find(({ id }) => id === "split")).toMatchObject({ availability: "invalid_here", disabled: true });
  });

  it("keeps execution support distinct from visual draft availability", () => {
    const tools = deriveProgramToolCapabilities({ ...blank, hasDraft: true });
    expect(tools.find(({ id }) => id === "intent-market-regime")).toMatchObject({
      availability: "unsupported_execution",
      disabled: true,
    });
    expect(tools.find(({ id }) => id === "intent-score")).toMatchObject({
      availability: "ready",
      disabled: true,
    });
  });
});
