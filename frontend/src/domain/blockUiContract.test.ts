import { describe, expect, it } from "vitest";
import { BLOCK_UI_CONTRACTS, blockUiContract } from "./blockUiContract";
import { ENTRY_BLOCK_DEFINITIONS } from "./entryStyleGrammar";

describe("block surface and Inspector responsibility contract", () => {
  it("covers every visible block from one machine-readable source", () => {
    expect(BLOCK_UI_CONTRACTS.map((contract) => contract.blockType)).toEqual(ENTRY_BLOCK_DEFINITIONS.map((definition) => definition.id));
    expect(new Set(BLOCK_UI_CONTRACTS.map((contract) => contract.family))).toEqual(new Set(["start", "control", "comparison", "logic", "asset_predicate", "aggregate", "arithmetic", "market_value", "score", "reference", "asset_set", "choose", "trade", "rebalance", "signal", "data", "function"]));
  });

  it("keeps essential financial meaning on blocks and advanced policy in Inspector", () => {
    expect(blockUiContract("filter-assets")).toMatchObject({ requiredVisibleInputs: ["ASSETS"], advancedInspectorFields: expect.arrayContaining(["ALL / ANY combination", "typed candidate conditions"]) });
    expect(blockUiContract("top-n-assets")).toMatchObject({ requiredVisibleInputs: ["ASSETS", "SCORE", "COUNT"], advancedInspectorFields: expect.arrayContaining(["deterministic tie-break"]) });
    expect(blockUiContract("invest")).toMatchObject({ requiredVisibleInputs: ["TARGET", "AMOUNT"], advancedInspectorFields: expect.arrayContaining(["available-cash validation"]) });
    expect(blockUiContract("units-each")).toMatchObject({ requiredVisibleInputs: [], connectionType: { shape: "value", output: "UnitsEach" } });
    expect(blockUiContract("rebalance")).toMatchObject({ requiredVisibleInputs: ["TARGET", "WEIGHT"], advancedInspectorFields: expect.arrayContaining(["portfolio-weight validation"]) });
    expect(blockUiContract("group-reference")?.dedicatedWorkspaceFields).toContain("Group membership");
  });
});
