import { ENTRY_BLOCK_DEFINITIONS, type EntryExecutionStatus } from "./entryStyleGrammar";

export interface EntryCapabilityEvidence {
  blockId: string;
  draftable: true;
  semanticRepresentable: boolean;
  referenceEvaluable: boolean;
  lowerable: boolean;
  dockerVerified: boolean;
  providerData: "not_required" | "required";
  runtime: "not_required_until_execution";
  execution: EntryExecutionStatus;
  reason: string;
}

const MARKET_DATA_BLOCKS = new Set(["asset-value", "trailing-return", "sma", "ema", "weighted-score"]);

/** Product availability never implies execution support; every dimension is explicit. */
export const ENTRY_CAPABILITY_MATRIX: EntryCapabilityEvidence[] = ENTRY_BLOCK_DEFINITIONS.map((block) => {
  const verified = block.execution === "verified";
  return {
    blockId: block.id,
    draftable: true,
    semanticRepresentable: block.execution !== "draft_only",
    referenceEvaluable: verified,
    lowerable: verified,
    dockerVerified: verified,
    providerData: MARKET_DATA_BLOCKS.has(block.id) ? "required" : "not_required",
    runtime: "not_required_until_execution",
    execution: block.execution,
    reason: verified ? "Covered by the maintained supported semantic subset when its complete graph is valid."
      : block.execution === "needs_context" ? "The block requires complete typed financial context before capability can be decided."
        : "Exact visual intent persists, but no production execution contract is claimed.",
  };
});

export const entryCapability = (blockId: string) => ENTRY_CAPABILITY_MATRIX.find((entry) => entry.blockId === blockId) ?? null;
