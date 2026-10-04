import type { CanonicalStrategyV1, ValueExpression } from "./canonical";

export function describeValueExpression(expression: ValueExpression): string {
  if (expression.kind === "candidate") return "Candidate";
  if (expression.kind === "literal" && expression.value_type === "asset") return String(expression.value);
  if (expression.kind === "literal") return String(expression.value);
  if (expression.kind === "group_ref") return `Group ${expression.group_id}`;
  if (expression.kind === "market_series") return `${describeValueExpression(expression.subject)} ${expression.field}`;
  if (expression.kind === "current") return `${describeValueExpression(expression.series)} · current`;
  if (expression.kind === "rolling_aggregate") {
    return `${describeValueExpression(expression.series)} · ${expression.operator} over ${expression.window_observations} completed observations`;
  }
  if (expression.kind === "indicator") {
    const lookback = Number(expression.parameters.lookback_bars ?? 0);
    return expression.indicator_id === "trailing_return_indicator@1"
      ? `${describeValueExpression(expression.asset)} · ${lookback}-observation return`
      : `${describeValueExpression(expression.asset)} ${expression.indicator_id}`;
  }
  if (expression.kind === "price") return `${describeValueExpression(expression.asset)} current price`;
  if (expression.kind === "average_cost") return `${describeValueExpression(expression.asset)} average cost`;
  if (expression.kind === "arithmetic") return expression.operator === "multiply"
    ? `${describeValueExpression(expression.left)} × ${describeValueExpression(expression.right)}`
    : `${describeValueExpression(expression.left)} ${expression.operator} ${describeValueExpression(expression.right)}`;
  if (expression.kind === "parameter_ref") return `Parameter ${expression.parameter_id}`;
  if (expression.kind === "state_ref") return `State ${expression.state_id}`;
  if (expression.kind === "component_output") return `Output ${expression.component_id}.${expression.port}`;
  return "Value";
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
