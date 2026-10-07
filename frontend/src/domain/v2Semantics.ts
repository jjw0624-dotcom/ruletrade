import type { ConditionV2, DailyValueNode } from "./canonicalV2";

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

export function describeConditionV2(condition: ConditionV2): string {
  if (condition.kind === "comparison") {
    const operator = { lt: "<", lte: "≤", eq: "=", neq: "≠", gte: "≥", gt: ">" }[condition.operator];
    return `${describeDailyValue(condition.left)} ${operator} ${describeDailyValue(condition.right)}`;
  }
  if (condition.kind === "not") return `NOT (${describeConditionV2(condition.child)})`;
  return `${condition.kind.toUpperCase()} · ${condition.children.length} conditions`;
}
