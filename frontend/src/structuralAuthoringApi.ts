import type { CanonicalStrategyV1 } from "./domain/canonical";

export interface StructuralAuthoringCapabilities {
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
}

interface IntegerCapability {
  component_id: string;
  value: number;
  minimum: number;
  maximum: number | null;
}

export type StructuralAuthoringOperation =
  | { kind: "rename_group"; group_component_id: string; name: string }
  | { kind: "add_qualification_condition"; rank_component_id: string; threshold?: string }
  | { kind: "remove_qualification_condition"; condition_component_id: string }
  | { kind: "transform_to_choose_assets"; weight_component_id: string; lookback_observations: number; count: number }
  | { kind: "add_fallback_selection"; weight_component_id: string; fallback_asset: string }
  | { kind: "remove_fallback_selection"; fallback_component_id: string }
  | { kind: "transform_to_growth_defensive"; target_component_id: string; growth_allocation: string; defensive_assets: string[] }
  | { kind: "update_asset_set"; asset_set_id: string; assets: string[] }
  | { kind: "update_lookback"; component_id: string; lookback_bars: number }
  | { kind: "update_qualification_threshold"; component_id: string; threshold: string }
  | { kind: "update_selection_count"; component_id: string; count: number }
  | { kind: "update_selection_resample"; component_id: string; resample: "once" | "per_event" }
  | { kind: "update_sleeve_allocations"; allocations: Array<{ component_id: string; allocation: string }> }
  | { kind: "update_schedule"; component_id: string; cadence: "daily" | "monthly" | "quarterly"; day?: number | null }
  | { kind: "update_cooldown_duration"; component_id: string; duration: number }
  | { kind: "update_fallback_asset_set"; component_id: string; asset_set_id: string };

export interface StructuralAuthoringErrorDetail {
  code: string;
  path?: string;
  message: string;
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

  async apply(
    strategy: CanonicalStrategyV1,
    operation: StructuralAuthoringOperation,
    fetcher: typeof fetch = fetch,
  ): Promise<CanonicalStrategyV1> {
    const response = await fetcher("/api/v1/canonical/strategies/authoring/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ strategy, operation }),
    });
    if (!response.ok) throw new StructuralAuthoringApiError(await detail(response));
    return (await response.json() as { strategy: CanonicalStrategyV1 }).strategy;
  },
};

export const structuralAuthoringApi = authoringApi;
