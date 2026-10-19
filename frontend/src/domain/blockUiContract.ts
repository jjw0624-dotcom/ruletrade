import { ENTRY_BLOCK_DEFINITIONS, type EntryBlockDefinition, type EntryExecutionStatus, type EntryValueType } from "./entryStyleGrammar";

export type BlockUiFamily = "start" | "control" | "comparison" | "logic" | "arithmetic" | "market_value" | "score" | "reference" | "choose" | "trade" | "rebalance" | "signal" | "data" | "function";

export interface BlockUiContract {
  blockType: string;
  family: BlockUiFamily;
  semanticRole: string;
  requiredVisibleInputs: string[];
  optionalVisibleInputs: string[];
  advancedInspectorFields: string[];
  dedicatedWorkspaceFields: string[];
  connectionType: { shape: EntryBlockDefinition["shape"]; output: EntryValueType | null };
  summaryLabel: string;
  expandedSummary: string;
  validationRules: string[];
  capabilityRequirements: EntryExecutionStatus;
  translationMapping: string;
}

function familyFor(id: string): BlockUiFamily {
  if (id.startsWith("start-")) return "start";
  if (["if-otherwise", "repeat-n", "repeat-while", "stop-repeat", "wait"].includes(id)) return "control";
  if (id.startsWith("compare-")) return "comparison";
  if (id.startsWith("logic-")) return "logic";
  if (id.startsWith("calculate-") || ["number", "percentage", "money", "quantity", "trading-days", "calendar-days", "elapsed-time", "random-value"].includes(id)) return "arithmetic";
  if (["asset-value", "trailing-return", "sma", "ema"].includes(id)) return "market_value";
  if (id === "weighted-score") return "score";
  if (["asset-reference", "group-reference", "subgroup-reference"].includes(id)) return "reference";
  if (id === "choose-group") return "choose";
  if (["invest", "sell"].includes(id)) return "trade";
  if (id === "rebalance") return "rebalance";
  if (["send-signal", "signal-reference"].includes(id)) return "signal";
  if (["create-function", "call-function", "import-function", "function-input", "function-return"].includes(id)) return "function";
  return "data";
}

const ADVANCED: Record<BlockUiFamily, string[]> = {
  start: ["evaluation boundary", "clock availability"],
  control: ["Unknown policy", "execution safety"],
  comparison: ["missing-data policy", "unit compatibility"],
  logic: ["T/F/U diagnostics"],
  arithmetic: ["numeric unit", "deterministic replay"],
  market_value: ["provider readiness", "missing-data policy", "completed-bar boundary"],
  score: ["component weights", "normalization", "tie handling"],
  reference: ["stable object identity", "dependency count"],
  choose: ["shortage policy", "fallback", "tie-break", "internal weighting"],
  trade: ["order capability", "cash semantics", "internal Group weighting"],
  rebalance: ["allocation specification", "portfolio-weight validation"],
  signal: ["delivery order", "reentrancy", "replay"],
  data: ["lifecycle", "mutation capability", "checkpoint integrity"],
  function: ["typed signature", "purity", "side effects", "version dependencies"],
};

const WORKSPACE: Partial<Record<BlockUiFamily, string[]>> = {
  reference: ["Group membership", "instrument ordering", "provider metadata", "charts"],
  choose: ["source Group definition"],
  function: ["large reusable function graph"],
};

const SUMMARY: Partial<Record<string, string>> = {
  "start-daily": "Every daily close", "start-weekly": "Every weekly close", "start-monthly": "Every monthly close", "start-signal": "When signal is received",
  "if-otherwise": "IF / OTHERWISE", "trailing-return": "Asset return over lookback", sma: "Simple moving average", ema: "Exponential moving average",
  "weighted-score": "Weighted Score", "group-reference": "Named Group", "subgroup-reference": "Named Subgroup", "choose-group": "Choose a ranked Subgroup",
  invest: "Buy target by amount", sell: "Sell target by amount", rebalance: "Rebalance target to weight", "send-signal": "Send signal",
};

export const BLOCK_UI_CONTRACTS: BlockUiContract[] = ENTRY_BLOCK_DEFINITIONS.map((definition) => {
  const family = familyFor(definition.id);
  return {
    blockType: definition.id,
    family,
    semanticRole: definition.description,
    requiredVisibleInputs: definition.slots.map((slot) => slot.name),
    optionalVisibleInputs: family === "choose" ? ["FALLBACK"] : [],
    advancedInspectorFields: ADVANCED[family],
    dedicatedWorkspaceFields: WORKSPACE[family] ?? [],
    connectionType: { shape: definition.shape, output: definition.output ?? null },
    summaryLabel: SUMMARY[definition.id] ?? definition.label,
    expandedSummary: `${SUMMARY[definition.id] ?? definition.label}. ${definition.description}`,
    validationRules: definition.slots.map((slot) => `${slot.name} accepts ${slot.accepts.join(" | ")}`),
    capabilityRequirements: definition.execution,
    translationMapping: definition.execution === "draft_only" ? "Working Draft only" : `validated active graph → typed authoring intent → SemanticProgramV2 (${definition.id})`,
  };
});

export function blockUiContract(blockType: string): BlockUiContract | null {
  return BLOCK_UI_CONTRACTS.find((contract) => contract.blockType === blockType) ?? null;
}
