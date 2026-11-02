import type { CanonicalStrategyV2, ProgramStatementV2, V2AuthoringOperation } from "./canonicalV2";

export type IntentStartPath = "asset_first" | "timing_first" | "flow_first" | "logic_first" | "allocation_first";
export type FinancialIntentRecipe = "single_asset" | "market_regime_rotation" | "split_portfolio" | "weighted_score" | "temporal_sequence" | "multi_clock_policy";
export type IntentTimingMeaning = "rebalance" | "contribution";

export interface FinancialIntentValues {
  assets: string[];
  asset: string | null;
  timeframe: "daily" | "monthly" | null;
  timingMeaning: IntentTimingMeaning | null;
  trendAsset: string | null;
  trendLookback: number | null;
  rankingLookback: number | null;
  count: number | null;
  fallbackAsset: string | null;
  growthWeight: number | null;
  defensiveAsset: string | null;
  shortObservations: number | null;
  longObservations: number | null;
  shortWeight: number | null;
  longWeight: number | null;
  missingPolicy: "require_all" | "renormalize_available" | null;
  breakoutThreshold: number | null;
  retestWindow: number | null;
  confirmationWindow: number | null;
  expiryState: string | null;
  weeklyContextAsset: string | null;
  weeklyThreshold: number | null;
  dailySignalAsset: string | null;
  dailyThreshold: number | null;
  unknownRiskPolicy: "block" | "allow" | null;
}

export interface FinancialIntentDraft {
  kind: "financial_intent";
  semanticId: string;
  recipe: FinancialIntentRecipe;
  startPath: IntentStartPath;
  values: FinancialIntentValues;
}

const emptyValues = (): FinancialIntentValues => ({
  assets: [], asset: null, timeframe: null, timingMeaning: null,
  trendAsset: null, trendLookback: null, rankingLookback: null, count: null,
  fallbackAsset: null, growthWeight: null, defensiveAsset: null,
  shortObservations: null, longObservations: null, shortWeight: null, longWeight: null,
  missingPolicy: null, breakoutThreshold: null, retestWindow: null,
  confirmationWindow: null, expiryState: null, weeklyContextAsset: null,
  weeklyThreshold: null, dailySignalAsset: null, dailyThreshold: null,
  unknownRiskPolicy: null,
});

const recipeDefaults: Record<Exclude<FinancialIntentRecipe, "single_asset">, Partial<FinancialIntentValues>> = {
  market_regime_rotation: { assets: ["QQQ", "VGT", "SOXX", "SCHG"], trendAsset: "QQQ", trendLookback: 200, rankingLookback: 126, count: 2, fallbackAsset: "TLT", timeframe: "monthly", timingMeaning: "rebalance" },
  split_portfolio: { assets: ["QQQ", "VGT", "SOXX", "SCHG"], growthWeight: .7, defensiveAsset: "IEF", rankingLookback: 126, count: 2, fallbackAsset: "TLT", timeframe: "monthly", timingMeaning: "rebalance" },
  weighted_score: { assets: ["QQQ", "VGT", "SOXX", "SCHG"], shortObservations: 21, longObservations: 63, shortWeight: .6, longWeight: .4, count: 3, timeframe: "monthly", timingMeaning: "rebalance", missingPolicy: "require_all" },
  temporal_sequence: { asset: "QQQ", breakoutThreshold: 12, retestWindow: 3, confirmationWindow: 2, expiryState: "expired", timeframe: "daily" },
  multi_clock_policy: { assets: ["QQQ", "VGT", "SOXX", "SCHG"], weeklyContextAsset: "QQQ", weeklyThreshold: 0, dailySignalAsset: "QQQ", dailyThreshold: 0, shortObservations: 21, longObservations: 63, shortWeight: .6, longWeight: .4, count: 2, fallbackAsset: "TLT", unknownRiskPolicy: "block" },
};

export function createFinancialIntentDraft(recipe: FinancialIntentRecipe, startPath: IntentStartPath, semanticId = `intent-${recipe}`): FinancialIntentDraft {
  const complete = recipe === "single_asset" ? {} : recipeDefaults[recipe];
  let seed: Partial<FinancialIntentValues> = complete;
  if (recipe === "market_regime_rotation" && startPath === "asset_first") seed = { assets: [] };
  if (recipe === "split_portfolio" && startPath === "allocation_first") seed = { growthWeight: .7, timeframe: "monthly", timingMeaning: "rebalance" };
  if (recipe === "weighted_score" && startPath === "asset_first") seed = { assets: [] };
  if (recipe === "temporal_sequence" && startPath === "asset_first") seed = { asset: "QQQ", timeframe: "daily" };
  if (recipe === "multi_clock_policy" && startPath === "logic_first") seed = { unknownRiskPolicy: "block" };
  return { kind: "financial_intent", semanticId, recipe, startPath, values: { ...emptyValues(), ...seed } };
}

export function updateFinancialIntentDraft(draft: FinancialIntentDraft, values: Partial<FinancialIntentValues>): FinancialIntentDraft {
  return { ...draft, values: { ...draft.values, ...values } };
}

export interface IntentReadiness {
  status: "incomplete" | "ready" | "unsupported";
  unresolved: string[];
  productMessage: string;
}

export function financialIntentReadiness(draft: FinancialIntentDraft): IntentReadiness {
  const v = draft.values;
  if (draft.recipe === "single_asset") {
    const unresolved = [!v.asset && "Choose one asset", !v.timeframe && "Choose a schedule", !v.timingMeaning && "Choose rebalance or new contribution"].filter(Boolean) as string[];
    if (unresolved.length) return { status: "incomplete", unresolved, productMessage: unresolved[0]! };
    if (v.timingMeaning === "contribution") return { status: "unsupported", unresolved: [], productMessage: "Recurring contributions are preserved as intent, but are not executable in the current strategy model." };
    return { status: "ready", unresolved: [], productMessage: `Hold ${v.asset} and rebalance ${v.timeframe}.` };
  }
  const required: Record<Exclude<FinancialIntentRecipe, "single_asset">, Array<[unknown, string]>> = {
    market_regime_rotation: [[v.assets.length, "Choose rotation assets"], [v.trendAsset, "Choose the trend asset"], [v.trendLookback, "Define the trend lookback"], [v.rankingLookback, "Define the ranking lookback"], [v.count, "Define Top N"], [v.fallbackAsset, "Choose the ELSE asset"]],
    split_portfolio: [[v.assets.length, "Choose Growth assets"], [v.growthWeight, "Define the Growth share"], [v.defensiveAsset, "Choose the Defensive asset"], [v.rankingLookback, "Define momentum"], [v.fallbackAsset, "Choose Growth shortage fallback"]],
    weighted_score: [[v.assets.length, "Choose Score assets"], [v.shortObservations, "Define the short horizon"], [v.longObservations, "Define the long horizon"], [v.shortWeight, "Define the short weight"], [v.longWeight, "Define the long weight"], [v.count, "Define Top N"], [v.missingPolicy, "Choose missing-data behavior"]],
    temporal_sequence: [[v.asset, "Choose the observed asset"], [v.breakoutThreshold, "Define breakout"], [v.retestWindow, "Define the retest window"], [v.confirmationWindow, "Define confirmation expiry"], [v.expiryState, "Define reset/expiry"]],
    multi_clock_policy: [[v.assets.length, "Choose the investment universe"], [v.weeklyContextAsset, "Choose weekly context"], [v.dailySignalAsset, "Choose daily signal"], [v.shortObservations, "Define Score horizons"], [v.fallbackAsset, "Choose defensive fallback"], [v.unknownRiskPolicy, "Define Unknown risk behavior"]],
  };
  const unresolved = required[draft.recipe].filter(([value]) => value === null || value === "" || value === false).map(([, label]) => label);
  if (unresolved.length) return { status: "incomplete", unresolved, productMessage: unresolved[0]! };
  if (new Set(v.assets).size !== v.assets.length) return { status: "incomplete", unresolved: ["Remove duplicate assets"], productMessage: "Each explicit-universe asset may appear only once." };
  if (draft.recipe === "market_regime_rotation" && (!v.trendAsset || !v.assets.includes(v.trendAsset) || v.count! > v.assets.length || v.trendLookback! < 2 || v.rankingLookback! < 2)) return { status: "incomplete", unresolved: ["Correct the trend, universe, lookbacks, or Top N"], productMessage: "Trend asset must be in the universe and Top N cannot exceed it." };
  if (draft.recipe === "split_portfolio" && (v.assets.length < 2 || v.growthWeight! <= 0 || v.growthWeight! >= 1 || v.rankingLookback! < 2)) return { status: "incomplete", unresolved: ["Correct Growth assets, sleeve shares, or ranking history"], productMessage: "Growth needs at least two assets, both sleeves need a positive share, and momentum needs at least two observations." };
  if (draft.recipe === "weighted_score" && (v.assets.length < 3 || v.shortObservations! < 2 || v.longObservations! < 2 || v.shortWeight! <= 0 || v.longWeight! <= 0 || v.count! > v.assets.length)) return { status: "incomplete", unresolved: ["Correct Score terms or Top N"], productMessage: "Score horizons and weights must be positive and Top N cannot exceed the universe." };
  if (draft.recipe === "temporal_sequence" && !(v.asset === "QQQ" && v.breakoutThreshold === 12 && v.retestWindow === 3 && v.confirmationWindow === 2 && v.expiryState === "expired")) return { status: "unsupported", unresolved: [], productMessage: "This variation remains a recoverable draft until its complete State and expiry semantics are formalized." };
  if (draft.recipe === "multi_clock_policy" && !(v.assets.join(",") === "QQQ,VGT,SOXX,SCHG" && v.weeklyContextAsset === "QQQ" && v.weeklyThreshold === 0 && v.dailySignalAsset === "QQQ" && v.dailyThreshold === 0 && v.shortObservations === 21 && v.longObservations === 63 && v.shortWeight === .6 && v.longWeight === .4 && v.count === 2 && v.fallbackAsset === "TLT" && v.unknownRiskPolicy === "block")) return { status: "unsupported", unresolved: [], productMessage: "This multi-clock variation remains a draft until its clock and risk-policy semantics are formalized." };
  return { status: "ready", unresolved: [], productMessage: "This fully specified intent is ready for semantic validation." };
}

export function compileFinancialIntent(draft: FinancialIntentDraft): V2AuthoringOperation | null {
  if (financialIntentReadiness(draft).status !== "ready") return null;
  const v = draft.values;
  switch (draft.recipe) {
    case "single_asset": return { kind: "commit_single_asset_intent", investment_id: "investment-1", investment_name: "Investment", asset_set_id: "investment-1-assets", asset: v.asset!, timeframe: v.timeframe!, timing_meaning: "rebalance" };
    case "market_regime_rotation": return { kind: "commit_market_regime_rotation_intent", assets: v.assets, trend_asset: v.trendAsset!, trend_lookback: v.trendLookback!, ranking_lookback: v.rankingLookback!, count: v.count!, fallback_asset: v.fallbackAsset!, timeframe: v.timeframe! };
    case "split_portfolio": return { kind: "commit_split_portfolio_intent", growth_assets: v.assets, growth_weight: v.growthWeight!, defensive_asset: v.defensiveAsset!, ranking_lookback: v.rankingLookback!, fallback_asset: v.fallbackAsset!, timeframe: v.timeframe! };
    case "weighted_score": return { kind: "commit_weighted_score_intent", assets: v.assets, short_observations: v.shortObservations!, long_observations: v.longObservations!, short_weight: v.shortWeight!, long_weight: v.longWeight!, count: v.count!, timeframe: v.timeframe!, missing_policy: v.missingPolicy! };
    case "temporal_sequence": return { kind: "commit_temporal_sequence_intent", asset: v.asset!, breakout_threshold: v.breakoutThreshold!, retest_window: v.retestWindow!, confirmation_window: v.confirmationWindow!, expiry_state: v.expiryState! };
    case "multi_clock_policy": return { kind: "commit_multi_clock_policy_intent", assets: v.assets, weekly_context_asset: v.weeklyContextAsset!, weekly_threshold: v.weeklyThreshold!, daily_signal_asset: v.dailySignalAsset!, daily_threshold: v.dailyThreshold!, score_observations: [v.shortObservations!, v.longObservations!], score_weights: [v.shortWeight!, v.longWeight!], count: v.count!, fallback_asset: v.fallbackAsset!, unknown_risk_policy: v.unknownRiskPolicy! };
  }
}

/** Compare normalized execution meaning, never draft IDs or visual geometry. */
export function normalizedIntentMeaning(strategy: CanonicalStrategyV2): unknown {
  const statements = (strategy.program?.statements ?? []) as ProgramStatementV2[];
  const meaning = { definitions: strategy.definitions, clocks: strategy.program?.clocks ?? [], initial_state: strategy.program?.initial_state ?? {}, statements };
  const identities = new Map<string, string>();
  const identityKeys = new Set(["semantic_id", "id", "output_id", "memory_id", "state_key"]);
  const collect = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(collect); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (identityKeys.has(key) && typeof child === "string" && !identities.has(child)) identities.set(child, `identity-${identities.size + 1}`);
      collect(child);
    }
  };
  collect(meaning);
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (typeof value === "string") return identities.get(value) ?? value;
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !["name", "description", "tags"].includes(key))
      .map(([key, child]) => [key, normalize(child)]));
  };
  return normalize(meaning);
}
