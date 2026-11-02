import { describe, expect, it } from "vitest";
import { ENTRY_BLOCK_DEFINITIONS } from "./entryStyleGrammar";
import { ENTRY_CAPABILITY_MATRIX, entryCapability } from "./entryCapabilityMatrix";

describe("Entry block capability evidence", () => {
  it("covers every visible block without inferring execution from draftability", () => {
    expect(ENTRY_CAPABILITY_MATRIX.map((entry) => entry.blockId)).toEqual(ENTRY_BLOCK_DEFINITIONS.map((entry) => entry.id));
    expect(ENTRY_CAPABILITY_MATRIX.every((entry) => entry.draftable)).toBe(true);
    expect(entryCapability("random-value")).toMatchObject({ semanticRepresentable: false, lowerable: false, dockerVerified: false });
    expect(entryCapability("invest")).toMatchObject({ execution: "needs_context", lowerable: false });
    expect(entryCapability("trailing-return")).toMatchObject({ providerData: "required", lowerable: true });
  });
});
