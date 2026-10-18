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
    for (const id of ["repeat-while", "wait", "random-value", "send-signal", "create-function", "import-function"]) {
      expect(entryBlockDefinition(id)?.execution).toBe("draft_only");
    }
    expect(entryBlockDefinition("trailing-return")?.execution).toBe("verified");
  });
});
