import { isDailyValue, type ConditionV2, type DailyValueNode, type ProgramStatementV2, type ValueExpressionV2 } from "./canonicalV2";

const subject = (node: DailyValueNode) => node.subject_kind === "candidate"
  ? "Candidate"
  : node.subject_kind === "group_members"
    ? `${node.subject_id ?? "Group"} members`
    : node.subject_id ?? "Asset";

export function describeDailyValue(node: DailyValueNode): string {
  if (node.kind === "literal") {
    const value = String(node.value ?? "");
    if (node.unit === "ratio" && node.quantity === "return") return `${Number(value) * 100}%`;
    if (node.unit === "USD/share") return `$${value}`;
    if (node.unit === "points") return `${value} points`;
    return `${value} ${node.unit ?? ""}`.trim();
  }
  if (node.kind === "observe") return `${subject(node)}'s adjusted close`;
  const source = node.operands[0] ? describeDailyValue(node.operands[0]) : subject(node);
  if (node.kind === "trailing_return") return `${subject(node.operands[0] ?? node)}'s ${node.observations}-observation return`;
  if (node.kind === "sma") return `${source} · SMA(${node.observations})`;
  if (node.kind === "ema") return `${source} · EMA(${node.observations})`;
  if (node.kind === "rsi_wilder_lean_compat") return `${source} · RSI(${node.observations})`;
  if (node.kind === "realized_volatility") return `${source} · ${node.observations}-observation volatility`;
  if (node.kind === "reduce") return `${node.reduction} across ${node.axis} of ${source}`;
  if (node.kind === "arithmetic") {
    const symbol = { add: "+", subtract: "−", multiply: "×", divide: "÷" }[node.arithmetic ?? "add"];
    return `${source} ${symbol} ${describeDailyValue(node.operands[1])}`;
  }
  if (node.kind === "absolute") return `absolute ${source}`;
  if (node.kind === "history") return `${node.observations}-observation history of ${source}`;
  return source;
}

export function describeValueV2(node: ValueExpressionV2): string {
  if (isDailyValue(node)) return describeDailyValue(node);
  if (node.kind === "cross_sectional") return `${describeValueV2(node.source)} · ${node.transform.replace("_", "-")} across ${node.domain_id}`;
  if (node.kind === "cross_sectional_aggregate") return `${node.domain_id} members' ${node.reduction} ${describeValueV2(node.source)}`;
  if (node.kind === "score") return `Composite score · ${node.terms.length + node.condition_terms.length} terms`;
  if (node.kind === "remembered_value") return `Remembered ${node.memory_id}`;
  if (node.kind === "clocked_value") return `Completed ${String(node.clock_id ?? "clock")} value`;
  if (node.kind === "event_relative") return `Value at ${String(node.event_id ?? "event")}`;
  if (node.kind === "bars_since_event") return `Bars since ${String(node.event_id ?? "event")}`;
  if (node.kind === "bars_since_state") return `Bars since ${String(node.state_key ?? "state")}`;
  if (node.kind === "time_since_event") return `Time since ${String(node.event_id ?? "event")}`;
  return `Time since ${String(node.state_key ?? "state")}`;
}

export function describeConditionV2(condition: ConditionV2): string {
  if (condition.kind === "comparison") {
    const operator = { lt: "<", lte: "≤", eq: "=", neq: "≠", gte: "≥", gt: ">" }[condition.operator];
    return `${describeValueV2(condition.left)} ${operator} ${describeValueV2(condition.right)}`;
  }
  if (condition.kind === "not") return `NOT (${describeConditionV2(condition.child)})`;
  if (condition.kind === "n_of_m") return `At least ${condition.minimum_true} of ${condition.children.length}`;
  if (condition.kind === "state_equals") return `${condition.state_key} is ${condition.expected}`;
  if (condition.kind === "event_window") return `${condition.relation} ${condition.event_id}`;
  return `${condition.kind.toUpperCase()} · ${condition.children.length} conditions`;
}

export function describeProgramStatement(statement: ProgramStatementV2): string {
  if (statement.kind === "select") return `Choose ${statement.selection.count} assets`;
  if (statement.kind === "allocate") return statement.method === "equal" ? "Allocate equally" : `Allocate · ${statement.method.replace("_", " ")}`;
  if (statement.kind === "control") return `IF ${describeConditionV2(statement.condition)}`;
  if (statement.kind === "on_event") return statement.event.trigger === "scheduled" ? "When the schedule occurs" : `When ${statement.event.trigger.replaceAll("_", " ")}`;
  if (statement.kind === "transition") return `Change ${statement.transition.state_key} from ${statement.transition.from_value ?? "any state"} to ${statement.transition.to_value}`;
  if (statement.kind === "remember_value") return `Remember ${describeValueV2(statement.value)} for later use`;
  if (statement.kind === "guarded_allocation") return statement.overrides.length ? `Allocation behavior · ${statement.overrides.length} priority overrides` : "Allocation fallback behavior";
  return `Needs definition: ${statement.source_text}`;
}
