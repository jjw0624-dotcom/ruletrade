import { describe, expect, it } from "vitest";
import { BLOCK_UI_CONTRACTS, blockUiContract } from "./blockUiContract";
import { ENTRY_BLOCK_DEFINITIONS } from "./entryStyleGrammar";

describe("block surface and Inspector responsibility contract", () => {
  it("covers every visible block from one machine-readable source", () => {
    expect(BLOCK_UI_CONTRACTS.map((contract) => contract.blockType)).toEqual(ENTRY_BLOCK_DEFINITIONS.map((definition) => definition.id));
    expect(new Set(BLOCK_UI_CONTRACTS.map((contract) => contract.family))).toEqual(new Set(["start", "control", "comparison", "logic", "arithmetic", "market_value", "score", "reference", "choose", "trade", "rebalance", "signal", "data", "function"]));
  });

  it("keeps essential financial meaning on blocks and advanced policy in Inspector", () => {
    expect(blockUiContract("invest")).toMatchObject({ requiredVisibleInputs: ["TARGET", "AMOUNT"], advancedInspectorFields: expect.arrayContaining(["cash semantics"]) });
    expect(blockUiContract("rebalance")).toMatchObject({ requiredVisibleInputs: ["TARGET", "WEIGHT"], advancedInspectorFields: expect.arrayContaining(["portfolio-weight validation"]) });
    expect(blockUiContract("choose-group")).toMatchObject({ requiredVisibleInputs: ["GROUP", "CONDITION", "SCORE", "COUNT"], advancedInspectorFields: expect.arrayContaining(["shortage policy", "tie-break"]) });
    expect(blockUiContract("group-reference")?.dedicatedWorkspaceFields).toContain("Group membership");
  });
});
