import type { CanonicalStrategyV1, ConditionExpression, ValueExpression } from "./canonical";

function numeric(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(number) : String(value);
}

function subjectLabel(expression: ValueExpression): string {
  if (expression.kind === "candidate") return "Candidate";
  if (expression.kind === "literal" && expression.value_type === "asset") return String(expression.value).toUpperCase();
  if (expression.kind === "group_ref") return `Group ${expression.group_id}`;
  return describeValueExpression(expression);
}

function possessive(label: string): string {
  return label.endsWith("s") ? `${label}'` : `${label}'s`;
}

export function describeValueExpression(expression: ValueExpression): string {
  if (expression.kind === "candidate") return "Candidate";
  if (expression.kind === "literal") {
    if (expression.value_type === "asset") return String(expression.value).toUpperCase();
    if (expression.value_type === "percentage") return `${numeric(Number(expression.value) * 100)}%`;
    if (expression.value_type === "money_per_share" || expression.value_type === "money") return `$${numeric(expression.value)}`;
    return numeric(expression.value);
  }
  if (expression.kind === "group_ref") return `Group ${expression.group_id}`;
  if (expression.kind === "market_series") return `${possessive(subjectLabel(expression.subject))} adjusted ${expression.field}`;
  if (expression.kind === "current") {
    if (expression.series.kind === "market_series") return `${possessive(subjectLabel(expression.series.subject))} current adjusted ${expression.series.field}`;
    return `${describeValueExpression(expression.series)} · current`;
  }
  if (expression.kind === "rolling_aggregate") {
    if (expression.series.kind === "market_series") return `${possessive(subjectLabel(expression.series.subject))} ${expression.window_observations}-observation ${expression.operator} adjusted ${expression.series.field}`;
    return `${describeValueExpression(expression.series)} · ${expression.window_observations}-observation ${expression.operator}`;
  }
  if (expression.kind === "indicator") {
    const lookback = Number(expression.parameters.lookback_bars ?? 0);
    return expression.indicator_id === "trailing_return_indicator@1"
      ? `${possessive(subjectLabel(expression.asset))} ${lookback}-observation return`
      : `${possessive(subjectLabel(expression.asset))} ${expression.indicator_id}`;
  }
  if (expression.kind === "price") return `${possessive(subjectLabel(expression.asset))} current price`;
  if (expression.kind === "average_cost") return `${possessive(subjectLabel(expression.asset))} average cost`;
  if (expression.kind === "arithmetic") return expression.operator === "multiply"
    ? `${describeValueExpression(expression.left)} × ${describeValueExpression(expression.right)}`
    : `${describeValueExpression(expression.left)} ${expression.operator} ${describeValueExpression(expression.right)}`;
  if (expression.kind === "parameter_ref") return `Parameter ${expression.parameter_id}`;
  if (expression.kind === "state_ref") return `State ${expression.state_id}`;
  if (expression.kind === "component_output") return `Output ${expression.component_id}.${expression.port}`;
  return "Value";
}

export function describeConditionExpression(expression: ConditionExpression): string {
  if (expression.kind === "comparison") {
    const operator = { gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=", neq: "≠" }[expression.operator];
    return `${describeValueExpression(expression.left)} ${operator} ${describeValueExpression(expression.right)}`;
  }
  if (expression.kind === "boolean") {
    const joiner = expression.operator === "and" ? " AND " : " OR ";
    return expression.operands.map(describeConditionExpression).join(joiner);
  }
  return "Committed condition";
}

export function compactValueExpression(expression: ValueExpression): string {
  if (expression.kind === "indicator" && expression.indicator_id === "trailing_return_indicator@1") {
    return `${Number(expression.parameters.lookback_bars ?? 0)}-observation return`;
  }
  if (expression.kind === "current" && expression.series.kind === "market_series") return `current ${expression.series.field}`;
  if (expression.kind === "rolling_aggregate" && expression.series.kind === "market_series") {
    return `${expression.window_observations}-observation ${expression.operator} ${expression.series.field}`;
  }
  if (expression.kind === "arithmetic" && expression.operator === "multiply") {
    return `${compactValueExpression(expression.left)} × ${describeValueExpression(expression.right)}`;
  }
  return describeValueExpression(expression);
}

export function compactConditionExpression(expression: ConditionExpression): string {
  if (expression.kind !== "comparison") return expression.kind === "boolean" && expression.operator === "and"
    ? `${expression.operands.length} eligibility conditions`
    : describeConditionExpression(expression);
  const operator = { gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=", neq: "≠" }[expression.operator];
  return `${compactValueExpression(expression.left)} ${operator} ${describeValueExpression(expression.right)}`;
}

export function describeSelectionSummary(count: number, filters: number, ranking: ValueExpression | undefined, direction: string | undefined): string {
  const filter = filters ? ` · ${filters} ${filters === 1 ? "filter" : "filters"}` : "";
  const order = ranking ? ` · ${direction === "ascending" || direction === "asc" ? "lowest" : "highest"} ${compactValueExpression(ranking)}` : "";
  return `Choose ${count} assets${filter}${order}`;
}

export function valueExpressionType(expression: ValueExpression): string {
  if (expression.kind === "literal") return expression.value_type;
  if (expression.kind === "indicator" && expression.indicator_id === "trailing_return_indicator@1") return "percentage";
  if (expression.kind === "current" || expression.kind === "rolling_aggregate" || expression.kind === "price") return "money_per_share";
  if (expression.kind === "arithmetic") return valueExpressionType(expression.left);
  return "decimal";
}

export function describeUniverse(strategy: CanonicalStrategyV1, componentId: string): string | null {
  const component = strategy.graph.components.find((item) => item.id === componentId);
  if (!component) return null;
  if (component.primitive === "asset_set@1") {
    const id = String(component.config.asset_set_ref ?? "");
    const definition = strategy.definitions.asset_sets.find((item) => item.id === id);
    return definition ? `Explicit universe · ${definition.assets.length} assets` : null;
  }
  if (component.primitive !== "universe@1") return null;
  const id = String(component.config.universe_ref ?? "");
  const universe = strategy.definitions.universes?.find((item) => item.id === id);
  if (!universe) return null;
  const source = universe.source === "group" ? "Static Group" : universe.source === "provider" ? "Provider-backed" : "Explicit assets";
  return `${universe.name} · ${source} universe`;
}
