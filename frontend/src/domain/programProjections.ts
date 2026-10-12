import type {
  AllocationStatementV2,
  CanonicalStrategyV2,
  ConditionV2,
  ProgramStatementV2,
  SelectionStatementV2,
  ValueExpressionV2,
} from "./canonicalV2";
import { describeConditionV2, describeProgramStatement, describeValueV2 } from "./v2Semantics";
import { formatPortfolioShare, isProgramBootstrap, type ProductAddress, type ProductFlowEdge, type ProductFlowNode } from "./productSemantics";

export interface ProgramProjectionAddress {
  kind: "strategy" | "definition" | "clock" | "statement" | "condition" | "value";
  semanticId: string;
  canonicalPath: string;
  focusId: string;
}

export interface ProgramBlockNode {
  id: string;
  role: "context" | "trigger" | "condition" | "value" | "selection" | "fallback" | "allocation" | "control" | "event" | "state" | "memory" | "policy" | "unresolved";
  label: string;
  detail?: string;
  depth: number;
  address: ProgramProjectionAddress;
}

export interface ProgramRuleLine {
  id: string;
  text: string;
  depth: number;
  address: ProgramProjectionAddress;
}

export interface ProgramSummaryProjection {
  title: string;
  description: string;
  addresses: ProgramProjectionAddress[];
}

function address(kind: ProgramProjectionAddress["kind"], semanticId: string, canonicalPath: string, focusId = semanticId): ProgramProjectionAddress {
  return { kind, semanticId, canonicalPath, focusId };
}

/** Complete semantic traversal used by projections, never as mutable UI state. */
export function flattenProgramStatements(items: ProgramStatementV2[]): ProgramStatementV2[] {
  return items.flatMap((item) => [
    item,
    ...(item.kind === "control" ? flattenProgramStatements([...item.then_statements, ...item.otherwise_statements]) : []),
    ...(item.kind === "on_event" ? flattenProgramStatements(item.statements) : []),
    ...(item.kind === "guarded_allocation" ? [item.primary, ...item.overrides.map((override) => override.action), ...(item.fallback ? [item.fallback] : [])] : []),
  ]);
}

function productAddress(concept: ProductAddress["concept"], semanticId: string): ProductAddress {
  return { canonical: "v2", concept, semanticId };
}

function allocationCandidates(strategy: CanonicalStrategyV2): AllocationStatementV2[] {
  return flattenProgramStatements((strategy.program?.statements ?? []).filter((item) => !isProgramBootstrap(item)))
    .filter((item): item is AllocationStatementV2 => item.kind === "allocate");
}

/** Capital-only projection. Event/State internals deliberately stay out of Flow. */
export function projectProgramCapitalFlow(strategy: CanonicalStrategyV2): { nodes: ProductFlowNode[]; edges: ProductFlowEdge[] } {
  const roots = (strategy.program?.statements ?? []).filter((item) => !isProgramBootstrap(item));
  const all = flattenProgramStatements(roots);
  const selections = all.filter((item): item is SelectionStatementV2 => item.kind === "select");
  const selectionsByOutput = new Map(selections.map((item) => [item.output_id, item]));
  const allocations = allocationCandidates(strategy);
  const directSplit = allocations.find((item) => item.method === "fixed" && item.legs.filter((leg) => leg.target.kind === "group").length > 1);
  const selectionSplit = allocations.find((item) => item.method === "fixed" && item.legs.filter((leg) => leg.target.kind === "selection" && selectionsByOutput.has(leg.target.ref ?? "")).length > 1);
  const shares = new Map<string, number>();
  for (const leg of directSplit?.legs ?? []) if (leg.target.kind === "group" && leg.target.ref) shares.set(leg.target.ref, Number(leg.weight ?? 0));
  for (const leg of selectionSplit?.legs ?? []) {
    const selected = leg.target.kind === "selection" ? selectionsByOutput.get(leg.target.ref ?? "") : undefined;
    if (selected) shares.set(selected.selection.universe_id, Number(leg.weight ?? 0));
  }
  const hasSplit = shares.size > 1;
  const nodes: ProductFlowNode[] = [{ id: "portfolio", label: "Portfolio", role: "portfolio", address: productAddress("portfolio", strategy.program?.semantic_id ?? "program") }];
  const edges: ProductFlowEdge[] = [];
  const capitalSource = hasSplit ? "split" : "portfolio";
  if (hasSplit) {
    nodes.push({ id: "split", label: "Split", detail: [...shares.values()].map(formatPortfolioShare).join(" / "), role: "routing", address: productAddress("split", directSplit?.semantic_id ?? selectionSplit?.semantic_id ?? "split") });
    edges.push({ source: "portfolio", target: "split", role: "capital" });
  }
  const endpoints: string[] = [];
  for (const group of strategy.definitions.groups) {
    const investmentId = `investment:${group.id}`;
    const share = shares.get(group.id);
    nodes.push({ id: investmentId, label: group.name || "Investment", detail: share === undefined ? undefined : `${formatPortfolioShare(share)} of Portfolio`, role: "capital", address: productAddress("investment", group.id) });
    edges.push({ source: capitalSource, target: investmentId, role: hasSplit ? "routing" : "capital", label: share === undefined ? undefined : formatPortfolioShare(share) });
    const selection = selections.find((item) => item.selection.universe_id === group.id);
    if (!selection) { endpoints.push(investmentId); continue; }
    nodes.push({ id: selection.semantic_id, label: `Choose ${selection.selection.count} assets`, detail: `${selection.selection.direction === "descending" ? "highest" : "lowest"} ${describeValueV2(selection.selection.ranking)}`, role: "routing", address: productAddress("selection", selection.semantic_id) });
    edges.push({ source: investmentId, target: selection.semantic_id, role: "capital" });
    if (selection.selection.fallback_asset) {
      const selectedId = `selected:${selection.semantic_id}`;
      const fallbackId = `fallback:${selection.semantic_id}`;
      nodes.push({ id: selectedId, focusId: selection.semantic_id, label: "Selected assets", detail: "Target exposure", role: "capital", address: productAddress("selection", selection.semantic_id) });
      nodes.push({ id: fallbackId, focusId: fallbackId, label: selection.selection.fallback_asset, detail: "Fallback exposure", role: "capital", address: productAddress("fallback", selection.semantic_id) });
      edges.push(
        { source: selection.semantic_id, target: selectedId, role: "routing", label: "selected" },
        { source: selection.semantic_id, target: fallbackId, role: "routing", label: "if incomplete" },
      );
      endpoints.push(selectedId, fallbackId);
    } else endpoints.push(selection.semantic_id);
  }
  const activeClock = strategy.program?.clocks.find((clock) => selections.some((item) => item.clock_id === clock.id)) ?? strategy.program?.clocks[0];
  if (activeClock && selections.length) {
    nodes.push({ id: "rebalance", label: "Rebalance", detail: `${activeClock.timeframe[0]!.toUpperCase()}${activeClock.timeframe.slice(1)} close`, role: "timing", address: productAddress("rebalance", activeClock.id) });
    for (const source of endpoints.length ? endpoints : ["portfolio"]) edges.push({ source, target: "rebalance", role: "action" });
  }
  return { nodes, edges };
}

function conditionBlocks(condition: ConditionV2, path: string, depth: number, focusId: string): ProgramBlockNode[] {
  const node: ProgramBlockNode = { id: `condition:${condition.semantic_id}`, role: "condition", label: describeConditionV2(condition), depth, address: address("condition", condition.semantic_id, path, focusId) };
  if (condition.kind === "all" || condition.kind === "any" || condition.kind === "n_of_m") return [node, ...condition.children.flatMap((child, index) => conditionBlocks(child, `${path}.children[${index}]`, depth + 1, focusId))];
  if (condition.kind === "not") return [node, ...conditionBlocks(condition.child, `${path}.child`, depth + 1, focusId)];
  if (condition.kind === "comparison") return [node, ...valueBlocks(condition.left, `${path}.left`, depth + 1, focusId), ...valueBlocks(condition.right, `${path}.right`, depth + 1, focusId)];
  return [node];
}

function valueBlocks(value: ValueExpressionV2, path: string, depth: number, focusId: string): ProgramBlockNode[] {
  const node: ProgramBlockNode = { id: `value:${value.semantic_id}`, role: "value", label: describeValueV2(value), depth, address: address("value", value.semantic_id, path, focusId) };
  if (value.kind === "score") return [node, ...value.terms.flatMap((term, index) => valueBlocks(term.value, `${path}.terms[${index}].value`, depth + 1, focusId).map((item, itemIndex) => itemIndex === 0 ? { ...item, detail: `weight ${term.weight}` } : item)), ...value.condition_terms.flatMap((term, index) => conditionBlocks(term.condition, `${path}.condition_terms[${index}].condition`, depth + 1, focusId))];
  if (value.kind === "cross_sectional" || value.kind === "cross_sectional_aggregate") return [node, ...valueBlocks(value.source, `${path}.source`, depth + 1, focusId)];
  if ("operands" in value && Array.isArray(value.operands)) return [node, ...value.operands.flatMap((operand, index) => valueBlocks(operand, `${path}.operands[${index}]`, depth + 1, focusId))];
  return [node];
}

function statementBlocks(statement: ProgramStatementV2, path: string, depth: number, relation?: string): ProgramBlockNode[] {
  const role: ProgramBlockNode["role"] = ({ select: "selection", allocate: "allocation", control: "control", on_event: "event", transition: "state", remember_value: "memory", guarded_allocation: "policy", unresolved: "unresolved" } as const)[statement.kind];
  const root: ProgramBlockNode = { id: `statement:${statement.semantic_id}`, role, label: describeProgramStatement(statement), detail: relation, depth, address: address("statement", statement.semantic_id, path) };
  if (statement.kind === "select") return [
    { ...root, detail: `${statement.selection.direction === "descending" ? "highest" : "lowest"}; ${statement.selection.shortage_policy.replaceAll("_", " ")}` },
    ...(statement.selection.eligibility ? conditionBlocks(statement.selection.eligibility, `${path}.selection.eligibility`, depth + 1, `qualification:${statement.semantic_id}`) : []),
    ...valueBlocks(statement.selection.ranking, `${path}.selection.ranking`, depth + 1, statement.semantic_id),
    ...(statement.selection.fallback_asset ? [{
      id: `fallback:${statement.semantic_id}`, role: "fallback" as const,
      label: `Fallback → ${statement.selection.fallback_asset}`, depth: depth + 1,
      address: address("statement", statement.semantic_id, `${path}.selection.fallback_asset`, `fallback:${statement.semantic_id}`),
    }] : []),
  ];
  if (statement.kind === "control") return [root, ...conditionBlocks(statement.condition, `${path}.condition`, depth + 1, statement.semantic_id), ...statement.then_statements.flatMap((item, index) => statementBlocks(item, `${path}.then_statements[${index}]`, depth + 1, "THEN")), ...statement.otherwise_statements.flatMap((item, index) => statementBlocks(item, `${path}.otherwise_statements[${index}]`, depth + 1, "OTHERWISE"))];
  if (statement.kind === "on_event") return [root, ...(statement.event.condition ? conditionBlocks(statement.event.condition, `${path}.event.condition`, depth + 1, statement.semantic_id) : []), ...statement.statements.flatMap((item, index) => statementBlocks(item, `${path}.statements[${index}]`, depth + 1, "ON EVENT"))];
  if (statement.kind === "transition") return [root, ...conditionBlocks(statement.transition.when, `${path}.transition.when`, depth + 1, statement.semantic_id)];
  if (statement.kind === "remember_value") return [root, ...valueBlocks(statement.value, `${path}.value`, depth + 1, statement.semantic_id)];
  if (statement.kind === "guarded_allocation") return [root, ...(statement.guard ? conditionBlocks(statement.guard, `${path}.guard`, depth + 1, statement.semantic_id) : []), ...statementBlocks(statement.primary, `${path}.primary`, depth + 1, "PRIMARY"), ...statement.overrides.flatMap((override, index) => [...conditionBlocks(override.when, `${path}.overrides[${index}].when`, depth + 1, statement.semantic_id), ...statementBlocks(override.action, `${path}.overrides[${index}].action`, depth + 1, `OVERRIDE ${override.priority}`)]), ...(statement.fallback ? statementBlocks(statement.fallback, `${path}.fallback`, depth + 1, "FALLBACK") : [])];
  return [root];
}

/** Logic projection: unlike Structure it exposes executable semantic composition. */
export function projectProgramBlocky(strategy: CanonicalStrategyV2): ProgramBlockNode[] {
  const program = strategy.program;
  const nodes: ProgramBlockNode[] = [{ id: "context:portfolio", role: "context", label: "Portfolio", depth: 0, address: address("strategy", program?.semantic_id ?? "program", "program", "portfolio") }];
  for (const [index, clock] of (program?.clocks ?? []).entries()) nodes.push({ id: `clock:${clock.id}`, role: "trigger", label: `Every ${clock.timeframe} close`, depth: 1, address: address("clock", clock.id, `program.clocks[${index}]`, "rebalance") });
  for (const [index, statement] of (program?.statements ?? []).entries()) if (!isProgramBootstrap(statement)) nodes.push(...statementBlocks(statement, `program.statements[${index}]`, 1));
  return nodes;
}

function ruleLines(statement: ProgramStatementV2, path: string, depth: number): ProgramRuleLine[] {
  const base = { id: `rule:${statement.semantic_id}`, depth, address: address("statement", statement.semantic_id, path) };
  if (statement.kind === "control") return [{ ...base, text: `IF ${describeConditionV2(statement.condition)}; when Unknown, ${statement.unknown_policy === "retain" ? "retain current holdings" : "use OTHERWISE"}.` }, ...statement.then_statements.flatMap((item, index) => ruleLines(item, `${path}.then_statements[${index}]`, depth + 1)), ...statement.otherwise_statements.flatMap((item, index) => ruleLines(item, `${path}.otherwise_statements[${index}]`, depth + 1))];
  if (statement.kind === "select") return [{ ...base, text: `From ${statement.selection.universe_id}, choose ${statement.selection.count} assets by ${statement.selection.direction === "descending" ? "highest" : "lowest"} ${describeValueV2(statement.selection.ranking)}${statement.selection.eligibility ? ` after requiring ${describeConditionV2(statement.selection.eligibility)}` : ""}${statement.selection.fallback_asset ? `; if incomplete, use ${statement.selection.fallback_asset}` : ""}.` }];
  if (statement.kind === "on_event") return [{ ...base, text: `On ${statement.event.trigger.replaceAll("_", " ")}${statement.event.condition ? ` when ${describeConditionV2(statement.event.condition)}` : ""}.` }, ...statement.statements.flatMap((item, index) => ruleLines(item, `${path}.statements[${index}]`, depth + 1))];
  if (statement.kind === "transition") return [{ ...base, text: `Set ${statement.transition.state_key} from ${statement.transition.from_value ?? "any state"} to ${statement.transition.to_value} when ${describeConditionV2(statement.transition.when)}.` }];
  if (statement.kind === "remember_value") return [{ ...base, text: `Remember ${describeValueV2(statement.value)} as ${statement.memory_id}.` }];
  if (statement.kind === "allocate") return [{ ...base, text: statement.method === "fixed"
    ? `Allocate ${statement.legs.map((leg) => `${formatPortfolioShare(Number(leg.weight ?? 0))} to ${leg.target.ref ?? leg.target.kind}`).join(" and ")}.`
    : `Allocate capital using ${statement.method.replaceAll("_", " ")}.` }];
  if (statement.kind === "guarded_allocation") return [
    { ...base, text: `Apply allocation policy in guard, priority override, primary, fallback order${statement.guard ? ` when ${describeConditionV2(statement.guard)}` : ""}.` },
    ...ruleLines(statement.primary, `${path}.primary`, depth + 1),
    ...statement.overrides.flatMap((override, index) => [
      { id: `rule:${override.semantic_id}`, text: `At priority ${override.priority}, when ${describeConditionV2(override.when)}:`, depth: depth + 1, address: address("condition", override.when.semantic_id, `${path}.overrides[${index}].when`, statement.semantic_id) },
      ...ruleLines(override.action, `${path}.overrides[${index}].action`, depth + 2),
    ]),
    ...(statement.fallback ? ruleLines(statement.fallback, `${path}.fallback`, depth + 1) : []),
  ];
  return [{ ...base, text: `${describeProgramStatement(statement)}.` }];
}

export function projectProgramRules(strategy: CanonicalStrategyV2): ProgramRuleLine[] {
  return (strategy.program?.statements ?? []).flatMap((statement, index) => isProgramBootstrap(statement) ? [] : ruleLines(statement, `program.statements[${index}]`, 0));
}

export function projectProgramSummary(strategy: CanonicalStrategyV2): ProgramSummaryProjection {
  const statements = flattenProgramStatements((strategy.program?.statements ?? []).filter((item) => !isProgramBootstrap(item)));
  const selections = statements.filter((item): item is SelectionStatementV2 => item.kind === "select");
  const groups = strategy.definitions.groups;
  const split = projectProgramCapitalFlow(strategy).nodes.find((item) => item.id === "split");
  const base = groups.length === 0
    ? "A portfolio ready for its first investment."
    : selections.length === 0
      ? `${groups.length} investment${groups.length === 1 ? "" : "s"} ready for assets and selection rules.`
      : `${groups.length} investment${groups.length === 1 ? "" : "s"}; ${selections.map((item) => `choose ${item.selection.count} from ${item.selection.universe_id}`).join("; ")}.`;
  const behaviors = [
    statements.some((item) => item.kind === "on_event") ? "Event-driven state changes" : null,
    statements.some((item) => item.kind === "guarded_allocation") ? "policy precedence" : null,
    statements.some((item) => item.kind === "remember_value") ? "remembered observations" : null,
  ].filter((item): item is string => Boolean(item));
  const behavior = behaviors.length ? ` ${behaviors.join(", ")} shape the active allocation.` : "";
  const description = `${split?.detail ? `Split Portfolio capital ${split.detail}. ` : ""}${base}${behavior}`;
  return { title: strategy.metadata.name, description, addresses: [address("strategy", strategy.program?.semantic_id ?? "program", "program", "portfolio"), ...selections.map((item) => address("statement", item.semantic_id, `program.statements[${item.semantic_id}]`))] };
}
