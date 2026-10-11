export type DailySubjectKind = "asset" | "candidate" | "group_members";
export type DailyValueKind =
  | "literal" | "observe" | "current" | "history" | "trailing_return"
  | "sma" | "ema" | "rsi_wilder_lean_compat" | "realized_volatility"
  | "reduce" | "arithmetic" | "absolute";

export interface DailyValueNode {
  semantic_id: string; kind: DailyValueKind; operands: DailyValueNode[];
  subject_kind?: DailySubjectKind | null; subject_id?: string | null; binding_id?: string | null;
  field?: "open" | "high" | "low" | "close" | "volume" | null;
  basis?: "raw" | "adjusted" | "raw_shares" | null;
  quantity?: string | null; unit?: string | null; refinement?: string | null;
  value?: string | number | null; observations?: number | null; skip?: number;
  axis?: "asset" | "time" | null; reduction?: "mean" | "median" | "min" | "max" | "std" | null;
  missing_policy?: "require_all" | "skip_with_coverage"; minimum_count?: number;
  minimum_fraction?: string | number; arithmetic?: "add" | "subtract" | "multiply" | "divide" | null;
}
export interface CrossSectionalValueV2 {
  kind: "cross_sectional"; semantic_id: string; source: DailyValueNode | ScoreValueV2;
  domain_id: string; transform: "rank" | "percentile" | "quantile" | "bucket" | "min_max" | "zscore";
  direction: "ascending" | "descending"; bins: number | null;
}
export interface CrossSectionalAggregateValueV2 {
  kind: "cross_sectional_aggregate"; semantic_id: string; source: DailyValueNode | ScoreValueV2;
  domain_id: string; reduction: "mean" | "median" | "min" | "max";
  coverage: "require_all" | "available_only";
}
export interface ScoreValueV2 {
  kind: "score"; semantic_id: string;
  terms: Array<{ semantic_id: string; value: DailyValueNode | CrossSectionalValueV2; weight: string | number }>;
  condition_terms: Array<{ semantic_id: string; condition: ConditionV2; true_points: string | number; false_points: string | number; unknown_points: string | number | null }>;
  missing_policy: "require_all" | "renormalize_available"; normalization: "none" | "sum_abs";
  clamp_min: string | number | null; clamp_max: string | number | null;
}
export interface RememberedValueV2 {
  kind: "remembered_value"; semantic_id: string; memory_id: string;
  quantity: string; unit: string; refinement: string | null;
}
export type ValueExpressionV2 =
  | DailyValueNode | CrossSectionalValueV2 | CrossSectionalAggregateValueV2 | ScoreValueV2 | RememberedValueV2
  | { kind: "event_relative" | "clocked_value" | "bars_since_event" | "bars_since_state" | "time_since_event" | "time_since_state"; semantic_id: string; [key: string]: unknown };

export interface ComparisonV2 {
  kind: "comparison"; semantic_id: string; operator: "lt" | "lte" | "eq" | "neq" | "gte" | "gt";
  left: ValueExpressionV2; right: ValueExpressionV2;
}
export interface BooleanGroupV2 { kind: "all" | "any"; semantic_id: string; children: ConditionV2[] }
export interface NotConditionV2 { kind: "not"; semantic_id: string; child: ConditionV2 }
export interface NOfMConditionV2 { kind: "n_of_m"; semantic_id: string; minimum_true: number; children: ConditionV2[] }
export interface StateConditionV2 { kind: "state_equals"; semantic_id: string; state_key: string; expected: string }
export interface EventWindowConditionV2 { kind: "event_window"; semantic_id: string; event_id: string; relation: "before" | "after" | "within"; observations: number | null }
export type ConditionV2 = ComparisonV2 | BooleanGroupV2 | NotConditionV2 | NOfMConditionV2 | StateConditionV2 | EventWindowConditionV2;

export interface SelectionV2 {
  semantic_id: string; universe_id: string; binding: { id: string; domain_id: string };
  eligibility: ConditionV2 | null; ranking: ValueExpressionV2; direction: "ascending" | "descending";
  count: number; shortage_policy: "choose_all" | "require_full"; fallback_asset: string | null;
}
export interface AllocationStatementV2 {
  kind: "allocate"; semantic_id: string; method: "equal" | "fixed" | "proportional_score" | "inverse_volatility";
  legs: Array<{ semantic_id: string; target: { semantic_id: string; kind: "asset" | "selection" | "group" | "cash" | "retain"; ref: string | null }; weight: string | number | null }>;
  clock_id: string | null; minimum_weight: string | number | null; maximum_weight: string | number | null;
  cash_remainder_asset: string | null;
}
export interface SelectionStatementV2 { kind: "select"; semantic_id: string; selection: SelectionV2; output_id: string; clock_id: string | null }
export interface ConditionalStatementV2 { kind: "control"; semantic_id: string; condition: ConditionV2; then_statements: ProgramStatementV2[]; otherwise_statements: ProgramStatementV2[]; unknown_policy: "retain" | "otherwise"; clock_id: string | null }
export interface EventDefinitionV2 { semantic_id: string; clock_id: string; condition: ConditionV2 | null; trigger: "rising_edge" | "falling_edge" | "while_true" | "became_true" | "became_false" | "crosses_above" | "crosses_below" | "scheduled"; occurrence: "every" | "first" | "ordinal"; ordinal: number | null }
export interface EventStatementV2 { kind: "on_event"; semantic_id: string; event: EventDefinitionV2; statements: ProgramStatementV2[] }
export interface StateTransitionV2 { semantic_id: string; state_key: string; from_value: string | null; to_value: string; when: ConditionV2; clock_id: string | null }
export interface StateTransitionStatementV2 { kind: "transition"; semantic_id: string; transition: StateTransitionV2 }
export interface RememberValueStatementV2 { kind: "remember_value"; semantic_id: string; memory_id: string; value: ValueExpressionV2; clock_id: string | null }
export interface GuardedAllocationStatementV2 { kind: "guarded_allocation"; semantic_id: string; guard: ConditionV2 | null; primary: AllocationStatementV2; overrides: Array<{ semantic_id: string; priority: number; when: ConditionV2; action: AllocationStatementV2 }>; fallback: AllocationStatementV2 | null; unknown_guard_policy: "block" | "allow" }
export interface UnresolvedStatementV2 { kind: "unresolved"; semantic_id: string; source_text: string; category: "fuzzy_term" | "missing_reference" | "unsupported_semantics"; reason: string }
export type ProgramStatementV2 = SelectionStatementV2 | AllocationStatementV2 | ConditionalStatementV2 | EventStatementV2 | StateTransitionStatementV2 | RememberValueStatementV2 | GuardedAllocationStatementV2 | UnresolvedStatementV2;
export interface SemanticProgramV2 {
  semantic_id: string;
  clocks: Array<{ id: string; timeframe: "session" | "daily" | "weekly" | "monthly"; boundary: "close"; timezone: string; completed_only: true; terminal_boundary_policy?: "not_due" | "fixture_end_is_boundary" }>;
  initial_state: Record<string, string>;
  formalizations?: Array<{ source_phrase: string; status: "formalized" | "unresolved"; semantic_ids: string[]; interpretation: string | null }>;
  statements: ProgramStatementV2[];
}
export interface CanonicalStrategyV2 {
  api_version: "ruletrade.dev/strategy/v2"; semantic_profile: "profile-a/daily-compositional-core@1";
  metadata: { name: string; description: string; tags: string[] };
  definitions: { asset_sets: Array<{ id: string; assets: string[] }>; groups: Array<{ id: string; name: string; asset_set_ref: string; description: string }>; asset_axis: { name: "asset"; domain_id: string; coordinate_policy: string } };
  operator_lock: Record<string, string>; selection: SelectionV2 | null; predicate: ConditionV2 | null;
  program?: SemanticProgramV2 | null;
}
export type ProgramBranch = "root" | "then" | "otherwise" | "event";
export type V2AuthoringOperation =
  | { kind: "add_program_investment"; investment_id: string; name: string; asset_set_id: string; assets: string[] }
  | { kind: "remove_program_investment"; investment_id: string }
  | { kind: "set_program_schedule"; clock_id: string; timeframe: "daily" | "weekly" | "monthly" }
  | { kind: "create_program_selection"; semantic_id: string; investment_id: string; clock_id: string; lookback: number; direction: "ascending" | "descending"; count: number; shortage_policy: "choose_all" | "require_full"; qualification_lookback?: number | null; qualification_operator?: "gt" | "gte" | "lt" | "lte" | null; qualification_threshold?: number | null }
  | { kind: "set_program_fallback"; semantic_id: string; fallback_asset: string | null }
  | { kind: "set_program_split"; semantic_id?: string; investments: Array<[string, number]> }
  | { kind: "set_selection_universe"; universe_id: string }
  | { kind: "set_eligibility_condition"; condition: ConditionV2 | null }
  | { kind: "set_ranking_value"; value: ValueExpressionV2 }
  | { kind: "set_ranking_direction"; direction: "ascending" | "descending" }
  | { kind: "set_selection_count"; count: number }
  | { kind: "set_shortage_policy"; shortage_policy: "choose_all" | "require_full" }
  | { kind: "set_selection_fallback"; fallback_asset: string | null }
  | { kind: "set_predicate"; predicate: ConditionV2 | null }
  | { kind: "set_semantic_program"; program: SemanticProgramV2 }
  | { kind: "replace_program_statement"; semantic_id: string; statement: ProgramStatementV2 }
  | { kind: "insert_program_statement"; statement: ProgramStatementV2; parent_semantic_id: string | null; branch: ProgramBranch; index: number | null }
  | { kind: "remove_program_statement"; semantic_id: string }
  | { kind: "move_program_statement"; semantic_id: string; parent_semantic_id: string | null; branch: ProgramBranch; index: number | null }
  | { kind: "set_program_selection"; semantic_id: string; selection: SelectionV2 }
  | { kind: "set_program_asset_set"; asset_set_id: string; assets: string[] }
  | { kind: "set_program_condition"; semantic_id: string; role: "control" | "event" | "transition" | "selection_eligibility" | "guard" | "override"; condition: ConditionV2 | null; override_semantic_id?: string | null }
  | { kind: "set_program_value"; semantic_id: string; role: "selection_ranking" | "remembered_value"; value: ValueExpressionV2 }
  | { kind: "set_program_event"; semantic_id: string; event: EventDefinitionV2 }
  | { kind: "set_program_transition"; semantic_id: string; transition: StateTransitionV2 }
  | { kind: "set_program_allocation"; semantic_id: string; role: "statement" | "primary" | "fallback" | "override"; allocation: AllocationStatementV2; override_semantic_id?: string | null }
  | { kind: "set_program_formalizations"; formalizations: NonNullable<SemanticProgramV2["formalizations"]> }
  | { kind: "formalize_program_statement"; semantic_id: string; replacement: ProgramStatementV2; interpretation: string }
  | { kind: "formalize_draft_phrase"; source_phrase: string; replacement: ProgramStatementV2; interpretation: string; parent_semantic_id: string | null; branch: ProgramBranch; index: number | null };

export function isDailyValue(value: ValueExpressionV2): value is DailyValueNode {
  return ["literal", "observe", "current", "history", "trailing_return", "sma", "ema", "rsi_wilder_lean_compat", "realized_volatility", "reduce", "arithmetic", "absolute"].includes(value.kind);
}
export function isCanonicalV2(value: { api_version?: string }): value is CanonicalStrategyV2 {
  return value.api_version === "ruletrade.dev/strategy/v2";
}
