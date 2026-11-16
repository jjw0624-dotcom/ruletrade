export type BlockyFilterCombination = "all" | "any";
export type BlockyFilterMetric = "trailing_return" | "current_price";
export type BlockyFilterOperator = "lt" | "lte" | "eq" | "neq" | "gte" | "gt";
export type BlockyFilterUnit = "percent" | "usd_per_share";
export type BlockyMissingPolicy = "exclude";

export interface BlockyFilterCondition {
  id: string;
  metric: BlockyFilterMetric;
  lookbackObservations: number | null;
  operator: BlockyFilterOperator;
  value: number;
  unit: BlockyFilterUnit;
}

export interface BlockyFilterSpec {
  version: 1;
  combination: BlockyFilterCombination;
  missingPolicy: BlockyMissingPolicy;
  conditions: BlockyFilterCondition[];
}

export const DEFAULT_BLOCKY_FILTER_SPEC: BlockyFilterSpec = {
  version: 1,
  combination: "all",
  missingPolicy: "exclude",
  conditions: [],
};

const operators = new Set<BlockyFilterOperator>(["lt", "lte", "eq", "neq", "gte", "gt"]);

export function parseBlockyFilterSpec(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; }
  catch { return null; }
}

export function normalizeBlockyFilterSpec(value: unknown): BlockyFilterSpec {
  value = parseBlockyFilterSpec(value);
  if (!value || typeof value !== "object") return { ...DEFAULT_BLOCKY_FILTER_SPEC, conditions: [] };
  const candidate = value as Partial<BlockyFilterSpec>;
  const combination: BlockyFilterCombination = candidate.combination === "any" ? "any" : "all";
  const conditions = Array.isArray(candidate.conditions) ? candidate.conditions.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Partial<BlockyFilterCondition>;
    const metric: BlockyFilterMetric = raw.metric === "current_price" ? "current_price" : "trailing_return";
    const unit: BlockyFilterUnit = metric === "current_price" ? "usd_per_share" : "percent";
    const lookbackObservations = metric === "trailing_return"
      ? Math.max(1, Math.min(2000, Math.trunc(Number(raw.lookbackObservations ?? 126))))
      : null;
    const numericValue = Number(raw.value ?? 0);
    return [{
      id: typeof raw.id === "string" && raw.id ? raw.id : `condition-${index + 1}`,
      metric,
      lookbackObservations,
      operator: operators.has(raw.operator as BlockyFilterOperator) ? raw.operator as BlockyFilterOperator : "gt",
      value: Number.isFinite(numericValue) ? numericValue : 0,
      unit,
    }];
  }) : [];
  return { version: 1, combination, missingPolicy: "exclude", conditions };
}

export function blockyFilterSpecErrors(spec: BlockyFilterSpec): string[] {
  const errors: string[] = [];
  if (spec.conditions.length === 0) errors.push("Add at least one Filter condition.");
  if (spec.conditions.length > 12) errors.push("A Filter supports at most 12 conditions.");
  const ids = spec.conditions.map((condition) => condition.id);
  if (new Set(ids).size !== ids.length) errors.push("Filter condition ids must be unique.");
  for (const condition of spec.conditions) {
    if (condition.metric === "trailing_return" && (!condition.lookbackObservations || condition.lookbackObservations < 1)) {
      errors.push(`${condition.id}: trailing return requires a positive completed-observation lookback.`);
    }
    if (!Number.isFinite(condition.value)) errors.push(`${condition.id}: comparison value must be finite.`);
  }
  return errors;
}
