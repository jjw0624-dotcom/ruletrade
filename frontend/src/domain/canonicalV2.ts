export type DailySubjectKind = "asset" | "candidate" | "group_members";
export type DailyValueKind =
  | "literal" | "observe" | "current" | "history" | "trailing_return"
  | "sma" | "ema" | "rsi_wilder_lean_compat" | "realized_volatility"
  | "reduce" | "arithmetic" | "absolute";

export interface DailyValueNode {
  semantic_id: string;
  kind: DailyValueKind;
  operands: DailyValueNode[];
  subject_kind?: DailySubjectKind | null;
  subject_id?: string | null;
  binding_id?: string | null;
  field?: "open" | "high" | "low" | "close" | "volume" | null;
  basis?: "raw" | "adjusted" | "raw_shares" | null;
  quantity?: string | null;
  unit?: string | null;
  refinement?: string | null;
  value?: string | number | null;
  observations?: number | null;
  skip?: number;
  axis?: "asset" | "time" | null;
  reduction?: "mean" | "median" | "min" | "max" | "std" | null;
  missing_policy?: "require_all" | "skip_with_coverage";
  minimum_count?: number;
  minimum_fraction?: string | number;
  arithmetic?: "add" | "subtract" | "multiply" | "divide" | null;
}

export interface ComparisonV2 {
  kind: "comparison";
  semantic_id: string;
  operator: "lt" | "lte" | "eq" | "neq" | "gte" | "gt";
  left: DailyValueNode;
  right: DailyValueNode;
}

export interface BooleanGroupV2 {
  kind: "all" | "any";
  semantic_id: string;
  children: ConditionV2[];
}

export interface NotConditionV2 {
  kind: "not";
  semantic_id: string;
  child: ConditionV2;
}

export type ConditionV2 = ComparisonV2 | BooleanGroupV2 | NotConditionV2;

export interface CanonicalStrategyV2 {
  api_version: "ruletrade.dev/strategy/v2";
  semantic_profile: "profile-a/daily-compositional-core@1";
  metadata: { name: string; description: string; tags: string[] };
  definitions: {
    asset_sets: Array<{ id: string; assets: string[] }>;
    groups: Array<{ id: string; name: string; asset_set_ref: string; description: string }>;
    asset_axis: { name: "asset"; domain_id: string; coordinate_policy: string };
  };
  operator_lock: Record<string, string>;
  selection: {
    semantic_id: string;
    universe_id: string;
    binding: { id: string; domain_id: string };
    eligibility: ConditionV2 | null;
    ranking: DailyValueNode;
    direction: "ascending" | "descending";
    count: number;
    shortage_policy: "choose_all" | "require_full";
    fallback_asset: string | null;
  };
  predicate: ConditionV2 | null;
}

export type V2AuthoringOperation =
  | { kind: "set_selection_universe"; universe_id: string }
  | { kind: "set_eligibility_condition"; condition: ConditionV2 | null }
  | { kind: "set_ranking_value"; value: DailyValueNode }
  | { kind: "set_ranking_direction"; direction: "ascending" | "descending" }
  | { kind: "set_selection_count"; count: number }
  | { kind: "set_shortage_policy"; shortage_policy: "choose_all" | "require_full" }
  | { kind: "set_selection_fallback"; fallback_asset: string | null }
  | { kind: "set_predicate"; predicate: ConditionV2 | null };

export function isCanonicalV2(value: { api_version?: string }): value is CanonicalStrategyV2 {
  return value.api_version === "ruletrade.dev/strategy/v2";
}
