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
  role: "context" | "trigger" | "group" | "selection" | "investment" | "split" | "condition" | "value" | "fallback" | "allocation" | "control" | "event" | "state" | "memory" | "policy" | "unresolved";
  label: string;
  detail?: string;
  depth: number;
  address: ProgramProjectionAddress;
  connection?:
    | { kind: "next"; parentId: string }
    | { kind: "input"; parentId: string; inputName: string };
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

/** Capital-only projection. Event/State internals deliberately stay out of Flow. */
export function projectProgramCapitalFlow(strategy: CanonicalStrategyV2): { nodes: ProductFlowNode[]; edges: ProductFlowEdge[] } {
  const roots = (strategy.program?.statements ?? []).filter((item) => !isProgramBootstrap(item));
  const all = flattenProgramStatements(roots);
  const selections = all.filter((item): item is SelectionStatementV2 => item.kind === "select");
  const selectionsByOutput = new Map(selections.map((item) => [item.output_id, item]));
  const rootAllocations = roots.filter((item): item is AllocationStatementV2 => item.kind === "allocate");
  const split = rootAllocations.find((item) => item.method === "fixed" && item.legs.length > 1);
  const groupNames = new Map(strategy.definitions.groups.map((group) => [group.id, group.name]));
  const humanize = (value: string) => value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const nodes: ProductFlowNode[] = [{ id: "portfolio", label: "Portfolio", role: "portfolio", address: productAddress("portfolio", strategy.program?.semantic_id ?? "program") }];
  const edges: ProductFlowEdge[] = [];
  const endpoints: string[] = [];
  const capitalSource = split ? "split" : "portfolio";
  if (split) {
    nodes.push({ id: "split", label: "Split", detail: split.legs.map((leg) => formatPortfolioShare(Number(leg.weight ?? 0))).join(" / "), role: "routing", address: productAddress("split", split.semantic_id) });
    edges.push({ source: "portfolio", target: "split", role: "capital" });
  }

  const addInvestment = (allocation: AllocationStatementV2, leg: AllocationStatementV2["legs"][number], source: string, share?: number, branch?: string) => {
    const suffix = allocation.legs.length === 1 ? allocation.semantic_id : leg.semantic_id;
    const investmentId = `investment:${allocation.semantic_id}:${suffix}`;
    const selection = leg.target.kind === "selection" ? selectionsByOutput.get(leg.target.ref ?? "") : undefined;
    const target = selection ? humanize(selection.output_id)
      : leg.target.kind === "group" ? groupNames.get(leg.target.ref ?? "") ?? humanize(leg.target.ref ?? "Group")
        : leg.target.ref ?? humanize(leg.target.kind);
    const internal = allocation.method === "proportional_score" ? "Proportional to positive Score" : "Equal within target";
    nodes.push({ id: investmentId, label: `Investment · ${target}`, detail: `${share === undefined ? "100% of Portfolio" : `${formatPortfolioShare(share)} of Portfolio`} · ${internal}`, role: "capital", address: productAddress("investment", allocation.semantic_id) });
    edges.push({ source, target: investmentId, role: source === "portfolio" ? "capital" : "routing", label: branch ?? (share === undefined ? undefined : formatPortfolioShare(share)) });
    if (!selection) { endpoints.push(investmentId); return; }
    const chooseId = `choose:${selection.semantic_id}:${investmentId}`;
    nodes.push({ id: chooseId, focusId: selection.semantic_id, label: `Choose · ${humanize(selection.output_id)}`, detail: `Take ${selection.selection.count} ${selection.selection.direction === "descending" ? "highest" : "lowest"}`, role: "routing", address: productAddress("subgroup", selection.semantic_id) });
    edges.push({ source: investmentId, target: chooseId, role: "capital" });
    const selectedId = `selected:${selection.semantic_id}:${investmentId}`;
    nodes.push({ id: selectedId, focusId: selection.semantic_id, label: humanize(selection.output_id), detail: "Selected Subgroup exposure", role: "capital", address: productAddress("subgroup", selection.semantic_id) });
    edges.push({ source: chooseId, target: selectedId, role: "routing", label: "selected" });
    endpoints.push(selectedId);
    if (selection.selection.fallback_asset) {
      const fallbackId = `fallback:${selection.semantic_id}:${investmentId}`;
      nodes.push({ id: fallbackId, focusId: `fallback:${selection.semantic_id}`, label: selection.selection.fallback_asset, detail: "Shortage fallback exposure", role: "capital", address: productAddress("fallback", selection.semantic_id) });
      edges.push({ source: chooseId, target: fallbackId, role: "routing", label: "if incomplete" });
      endpoints.push(fallbackId);
    }
  };

  if (split) split.legs.forEach((leg) => addInvestment(split, leg, capitalSource, Number(leg.weight ?? 0)));
  else rootAllocations.forEach((allocation) => allocation.legs.forEach((leg) => addInvestment(allocation, leg, "portfolio")));
  for (const control of roots.filter((item): item is Extract<ProgramStatementV2, { kind: "control" }> => item.kind === "control")) {
    const controlId = `control:${control.semantic_id}`;
    nodes.push({ id: controlId, focusId: control.semantic_id, label: "IF / OTHERWISE", detail: describeConditionV2(control.condition), role: "routing", address: productAddress("control", control.semantic_id) });
    edges.push({ source: "portfolio", target: controlId, role: "routing" });
    control.then_statements.filter((item): item is AllocationStatementV2 => item.kind === "allocate").forEach((allocation) => allocation.legs.forEach((leg) => addInvestment(allocation, leg, controlId, undefined, "IF")));
    control.otherwise_statements.filter((item): item is AllocationStatementV2 => item.kind === "allocate").forEach((allocation) => allocation.legs.forEach((leg) => addInvestment(allocation, leg, controlId, undefined, "OTHERWISE")));
  }
  const activeClock = strategy.program?.clocks.find((clock) => rootAllocations.some((item) => item.clock_id === clock.id)) ?? strategy.program?.clocks[0];
  if (activeClock && endpoints.length) {
    nodes.push({ id: "rebalance", label: "Rebalance", detail: `${activeClock.timeframe[0]!.toUpperCase()}${activeClock.timeframe.slice(1)} close`, role: "timing", address: productAddress("rebalance", activeClock.id) });
    for (const source of endpoints) edges.push({ source, target: "rebalance", role: "action" });
  }
  return { nodes, edges };
}

function conditionBlocks(condition: ConditionV2, path: string, depth: number, focusId: string, connection?: ProgramBlockNode["connection"]): ProgramBlockNode[] {
  const node: ProgramBlockNode = { id: `condition:${condition.semantic_id}`, role: "condition", label: describeConditionV2(condition), depth, address: address("condition", condition.semantic_id, path, focusId), connection };
  if (condition.kind === "all" || condition.kind === "any" || condition.kind === "n_of_m") return [node, ...condition.children.flatMap((child, index) => conditionBlocks(child, `${path}.children[${index}]`, depth + 1, focusId, { kind: "input", parentId: node.id, inputName: `ARG_${index + 1}` }))];
  if (condition.kind === "not") return [node, ...conditionBlocks(condition.child, `${path}.child`, depth + 1, focusId, { kind: "input", parentId: node.id, inputName: "ARG_1" })];
  if (condition.kind === "comparison") return [node, ...valueBlocks(condition.left, `${path}.left`, depth + 1, focusId, { kind: "input", parentId: node.id, inputName: "ARG_1" }), ...valueBlocks(condition.right, `${path}.right`, depth + 1, focusId, { kind: "input", parentId: node.id, inputName: "ARG_2" })];
  return [node];
}

function valueBlocks(value: ValueExpressionV2, path: string, depth: number, focusId: string, connection?: ProgramBlockNode["connection"]): ProgramBlockNode[] {
  const node: ProgramBlockNode = { id: `value:${value.semantic_id}`, role: "value", label: describeValueV2(value), depth, address: address("value", value.semantic_id, path, focusId), connection };
  if (value.kind === "score") return [node, ...value.terms.flatMap((term, index) => valueBlocks(term.value, `${path}.terms[${index}].value`, depth + 1, focusId, { kind: "input", parentId: node.id, inputName: `ARG_${index + 1}` }).map((item, itemIndex) => itemIndex === 0 ? { ...item, detail: `weight ${term.weight}` } : item)), ...value.condition_terms.flatMap((term, index) => conditionBlocks(term.condition, `${path}.condition_terms[${index}].condition`, depth + 1, focusId, { kind: "input", parentId: node.id, inputName: `ARG_${value.terms.length + index + 1}` }))];
  if (value.kind === "cross_sectional" || value.kind === "cross_sectional_aggregate") return [node, ...valueBlocks(value.source, `${path}.source`, depth + 1, focusId, { kind: "input", parentId: node.id, inputName: "ARG_1" })];
  if ("operands" in value && Array.isArray(value.operands)) return [node, ...value.operands.flatMap((operand, index) => valueBlocks(operand, `${path}.operands[${index}]`, depth + 1, focusId, { kind: "input", parentId: node.id, inputName: `ARG_${index + 1}` }))];
  return [node];
}

function statementBlocks(statement: ProgramStatementV2, path: string, depth: number, connection?: ProgramBlockNode["connection"], relation?: string): ProgramBlockNode[] {
  const role: ProgramBlockNode["role"] = ({ select: "selection", allocate: "allocation", control: "control", on_event: "event", transition: "state", remember_value: "memory", guarded_allocation: "policy", unresolved: "unresolved" } as const)[statement.kind];
  const humanize = (value: string) => value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const allocationLabel = statement.kind === "allocate"
    ? statement.method === "fixed" && statement.legs.length > 1 ? "Split Portfolio capital" : `Investment · ${humanize(statement.legs[0]?.target.ref ?? statement.legs[0]?.target.kind ?? "Target")}`
    : null;
  const allocationDetail = statement.kind === "allocate"
    ? statement.method === "fixed"
      ? statement.legs.map((leg) => `${formatPortfolioShare(Number(leg.weight ?? 0))} portfolio weight`).join(" · ")
      : `100% of available Portfolio route · ${statement.method.replaceAll("_", " ")} within target`
    : null;
  const projectedRole = statement.kind === "allocate" ? (statement.method === "fixed" && statement.legs.length > 1 ? "split" : "investment") : role;
  const root: ProgramBlockNode = { id: `statement:${statement.semantic_id}`, role: projectedRole, label: allocationLabel ?? describeProgramStatement(statement), detail: allocationDetail ?? relation, depth, address: address("statement", statement.semantic_id, path), connection };
  if (statement.kind === "select") return [
    { ...root, label: `Choose · ${humanize(statement.output_id)}`, detail: `From ${humanize(statement.selection.universe_id)} · Take ${statement.selection.count} · ${statement.selection.direction === "descending" ? "highest" : "lowest"}; ${statement.selection.shortage_policy.replaceAll("_", " ")}` },
    ...(statement.selection.eligibility ? conditionBlocks(statement.selection.eligibility, `${path}.selection.eligibility`, depth + 1, `qualification:${statement.semantic_id}`, { kind: "input", parentId: root.id, inputName: "ELIGIBILITY" }) : []),
    ...valueBlocks(statement.selection.ranking, `${path}.selection.ranking`, depth + 1, statement.semantic_id, { kind: "input", parentId: root.id, inputName: "RANKING" }),
    ...(statement.selection.fallback_asset ? [{
      id: `fallback:${statement.semantic_id}`, role: "fallback" as const,
      label: `Fallback → ${statement.selection.fallback_asset}`, depth: depth + 1,
      address: address("statement", statement.semantic_id, `${path}.selection.fallback_asset`, `fallback:${statement.semantic_id}`),
      connection: { kind: "input" as const, parentId: root.id, inputName: "FALLBACK" },
    }] : []),
  ];
  if (statement.kind === "allocate" && statement.method === "fixed" && statement.legs.length > 1) return [
    root,
    ...statement.legs.map((leg, index) => ({
      id: `investment-leg:${leg.semantic_id}`,
      role: "investment" as const,
      label: `Investment · ${humanize(leg.target.ref ?? leg.target.kind)}`,
      detail: `${formatPortfolioShare(Number(leg.weight ?? 0))} of Portfolio · Equal within target`,
      depth: depth + 1,
      address: address("statement", statement.semantic_id, `${path}.legs[${index}]`, statement.semantic_id),
      connection: { kind: "input" as const, parentId: root.id, inputName: `LEG_${index + 1}` },
    })),
  ];
  if (statement.kind === "control") return [root, ...conditionBlocks(statement.condition, `${path}.condition`, depth + 1, statement.semantic_id, { kind: "input", parentId: root.id, inputName: "CONDITION" }), ...statement.then_statements.flatMap((item, index) => statementBlocks(item, `${path}.then_statements[${index}]`, depth + 1, index ? { kind: "next", parentId: `statement:${statement.then_statements[index - 1]!.semantic_id}` } : { kind: "input", parentId: root.id, inputName: "THEN" }, "THEN")), ...statement.otherwise_statements.flatMap((item, index) => statementBlocks(item, `${path}.otherwise_statements[${index}]`, depth + 1, index ? { kind: "next", parentId: `statement:${statement.otherwise_statements[index - 1]!.semantic_id}` } : { kind: "input", parentId: root.id, inputName: "ELSE" }, "OTHERWISE"))];
  if (statement.kind === "on_event") return [root, ...(statement.event.condition ? conditionBlocks(statement.event.condition, `${path}.event.condition`, depth + 1, statement.semantic_id, { kind: "input", parentId: root.id, inputName: "CONDITION" }) : []), ...statement.statements.flatMap((item, index) => statementBlocks(item, `${path}.statements[${index}]`, depth + 1, index ? { kind: "next", parentId: `statement:${statement.statements[index - 1]!.semantic_id}` } : { kind: "input", parentId: root.id, inputName: "DO" }, "ON EVENT"))];
  if (statement.kind === "transition") return [root, ...conditionBlocks(statement.transition.when, `${path}.transition.when`, depth + 1, statement.semantic_id, { kind: "input", parentId: root.id, inputName: "CONDITION" })];
  if (statement.kind === "remember_value") return [root, ...valueBlocks(statement.value, `${path}.value`, depth + 1, statement.semantic_id, { kind: "input", parentId: root.id, inputName: "VALUE" })];
  if (statement.kind === "guarded_allocation") return [root, ...(statement.guard ? conditionBlocks(statement.guard, `${path}.guard`, depth + 1, statement.semantic_id, { kind: "input", parentId: root.id, inputName: "CONDITION" }) : []), ...statementBlocks(statement.primary, `${path}.primary`, depth + 1, { kind: "input", parentId: root.id, inputName: "DO" }, "PRIMARY"), ...statement.overrides.flatMap((override, index) => [...conditionBlocks(override.when, `${path}.overrides[${index}].when`, depth + 1, statement.semantic_id, { kind: "input", parentId: `statement:${override.action.semantic_id}`, inputName: "CONDITION" }), ...statementBlocks(override.action, `${path}.overrides[${index}].action`, depth + 1, { kind: "next", parentId: index ? `statement:${statement.overrides[index - 1]!.action.semantic_id}` : `statement:${statement.primary.semantic_id}` }, `OVERRIDE ${override.priority}`)]), ...(statement.fallback ? statementBlocks(statement.fallback, `${path}.fallback`, depth + 1, { kind: "next", parentId: statement.overrides.length ? `statement:${statement.overrides.at(-1)!.action.semantic_id}` : `statement:${statement.primary.semantic_id}` }, "FALLBACK") : [])];
  return [root];
}

/** Logic projection: unlike Structure it exposes executable semantic composition. */
export function projectProgramBlocky(strategy: CanonicalStrategyV2): ProgramBlockNode[] {
  const program = strategy.program;
  const nodes: ProgramBlockNode[] = [{ id: "context:portfolio", role: "context", label: "Portfolio", depth: 0, address: address("strategy", program?.semantic_id ?? "program", "program", "portfolio") }];
  for (const [index, clock] of (program?.clocks ?? []).entries()) nodes.push({ id: `clock:${clock.id}`, role: "trigger", label: `${clock.timeframe[0]!.toUpperCase()}${clock.timeframe.slice(1)} close`, depth: 1, address: address("clock", clock.id, `program.clocks[${index}]`, "rebalance") });
  for (const [index, group] of strategy.definitions.groups.entries()) {
    const assets = strategy.definitions.asset_sets.find((item) => item.id === group.asset_set_ref);
    nodes.push({
      id: `group:${group.id}`, role: "group", label: `Group · ${group.name}`,
      detail: assets?.assets.length ? assets.assets.join(", ") : "Choose assets",
      depth: 1, address: address("definition", group.id, `definitions.groups[${index}]`, `group:${group.id}`),
    });
  }
  const lastByClock = new Map<string, string>();
  for (const [index, statement] of (program?.statements ?? []).entries()) if (!isProgramBootstrap(statement)) {
    const clockId = statement.kind === "on_event" ? statement.event.clock_id
      : statement.kind === "transition" ? statement.transition.clock_id
        : "clock_id" in statement ? statement.clock_id
          : statement.kind === "guarded_allocation" ? statement.primary.clock_id
            : null;
    const prior = clockId ? lastByClock.get(clockId) : undefined;
    const connection = clockId ? { kind: "next" as const, parentId: prior ?? `clock:${clockId}` } : undefined;
    nodes.push(...statementBlocks(statement, `program.statements[${index}]`, 1, connection));
    if (clockId) lastByClock.set(clockId, `statement:${statement.semantic_id}`);
  }
  return nodes;
}

export function programBlockConnectionManifest(nodes: ProgramBlockNode[]): string[] {
  return nodes.flatMap((node) => node.connection
    ? [`${node.connection.parentId}:${node.connection.kind === "input" ? node.connection.inputName : "NEXT"}->${node.id}`]
    : []);
}

function ruleLines(statement: ProgramStatementV2, path: string, depth: number): ProgramRuleLine[] {
  const base = { id: `rule:${statement.semantic_id}`, depth, address: address("statement", statement.semantic_id, path) };
  if (statement.kind === "control") return [{ ...base, text: `IF ${describeConditionV2(statement.condition)}; when Unknown, ${statement.unknown_policy === "retain" ? "retain current holdings" : "use OTHERWISE"}.` }, ...statement.then_statements.flatMap((item, index) => ruleLines(item, `${path}.then_statements[${index}]`, depth + 1)), ...statement.otherwise_statements.flatMap((item, index) => ruleLines(item, `${path}.otherwise_statements[${index}]`, depth + 1))];
  if (statement.kind === "select") return [{ ...base, text: `From Group ${statement.selection.universe_id}, Choose ${statement.selection.count} members for Subgroup ${statement.output_id} by ${statement.selection.direction === "descending" ? "highest" : "lowest"} ${describeValueV2(statement.selection.ranking)}${statement.selection.eligibility ? ` after requiring ${describeConditionV2(statement.selection.eligibility)}` : ""}${statement.selection.fallback_asset ? `; if incomplete, use ${statement.selection.fallback_asset}` : ""}.` }];
  if (statement.kind === "on_event") return [{ ...base, text: `On ${statement.event.trigger.replaceAll("_", " ")}${statement.event.condition ? ` when ${describeConditionV2(statement.event.condition)}` : ""}.` }, ...statement.statements.flatMap((item, index) => ruleLines(item, `${path}.statements[${index}]`, depth + 1))];
  if (statement.kind === "transition") return [{ ...base, text: `Set ${statement.transition.state_key} from ${statement.transition.from_value ?? "any state"} to ${statement.transition.to_value} when ${describeConditionV2(statement.transition.when)}.` }];
  if (statement.kind === "remember_value") return [{ ...base, text: `Remember ${describeValueV2(statement.value)} as ${statement.memory_id}.` }];
  if (statement.kind === "allocate") return [{ ...base, text: statement.method === "fixed"
    ? `Split Portfolio capital: ${statement.legs.map((leg) => `${formatPortfolioShare(Number(leg.weight ?? 0))} to Investment ${leg.target.ref ?? leg.target.kind}`).join(" and ")}.`
    : `Investment targets ${statement.legs.map((leg) => leg.target.ref ?? leg.target.kind).join(" and ")} using ${statement.method.replaceAll("_", " ")} within the target.` }];
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
  const investments = statements.filter((item): item is AllocationStatementV2 => item.kind === "allocate");
  const split = projectProgramCapitalFlow(strategy).nodes.find((item) => item.id === "split");
  const base = groups.length === 0
    ? "A portfolio ready for its first investment."
    : selections.length === 0
      ? `${groups.length} candidate Group${groups.length === 1 ? "" : "s"} ready for Choose rules${investments.length ? ` and ${investments.length} capital Investment${investments.length === 1 ? "" : "s"}` : ""}.`
      : `${groups.length} Group${groups.length === 1 ? "" : "s"}; ${selections.map((item) => `Choose ${item.selection.count} from ${item.selection.universe_id}`).join("; ")}${investments.length ? `; ${investments.length} capital Investment${investments.length === 1 ? "" : "s"}` : ""}.`;
  const behaviors = [
    statements.some((item) => item.kind === "on_event") ? "Event-driven state changes" : null,
    statements.some((item) => item.kind === "guarded_allocation") ? "policy precedence" : null,
    statements.some((item) => item.kind === "remember_value") ? "remembered observations" : null,
  ].filter((item): item is string => Boolean(item));
  const behavior = behaviors.length ? ` ${behaviors.join(", ")} shape the active allocation.` : "";
  const description = `${split?.detail ? `Split Portfolio capital ${split.detail}. ` : ""}${base}${behavior}`;
  return { title: strategy.metadata.name, description, addresses: [address("strategy", strategy.program?.semantic_id ?? "program", "program", "portfolio"), ...selections.map((item) => address("statement", item.semantic_id, `program.statements[${item.semantic_id}]`))] };
}
