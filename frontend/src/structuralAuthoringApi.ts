import type { CanonicalStrategyV1, ConditionExpression, ValueExpression } from "./domain/canonical";

export interface StructuralAuthoringCapabilities {
  composition?: {
    primitives: Array<{ primitive: string; category: string; create_supported: boolean; reason: string | null }>;
    mutation_kinds: string[];
    incomplete_working_states: false;
  };
  groups: Array<{ component_id: string; name: string }>;
  qualification_add_targets: string[];
  qualification_remove_targets: string[];
  add_group: false;
  remove_group: false;
  rename_group: boolean;
  add_qualification_condition: boolean;
  remove_qualification_condition: boolean;
  multiple_qualification_conditions: false;
  choose_pipeline_targets: string[];
  fallback_add_targets: string[];
  fallback_remove_targets: string[];
  cooldown_add_targets: string[];
  cooldown_remove_targets: string[];
  growth_defensive_targets: string[];
  create_choose_pipeline: boolean;
  add_fallback_selection: boolean;
  remove_fallback_selection: boolean;
  transform_to_growth_defensive: boolean;
  asset_set_targets: Array<{ asset_set_id: string; assets: string[] }>;
  lookback_targets: Array<IntegerCapability>;
  qualification_threshold_targets: Array<{ component_id: string; value: string }>;
  selection_count_targets: Array<IntegerCapability>;
  selection_resample_targets: Array<{ component_id: string; value: string; choices: string[] }>;
  sleeve_allocation_targets: Array<{
    portfolio_component_id: string;
    sleeves: Array<{ component_id: string; name: string; allocation: string }>;
  }>;
  schedule_targets: Array<{
    component_id: string;
    cadence: "daily" | "monthly" | "quarterly";
    day: number | null;
    choices: Array<{ cadence: "daily" | "monthly" | "quarterly"; requires_day: boolean; default_day: number | null }>;
  }>;
  cooldown_duration_targets: Array<IntegerCapability>;
  fallback_asset_set_targets: Array<{ component_id: string; asset_set_id: string; choices: string[] }>;
  predicate_add_targets?: string[];
  predicate_remove_targets?: string[];
}

interface IntegerCapability {
  component_id: string;
  value: number;
  minimum: number;
  maximum: number | null;
}

export type ComponentAddress = { component_id: string; created_ref?: never } | { created_ref: string; component_id?: never };
export type PortAddress = ComponentAddress & { port: string };
export type CompositionMutation =
  | { kind: "create_component"; ref: string; primitive: string; config?: Record<string, unknown> }
  | { kind: "create_asset_set"; ref: string; assets: string[] }
  | { kind: "set_component_field"; target: ComponentAddress; field: string; value?: unknown; created_asset_set_ref?: string }
  | { kind: "connect" | "disconnect"; source: PortAddress; target: PortAddress }
  | { kind: "remove_component"; target: ComponentAddress };
export type ComposeStrategyOperation = { kind: "compose_strategy"; mutations: CompositionMutation[] };

export type StructuralAuthoringOperation =
  | ComposeStrategyOperation
  | { kind: "rename_group"; group_component_id: string; name: string }
  | { kind: "add_qualification_condition"; rank_component_id: string; threshold?: string }
  | { kind: "remove_qualification_condition"; condition_component_id: string }
  | { kind: "transform_to_choose_assets"; weight_component_id: string; lookback_observations: number; count: number }
  | { kind: "add_fallback_selection"; weight_component_id: string; fallback_asset: string }
  | { kind: "remove_fallback_selection"; fallback_component_id: string }
  | { kind: "add_cooldown_to_selection"; selection_component_id: string; duration: number }
  | { kind: "remove_cooldown_from_selection"; cooldown_component_id: string }
  | { kind: "transform_to_growth_defensive"; target_component_id: string; growth_allocation: string; defensive_assets: string[] }
  | { kind: "update_asset_set"; asset_set_id: string; assets: string[] }
  | { kind: "update_lookback"; component_id: string; lookback_bars: number }
  | { kind: "update_qualification_threshold"; component_id: string; threshold: string }
  | { kind: "update_selection_count"; component_id: string; count: number }
  | { kind: "update_selection_resample"; component_id: string; resample: "once" | "per_event" }
  | { kind: "update_sleeve_allocations"; allocations: Array<{ component_id: string; allocation: string }> }
  | { kind: "update_schedule"; component_id: string; cadence: "daily" | "monthly" | "quarterly"; day?: number | null }
  | { kind: "update_cooldown_duration"; component_id: string; duration: number }
  | { kind: "update_fallback_asset_set"; component_id: string; asset_set_id: string }
  | { kind: "add_predicate"; rebalance_component_id: string; asset: string; lookback_bars: number; operator: "gt" | "gte" | "lt" | "lte"; threshold: string }
  | { kind: "update_predicate"; component_id: string; asset: string; lookback_bars: number; operator: "gt" | "gte" | "lt" | "lte"; threshold: string }
  | { kind: "remove_predicate"; component_id: string }
  | { kind: "update_condition_expression"; component_id: string; role: "predicate" | "eligibility"; condition: ConditionExpression }
  | {
      kind: "update_selection_semantics";
      rank_component_id: string;
      selection_component_id: string;
      direction: "descending" | "ascending";
      count: number;
      shortage_policy: "require_full" | "choose_all";
      value_expression?: ValueExpression | null;
    }
  | {
      kind: "commit_predicate_branches";
      component_id: string;
      then_target_component_id: string;
      otherwise_target_component_id?: string | null;
      asset: string;
      lookback_bars: number;
      operator: "gt" | "gte" | "lt" | "lte";
      threshold: string;
    };

export interface StructuralAuthoringErrorDetail {
  code: string;
  path?: string;
  message: string;
}

export interface AuthoringApplyResult {
  strategy: CanonicalStrategyV1;
  created_component_ids: Record<string, string>;
  created_asset_set_ids: Record<string, string>;
}

export class StructuralAuthoringApiError extends Error {
  constructor(public readonly detail: StructuralAuthoringErrorDetail) {
    super(detail.message);
  }
}

async function detail(response: Response): Promise<StructuralAuthoringErrorDetail> {
  try {
    const payload = await response.json() as { detail?: StructuralAuthoringErrorDetail | string | Array<{ loc?: Array<string | number>; msg?: string }> };
    if (Array.isArray(payload.detail)) {
      const issue = payload.detail[0];
      return {
        code: "invalid_input",
        path: issue?.loc?.join("."),
        message: issue?.msg ?? "That value is not valid for this strategy.",
      };
    }
    if (payload.detail && typeof payload.detail === "object") return payload.detail;
    if (typeof payload.detail === "string") {
      return { code: "request_failed", message: payload.detail };
    }
  } catch {
    // The status-specific fallback below remains useful for non-JSON failures.
  }
  return { code: "request_failed", message: `Structural change failed (${response.status})` };
}

export const authoringApi = {
  async capabilities(
    strategy: CanonicalStrategyV1,
    fetcher: typeof fetch = fetch,
  ): Promise<StructuralAuthoringCapabilities> {
    const response = await fetcher("/api/v1/canonical/strategies/authoring/capabilities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(strategy),
    });
    if (!response.ok) throw new StructuralAuthoringApiError(await detail(response));
    return await response.json() as StructuralAuthoringCapabilities;
  },

  async applyWithResult(
    strategy: CanonicalStrategyV1,
    operation: StructuralAuthoringOperation,
    fetcher: typeof fetch = fetch,
  ): Promise<AuthoringApplyResult> {
    const response = await fetcher("/api/v1/canonical/strategies/authoring/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ strategy, operation }),
    });
    if (!response.ok) throw new StructuralAuthoringApiError(await detail(response));
    const result = await response.json() as Partial<AuthoringApplyResult> & { strategy: CanonicalStrategyV1 };
    return {
      strategy: result.strategy,
      created_component_ids: result.created_component_ids ?? {},
      created_asset_set_ids: result.created_asset_set_ids ?? {},
    };
  },

  async apply(
    strategy: CanonicalStrategyV1,
    operation: StructuralAuthoringOperation,
    fetcher: typeof fetch = fetch,
  ): Promise<CanonicalStrategyV1> {
    return (await authoringApi.applyWithResult(strategy, operation, fetcher)).strategy;
  },
};

export const structuralAuthoringApi = authoringApi;
