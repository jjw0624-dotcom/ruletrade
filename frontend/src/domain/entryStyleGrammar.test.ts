import { describe, expect, it } from "vitest";
import { ENTRY_BLOCK_CATEGORIES, ENTRY_BLOCK_DEFINITIONS, entryBlockDefinition, validEntryBlockConnection } from "./entryStyleGrammar";

describe("Entry-style visual grammar", () => {
  it("exposes the product taxonomy rather than engine primitives", () => {
    expect(ENTRY_BLOCK_CATEGORIES).toEqual(["Start", "Control", "Logic", "Calculate", "Action", "Assets", "Data", "Functions"]);
    expect(ENTRY_BLOCK_DEFINITIONS.map((item) => item.label)).toContain("Invest [A] by [B]");
    expect(ENTRY_BLOCK_DEFINITIONS.map((item) => item.label)).not.toContain("Allocate capital");
  });

  it("uses typed target and amount slots for Investment", () => {
    const invest = entryBlockDefinition("invest")!;
    expect(invest.slots).toEqual([
      { name: "TARGET", label: "invest", accepts: ["Asset", "Group", "Subgroup"] },
      { name: "AMOUNT", label: "by", accepts: ["Money", "Percentage", "Quantity"] },
    ]);
    expect(validEntryBlockConnection("invest", "TARGET", "asset-reference")).toBe(true);
    expect(validEntryBlockConnection("invest", "TARGET", "number")).toBe(false);
    expect(validEntryBlockConnection("invest", "AMOUNT", "money")).toBe(true);
    expect(validEntryBlockConnection("if-otherwise", "CONDITION", "compare-gt")).toBe(true);
    expect(validEntryBlockConnection("if-otherwise", "CONDITION", "asset-reference")).toBe(false);
  });

  it("keeps undefined runtime behavior draftable but non-executable", () => {
    for (const id of ["repeat-while", "wait", "random-value", "send-signal", "create-function", "import-function", "filter-assets", "top-n-assets", "random-select-assets", "random-filter-assets"]) {
      expect(entryBlockDefinition(id)?.execution).toBe("draft_only");
    }
    expect(entryBlockDefinition("trailing-return")?.execution).toBe("verified");
  });

  it("keeps per-asset predicates distinct from strategy-level truth and composes AssetSets directly", () => {
    expect(validEntryBlockConnection("filter-assets", "ASSETS", "group-reference")).toBe(true);
    expect(validEntryBlockConnection("filter-assets", "ASSETS", "subgroup-reference")).toBe(true);
    expect(validEntryBlockConnection("filter-assets", "PREDICATE", "candidate-compare")).toBe(true);
    expect(validEntryBlockConnection("filter-assets", "PREDICATE", "compare-gt")).toBe(false);
    expect(validEntryBlockConnection("top-n-assets", "ASSETS", "filter-assets")).toBe(true);
    expect(validEntryBlockConnection("top-n-assets", "SCORE", "candidate-return")).toBe(true);
    expect(validEntryBlockConnection("asset-set-any", "PREDICATE", "candidate-compare")).toBe(true);
    expect(validEntryBlockConnection("asset-set-any", "PREDICATE", "logic-and")).toBe(false);
    expect(validEntryBlockConnection("invest", "TARGET", "filter-assets")).toBe(true);
  });
});
