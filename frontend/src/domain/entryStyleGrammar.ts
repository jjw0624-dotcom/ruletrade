export const ENTRY_BLOCK_CATEGORIES = [
  "Start", "Control", "Logic", "Calculate", "Action", "Assets", "Data", "Functions",
] as const;

export type EntryBlockCategory = typeof ENTRY_BLOCK_CATEGORIES[number];
export type EntryValueType =
  | "Statement" | "Truth" | "Number" | "Percentage" | "Money" | "Quantity"
  | "Duration" | "Asset" | "Group" | "Subgroup" | "Value" | "Signal"
  | "Function" | "State" | "AssetSet" | "AssetPredicate" | "CandidateValue";
export type EntryExecutionStatus = "verified" | "draft_only" | "needs_context";

export interface EntryBlockSlot {
  name: string;
  label: string;
  accepts: EntryValueType[];
}

export interface EntryBlockDefinition {
  id: string;
  category: EntryBlockCategory;
  label: string;
  description: string;
  shape: "statement" | "value" | "hat";
  output?: EntryValueType;
  slots: EntryBlockSlot[];
  execution: EntryExecutionStatus;
}

const d = (value: EntryBlockDefinition) => value;

/** Product grammar. Draft-only means structurally safe to compose, not executable. */
export const ENTRY_BLOCK_DEFINITIONS: EntryBlockDefinition[] = [
  d({ id: "start-daily", category: "Start", label: "Every daily close", description: "Start at each completed daily close.", shape: "hat", slots: [], execution: "verified" }),
  d({ id: "start-weekly", category: "Start", label: "Every weekly close", description: "Draft a completed-week context trigger.", shape: "hat", slots: [], execution: "draft_only" }),
  d({ id: "start-monthly", category: "Start", label: "Every monthly close", description: "Start at each completed monthly close.", shape: "hat", slots: [], execution: "verified" }),
  d({ id: "start-signal", category: "Start", label: "When signal is received", description: "Signal ordering remains draft-only until its delivery contract is verified.", shape: "hat", slots: [{ name: "SIGNAL", label: "signal", accepts: ["Signal"] }], execution: "draft_only" }),
  d({ id: "start-init", category: "Start", label: "On strategy initialization", description: "Runs once when strategy state is initialized.", shape: "hat", slots: [], execution: "draft_only" }),
  d({ id: "if-otherwise", category: "Control", label: "IF / OTHERWISE", description: "Route statements using a three-valued condition.", shape: "statement", slots: [{ name: "CONDITION", label: "if", accepts: ["Truth"] }], execution: "verified" }),
  d({ id: "repeat-n", category: "Control", label: "Repeat N times", description: "Bounded loop; preserved as a draft until runtime lowering is defined.", shape: "statement", slots: [{ name: "COUNT", label: "times", accepts: ["Number", "Quantity"] }], execution: "draft_only" }),
  d({ id: "repeat-while", category: "Control", label: "Repeat while", description: "Draft-only to prevent an uncontrolled execution loop.", shape: "statement", slots: [{ name: "CONDITION", label: "while", accepts: ["Truth"] }], execution: "draft_only" }),
  d({ id: "stop-repeat", category: "Control", label: "Stop repeating", description: "Stops the nearest loop once loop semantics are supported.", shape: "statement", slots: [], execution: "draft_only" }),
  d({ id: "wait", category: "Control", label: "Wait", description: "Trading/calendar-day identity is carried by the Duration value.", shape: "statement", slots: [{ name: "DURATION", label: "for", accepts: ["Duration"] }], execution: "draft_only" }),
  ...([">", "<", "="] as const).map((operator) => d({ id: `compare-${operator === ">" ? "gt" : operator === "<" ? "lt" : "eq"}`, category: "Logic", label: `A ${operator} B`, description: "Compare compatible values.", shape: "value", output: "Truth", slots: [{ name: "A", label: "A", accepts: ["Number", "Percentage", "Money", "Quantity", "Value"] }, { name: "B", label: "B", accepts: ["Number", "Percentage", "Money", "Quantity", "Value"] }], execution: "verified" })),
  ...(["and", "or"] as const).map((operator) => d({ id: `logic-${operator}`, category: "Logic", label: `A ${operator.toUpperCase()} B`, description: "Compose truth values without collapsing Unknown.", shape: "value", output: "Truth", slots: [{ name: "A", label: "A", accepts: ["Truth"] }, { name: "B", label: "B", accepts: ["Truth"] }], execution: "verified" })),
  d({ id: "logic-not", category: "Logic", label: "NOT A", description: "Negate a truth value.", shape: "value", output: "Truth", slots: [{ name: "A", label: "A", accepts: ["Truth"] }], execution: "verified" }),
  d({ id: "logic-is-true", category: "Logic", label: "Is A true?", description: "Test a truth-valued expression without collapsing Unknown.", shape: "value", output: "Truth", slots: [{ name: "A", label: "A", accepts: ["Truth"] }], execution: "verified" }),
  d({ id: "asset-predicate-and", category: "Logic", label: "asset predicate A AND B", description: "Combine two predicates evaluated for the same candidate asset.", shape: "value", output: "AssetPredicate", slots: [{ name: "A", label: "A", accepts: ["AssetPredicate"] }, { name: "B", label: "B", accepts: ["AssetPredicate"] }], execution: "draft_only" }),
  d({ id: "asset-predicate-or", category: "Logic", label: "asset predicate A OR B", description: "Combine two predicates evaluated for the same candidate asset.", shape: "value", output: "AssetPredicate", slots: [{ name: "A", label: "A", accepts: ["AssetPredicate"] }, { name: "B", label: "B", accepts: ["AssetPredicate"] }], execution: "draft_only" }),
  d({ id: "asset-predicate-not", category: "Logic", label: "NOT asset predicate", description: "Negate a predicate evaluated for each candidate asset.", shape: "value", output: "AssetPredicate", slots: [{ name: "A", label: "A", accepts: ["AssetPredicate"] }], execution: "draft_only" }),
  d({ id: "candidate-compare", category: "Logic", label: "candidate A > B", description: "Compare a candidate-scoped value without treating it as a strategy-wide truth value.", shape: "value", output: "AssetPredicate", slots: [{ name: "A", label: "A", accepts: ["CandidateValue"] }, { name: "B", label: "B", accepts: ["Number", "Percentage", "Money", "Quantity", "Value"] }], execution: "draft_only" }),
  d({ id: "asset-set-any", category: "Logic", label: "any asset matches", description: "Return a strategy-level truth value when any asset in a set matches its predicate.", shape: "value", output: "Truth", slots: [{ name: "ASSETS", label: "in", accepts: ["AssetSet"] }, { name: "PREDICATE", label: "matches", accepts: ["AssetPredicate"] }], execution: "draft_only" }),
  d({ id: "asset-set-all", category: "Logic", label: "all assets match", description: "Return a strategy-level truth value when every asset in a set matches its predicate.", shape: "value", output: "Truth", slots: [{ name: "ASSETS", label: "in", accepts: ["AssetSet"] }, { name: "PREDICATE", label: "matches", accepts: ["AssetPredicate"] }], execution: "draft_only" }),
  d({ id: "asset-set-n-of-m", category: "Logic", label: "at least N assets match", description: "Return a strategy-level truth value using a typed N-of-M aggregate predicate.", shape: "value", output: "Truth", slots: [{ name: "ASSETS", label: "in", accepts: ["AssetSet"] }, { name: "PREDICATE", label: "match", accepts: ["AssetPredicate"] }, { name: "COUNT", label: "at least", accepts: ["Number", "Quantity"] }], execution: "draft_only" }),
  ...(["add", "subtract", "multiply", "divide", "power"] as const).map((kind) => d({ id: `calculate-${kind}`, category: "Calculate", label: ({ add: "A + B", subtract: "A − B", multiply: "A × B", divide: "A ÷ B", power: "A to the power B" } as const)[kind], description: "Calculate a numeric value.", shape: "value", output: "Number", slots: [{ name: "A", label: "A", accepts: ["Number", "Percentage", "Money", "Quantity", "Value"] }, { name: "B", label: "B", accepts: ["Number", "Percentage", "Money", "Quantity", "Value"] }], execution: "verified" })),
  d({ id: "number", category: "Calculate", label: "Number", description: "A numeric literal.", shape: "value", output: "Number", slots: [], execution: "verified" }),
  d({ id: "percentage", category: "Calculate", label: "Percentage", description: "A fraction such as 25%.", shape: "value", output: "Percentage", slots: [], execution: "verified" }),
  d({ id: "money", category: "Calculate", label: "Money amount", description: "A fixed money amount; it is never interpreted as a target weight.", shape: "value", output: "Money", slots: [], execution: "draft_only" }),
  d({ id: "quantity", category: "Calculate", label: "Asset quantity", description: "An explicit unit quantity where the execution profile supports it.", shape: "value", output: "Quantity", slots: [], execution: "draft_only" }),
  d({ id: "trading-days", category: "Calculate", label: "Trading days", description: "A duration measured in completed trading sessions.", shape: "value", output: "Duration", slots: [], execution: "draft_only" }),
  d({ id: "calendar-days", category: "Calculate", label: "Calendar days", description: "A duration measured in calendar days.", shape: "value", output: "Duration", slots: [], execution: "draft_only" }),
  d({ id: "asset-value", category: "Calculate", label: "Asset value", description: "Read a completed market-data value for an asset.", shape: "value", output: "Value", slots: [{ name: "ASSET", label: "asset", accepts: ["Asset"] }], execution: "verified" }),
  d({ id: "trailing-return", category: "Calculate", label: "Trailing return", description: "Return over a typed lookback duration.", shape: "value", output: "Value", slots: [{ name: "ASSET", label: "asset", accepts: ["Asset"] }, { name: "DURATION", label: "period", accepts: ["Duration", "Number"] }], execution: "verified" }),
  d({ id: "sma", category: "Calculate", label: "SMA", description: "Simple moving average.", shape: "value", output: "Value", slots: [{ name: "VALUE", label: "value", accepts: ["Value"] }, { name: "DURATION", label: "period", accepts: ["Duration", "Number"] }], execution: "verified" }),
  d({ id: "ema", category: "Calculate", label: "EMA", description: "Exponential moving average remains draft-only.", shape: "value", output: "Value", slots: [{ name: "VALUE", label: "value", accepts: ["Value"] }, { name: "DURATION", label: "period", accepts: ["Duration", "Number"] }], execution: "draft_only" }),
  d({ id: "weighted-score", category: "Calculate", label: "Weighted Score", description: "Combine supported values using explicit weights.", shape: "value", output: "Value", slots: [{ name: "VALUE", label: "values", accepts: ["Value"] }], execution: "verified" }),
  d({ id: "candidate-close", category: "Calculate", label: "Candidate close", description: "Read the completed close for the asset currently being evaluated by an AssetSet operation.", shape: "value", output: "CandidateValue", slots: [], execution: "draft_only" }),
  d({ id: "candidate-return", category: "Calculate", label: "Candidate return", description: "Read a completed trailing return for the asset currently being evaluated by an AssetSet operation.", shape: "value", output: "CandidateValue", slots: [{ name: "DURATION", label: "period", accepts: ["Duration", "Number"] }], execution: "draft_only" }),
  d({ id: "candidate-rsi", category: "Calculate", label: "Candidate RSI", description: "Read completed RSI for the asset currently being evaluated by an AssetSet operation.", shape: "value", output: "CandidateValue", slots: [{ name: "DURATION", label: "period", accepts: ["Duration", "Number"] }], execution: "draft_only" }),
  d({ id: "asset-set-count", category: "Calculate", label: "AssetSet count", description: "Count the members of an AssetSet without requiring a capital allocation.", shape: "value", output: "Number", slots: [{ name: "ASSETS", label: "of", accepts: ["AssetSet"] }], execution: "draft_only" }),
  d({ id: "elapsed-time", category: "Calculate", label: "Elapsed time", description: "Read deterministic elapsed strategy time.", shape: "value", output: "Duration", slots: [], execution: "draft_only" }),
  d({ id: "random-value", category: "Calculate", label: "Random value", description: "Draft-only until seeded replay semantics are part of execution.", shape: "value", output: "Number", slots: [], execution: "draft_only" }),
  d({ id: "invest", category: "Action", label: "Invest [A] by [B]", description: "Use available cash to buy an Asset or AssetSet by a typed amount; AssetSet weighting must be explicit before execution.", shape: "statement", slots: [{ name: "TARGET", label: "invest", accepts: ["Asset", "AssetSet"] }, { name: "AMOUNT", label: "by", accepts: ["Money", "Percentage", "Quantity"] }], execution: "needs_context" }),
  d({ id: "sell", category: "Action", label: "Sell [A] by [B]", description: "Reduce an Asset or AssetSet position by a typed amount.", shape: "statement", slots: [{ name: "TARGET", label: "sell", accepts: ["Asset", "AssetSet"] }, { name: "AMOUNT", label: "by", accepts: ["Money", "Percentage", "Quantity"] }], execution: "draft_only" }),
  d({ id: "rebalance", category: "Action", label: "Rebalance target to weight", description: "Adjust existing portfolio capital to an explicit portfolio weight. AssetSet weighting remains explicit.", shape: "statement", slots: [{ name: "TARGET", label: "target", accepts: ["Asset", "AssetSet"] }, { name: "WEIGHT", label: "weight", accepts: ["Percentage"] }], execution: "verified" }),
  d({ id: "send-signal", category: "Action", label: "Send signal", description: "An internal deterministic signal, not an external notification.", shape: "statement", slots: [{ name: "SIGNAL", label: "signal", accepts: ["Signal"] }], execution: "draft_only" }),
  d({ id: "asset-reference", category: "Assets", label: "Asset reference", description: "Reference one instrument by stable identity.", shape: "value", output: "Asset", slots: [], execution: "verified" }),
  d({ id: "group-reference", category: "Assets", label: "Group reference", description: "Reference a reusable candidate collection.", shape: "value", output: "Group", slots: [], execution: "verified" }),
  d({ id: "create-group", category: "Assets", label: "Create Group", description: "Open a reusable Group draft without allocating capital.", shape: "value", output: "Group", slots: [], execution: "verified" }),
  d({ id: "choose-group", category: "Assets", label: "Choose from Group", description: "Produce a dynamic named Subgroup; this does not allocate capital.", shape: "value", output: "Subgroup", slots: [{ name: "GROUP", label: "from", accepts: ["Group", "Subgroup"] }, { name: "CONDITION", label: "where", accepts: ["Truth"] }, { name: "SCORE", label: "rank by", accepts: ["Value"] }, { name: "COUNT", label: "take", accepts: ["Number", "Quantity"] }], execution: "verified" }),
  d({ id: "subgroup-reference", category: "Assets", label: "Subgroup reference", description: "Reference a named dynamic selection by stable identity.", shape: "value", output: "Subgroup", slots: [], execution: "verified" }),
  d({ id: "filter-assets", category: "Assets", label: "Filter AssetSet", description: "Produce an anonymous AssetSet by applying a per-asset predicate. This does not select or allocate capital.", shape: "value", output: "AssetSet", slots: [{ name: "ASSETS", label: "from", accepts: ["AssetSet"] }, { name: "PREDICATE", label: "where", accepts: ["AssetPredicate"] }], execution: "draft_only" }),
  d({ id: "top-n-assets", category: "Assets", label: "Top N AssetSet", description: "Produce an anonymous top-N AssetSet from a candidate-scoped ranking value.", shape: "value", output: "AssetSet", slots: [{ name: "ASSETS", label: "from", accepts: ["AssetSet"] }, { name: "SCORE", label: "by", accepts: ["CandidateValue"] }, { name: "COUNT", label: "take", accepts: ["Number", "Quantity"] }], execution: "draft_only" }),
  d({ id: "bottom-n-assets", category: "Assets", label: "Bottom N AssetSet", description: "Produce an anonymous bottom-N AssetSet from a candidate-scoped ranking value.", shape: "value", output: "AssetSet", slots: [{ name: "ASSETS", label: "from", accepts: ["AssetSet"] }, { name: "SCORE", label: "by", accepts: ["CandidateValue"] }, { name: "COUNT", label: "take", accepts: ["Number", "Quantity"] }], execution: "draft_only" }),
  d({ id: "random-select-assets", category: "Assets", label: "Random N AssetSet", description: "Select exactly N assets with an explicit deterministic seed and redraw scope in the Inspector.", shape: "value", output: "AssetSet", slots: [{ name: "ASSETS", label: "from", accepts: ["AssetSet"] }, { name: "COUNT", label: "take", accepts: ["Number", "Quantity"] }], execution: "draft_only" }),
  d({ id: "random-filter-assets", category: "Assets", label: "Random Filter AssetSet", description: "Independently retain each asset with an explicit probability, seed and redraw scope.", shape: "value", output: "AssetSet", slots: [{ name: "ASSETS", label: "from", accepts: ["AssetSet"] }, { name: "PROBABILITY", label: "retain probability", accepts: ["Percentage"] }], execution: "draft_only" }),
  d({ id: "asset-set-union", category: "Assets", label: "Union AssetSets", description: "Produce the set union without changing either source set.", shape: "value", output: "AssetSet", slots: [{ name: "A", label: "A", accepts: ["AssetSet"] }, { name: "B", label: "B", accepts: ["AssetSet"] }], execution: "draft_only" }),
  d({ id: "asset-set-intersection", category: "Assets", label: "Intersect AssetSets", description: "Produce the set intersection without changing either source set.", shape: "value", output: "AssetSet", slots: [{ name: "A", label: "A", accepts: ["AssetSet"] }, { name: "B", label: "B", accepts: ["AssetSet"] }], execution: "draft_only" }),
  d({ id: "asset-set-difference", category: "Assets", label: "Subtract AssetSets", description: "Produce the members of the first set that are not in the second set.", shape: "value", output: "AssetSet", slots: [{ name: "A", label: "A", accepts: ["AssetSet"] }, { name: "B", label: "B", accepts: ["AssetSet"] }], execution: "draft_only" }),
  d({ id: "create-variable", category: "Data", label: "Create variable", description: "Create a draft-local typed value.", shape: "statement", slots: [{ name: "VALUE", label: "value", accepts: ["Number", "Percentage", "Money", "Quantity", "Duration", "Asset", "Group", "Subgroup", "Value", "Truth", "State"] }], execution: "draft_only" }),
  d({ id: "read-variable", category: "Data", label: "Read variable", description: "Read a draft-local value.", shape: "value", output: "Value", slots: [], execution: "draft_only" }),
  d({ id: "set-variable", category: "Data", label: "Set variable", description: "Set a draft-local value.", shape: "statement", slots: [{ name: "VALUE", label: "to", accepts: ["Number", "Percentage", "Money", "Quantity", "Duration", "Value", "Truth", "State"] }], execution: "draft_only" }),
  d({ id: "remember-value", category: "Data", label: "Remembered value", description: "Persist a value across evaluation boundaries.", shape: "value", output: "Value", slots: [], execution: "verified" }),
  d({ id: "state", category: "Data", label: "State", description: "Reference named strategy state with explicit lifecycle.", shape: "value", output: "State", slots: [], execution: "verified" }),
  d({ id: "signal-reference", category: "Data", label: "Signal", description: "Create or reference a named internal signal by stable identity.", shape: "value", output: "Signal", slots: [], execution: "draft_only" }),
  d({ id: "create-function", category: "Functions", label: "Create function", description: "Define a reusable typed strategy fragment.", shape: "statement", slots: [], execution: "draft_only" }),
  d({ id: "call-function", category: "Functions", label: "Call function", description: "Call a compatible function by stable identity and version.", shape: "value", output: "Function", slots: [], execution: "draft_only" }),
  d({ id: "import-function", category: "Functions", label: "Import shared function", description: "Preserve provenance and capability requirements; imported logic never executes implicitly.", shape: "value", output: "Function", slots: [], execution: "draft_only" }),
  d({ id: "function-input", category: "Functions", label: "Define inputs", description: "Define typed function inputs.", shape: "statement", slots: [], execution: "draft_only" }),
  d({ id: "function-return", category: "Functions", label: "Return typed result", description: "Return a value compatible with the function contract.", shape: "statement", slots: [{ name: "VALUE", label: "return", accepts: ["Truth", "Number", "Percentage", "Money", "Quantity", "Duration", "Asset", "Group", "Subgroup", "Value", "Signal", "State"] }], execution: "draft_only" }),
];

export const entryBlockDefinition = (id: string) => ENTRY_BLOCK_DEFINITIONS.find((item) => item.id === id) ?? null;

export function entryConnectionAccepts(accepted: EntryValueType[], actual: EntryValueType): boolean {
  if (accepted.includes(actual)) return true;
  if (accepted.includes("AssetSet") && ["Group", "Subgroup", "AssetSet"].includes(actual)) return true;
  return accepted.includes("Value") && ["Number", "Percentage", "Money", "Quantity", "Value"].includes(actual);
}

export function validEntryBlockConnection(parentDefinitionId: string, inputName: string | null, childDefinitionId: string): boolean {
  const parent = entryBlockDefinition(parentDefinitionId);
  const child = entryBlockDefinition(childDefinitionId);
  if (!parent || !child) return false;
  if (!inputName || inputName === "NEXT" || ["THEN", "ELSE", "DO"].includes(inputName)) {
    return child.shape !== "value";
  }
  const slot = parent.slots.find((item) => item.name === inputName);
  return Boolean(slot && child.output && entryConnectionAccepts(slot.accepts, child.output));
}
