import type { ToolboxCategory } from "./builderProjection";
import type { EntryBlockCategory } from "./entryStyleGrammar";

export type ProductToolAvailability =
  | "ready"
  | "draftable"
  | "needs_context"
  | "unsupported_execution"
  | "invalid_here"
  | "unavailable";

export type ProgramToolId =
  | "investment" | "split" | "group" | "sleeve" | "assets"
  | "if" | "qualification" | "choose-assets" | "allocation" | "schedule"
  | "cooldown" | "fallback" | "logic-condition" | "logic-control"
  | "data-score" | "logic-selection" | "state-event" | "logic-allocation"
  | "logic-timing" | "intent-market-regime" | "intent-split" | "intent-score"
  | "intent-temporal" | "intent-multiclock" | "intent-market-assets"
  | "intent-split-allocation" | "intent-score-assets"
  | "intent-breakout-asset" | "intent-risk-first";

export interface ProductToolDescriptor {
  id: ProgramToolId;
  category: ToolboxCategory | EntryBlockCategory;
  label: string;
  description: string;
  disabled: boolean;
  availability: ProductToolAvailability;
}

export interface ProgramToolContext {
  hasDraft: boolean;
  groupCount: number;
  hasGroup: boolean;
  hasGroupAssets: boolean;
  groupAssetCount: number;
  hasSelection: boolean;
  selectionMatchesGroup: boolean;
  hasSelectionAllocation: boolean;
  hasPortfolioSplit: boolean;
  hasAllocationRoot: boolean;
  hasGuardedAllocation: boolean;
  allocationDescription: string;
}

export function deriveProgramToolCapabilities(context: ProgramToolContext): ProductToolDescriptor[] {
  const d = context.hasDraft;
  const selection = context.hasSelection;
  const group = context.hasGroup;
  const groupAssets = context.hasGroupAssets;
  const hasAssets = context.groupAssetCount > 0;
  return [
    { id: "investment", category: "Capital", label: "Investment", description: "Connect Portfolio capital to an Asset, Group, or selected Subgroup.", availability: "draftable", disabled: d },
    { id: "split", category: "Capital", label: "Split", description: context.hasPortfolioSplit ? "This Portfolio already has a Split; edit its Investments instead." : "Split capital across two investments.", availability: context.hasPortfolioSplit ? "invalid_here" : context.groupCount < 2 ? "needs_context" : "ready", disabled: context.groupCount < 2 || context.hasPortfolioSplit },
    { id: "group", category: "Destination", label: "Group", description: "Create a reusable candidate universe without allocating capital.", availability: "draftable", disabled: d },
    { id: "sleeve", category: "Destination", label: "Sleeve", description: "Legacy compatibility label. New Strategies use explicit Group, Subgroup, and Investment objects.", availability: "invalid_here", disabled: true },
    { id: "assets", category: "Destination", label: "Assets", description: groupAssets ? "Edit this Group's members." : "Create a Group and define its members.", availability: groupAssets ? "ready" : "draftable", disabled: d },
    { id: "if", category: "Routing", label: "IF / OTHERWISE", description: "Draft conditional capital routing here. Execution support is assessed only after the semantic branches are complete.", availability: "draftable", disabled: d },
    { id: "qualification", category: "Routing", label: "Qualification", description: context.selectionMatchesGroup ? "Configure which Group members qualify." : group ? "Create a selected Subgroup with Qualification." : "Draft Choose now and attach a Group later.", availability: group ? "ready" : "draftable", disabled: d },
    { id: "choose-assets", category: "Routing", label: "Choose", description: context.selectionMatchesGroup ? "Edit this Group's selected Subgroup." : "Rank Group members and produce a named Subgroup.", availability: group ? "ready" : "draftable", disabled: d },
    { id: "allocation", category: "Allocation", label: "Allocation", description: selection ? context.allocationDescription : "Start with an allocation intent; complete assets and timing before commit.", availability: "ready", disabled: false },
    { id: "schedule", category: "Timing", label: "Rebalance", description: context.hasAllocationRoot ? "Configure the Portfolio rebalance cadence." : "Start with timing, then complete an Investment.", availability: "ready", disabled: false },
    { id: "cooldown", category: "Behavior", label: "Cooldown", description: "Cooldown meaning is preserved by the semantic model but is not authorable or production-lowerable in this profile yet.", availability: "unsupported_execution", disabled: true },
    { id: "fallback", category: "Behavior", label: "Fallback", description: selection ? "Choose the asset used when too few qualify." : "Choose assets first.", availability: selection ? "ready" : "needs_context", disabled: !selection },
    { id: "logic-condition", category: "Logic", label: "Condition", description: selection ? "Edit a nested Qualification Condition." : "Create a Subgroup with a Qualification Condition.", availability: group ? "ready" : "draftable", disabled: d },
    { id: "logic-control", category: "Logic", label: "IF / OTHERWISE", description: "Create an unfinished condition, then connect complete statement blocks to its branches.", availability: "draftable", disabled: d },
    { id: "data-score", category: "Data", label: "Value / Score", description: selection ? "Edit the Selection ranking Value or weighted Score." : "Create a Selection before adding its ranking Value.", availability: selection ? "ready" : "needs_context", disabled: !selection },
    { id: "logic-selection", category: "Selection", label: "Rank and select", description: selection ? "Edit the committed ranking and Top N Subgroup." : "Create a ranked Subgroup from a Group.", availability: group ? "ready" : "draftable", disabled: d },
    { id: "state-event", category: "State", label: "Event → State", description: hasAssets ? "Draft an Event and atomic State transition. Runtime support is assessed after commit." : "Choose Group assets first.", availability: hasAssets ? "draftable" : "needs_context", disabled: !hasAssets },
    { id: "logic-allocation", category: "Allocation", label: "Allocation / Policy", description: context.hasGuardedAllocation ? "Inspect the committed policy precedence." : context.hasSelectionAllocation ? "Inspect selected-asset allocation." : "Add equal allocation for the current Selection.", availability: selection ? "ready" : "needs_context", disabled: !selection },
    { id: "logic-timing", category: "Timing", label: "Clock / Rebalance", description: "Edit the semantic evaluation clock.", availability: context.hasAllocationRoot ? "ready" : "needs_context", disabled: !context.hasAllocationRoot },
    { id: "intent-market-regime", category: "Logic", label: "Market regime rotation", description: "Author explicit trend and OTHERWISE routes; this composition is not production-lowerable yet.", availability: "unsupported_execution", disabled: d },
    { id: "intent-split", category: "Capital", label: "Growth + Defensive", description: "Author a 70/30 parallel sleeve strategy; this composition is not production-lowerable yet.", availability: "unsupported_execution", disabled: d },
    { id: "intent-score", category: "Data", label: "Weighted Score", description: "Rank a universe with explicit weighted return horizons.", availability: "ready", disabled: d },
    { id: "intent-temporal", category: "State", label: "Breakout sequence", description: "Draft breakout, retest, confirmation, memory and expiry together.", availability: "ready", disabled: d },
    { id: "intent-multiclock", category: "State", label: "Weekly context + daily signal", description: "Use completed weekly context with daily action and risk precedence.", availability: "ready", disabled: d },
    { id: "intent-market-assets", category: "Destination", label: "Rotation universe", description: "Start market-regime rotation by choosing its explicit assets.", availability: "ready", disabled: d },
    { id: "intent-split-allocation", category: "Allocation", label: "Growth / Defensive 70 / 30", description: "Start from portfolio shares, then complete both capital routes.", availability: "ready", disabled: d },
    { id: "intent-score-assets", category: "Destination", label: "Score universe", description: "Choose assets first, then define the Score and Selection.", availability: "ready", disabled: d },
    { id: "intent-breakout-asset", category: "Destination", label: "Breakout asset", description: "Choose the observed asset before defining the temporal sequence.", availability: "ready", disabled: d },
    { id: "intent-risk-first", category: "Behavior", label: "Risk policy first", description: "Define Unknown risk behavior before clocks and signals.", availability: "ready", disabled: d },
  ];
}
