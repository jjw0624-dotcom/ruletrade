import type { CanonicalStrategyV2, ProgramStatementV2, SelectionStatementV2 } from "./canonicalV2";
import type { ConceptualFlowProjection } from "./conceptualFlow";
import { describeConditionV2, describeValueV2 } from "./v2Semantics";

export type ProductConcept = "portfolio" | "group" | "subgroup" | "investment" | "sleeve" | "assets" | "qualification" | "selection" | "fallback" | "cooldown" | "split" | "allocation" | "timing" | "rebalance" | "control";
export type ProductAddress =
  | { canonical: "v1"; concept: ProductConcept; componentId: string | null; groupId?: string | null; fieldPath?: string | null }
  | { canonical: "v2"; concept: ProductConcept; semanticId: string; definitionId?: string | null };

export interface ProductNode {
  id: string;
  concept: ProductConcept;
  label: string;
  detail?: string;
  address: ProductAddress;
  capital?: ProductCapitalSemantics;
  children: ProductNode[];
}

/** Derived product meaning for capital quantities; Canonical remains authoritative. */
export interface ProductCapitalSemantics {
  portfolioShare?: {
    value: number;
    source: "v1_sleeve_allocation" | "v2_fixed_group_leg" | "implicit_single_investment";
  };
  selectedAssetAllocation?: {
    method: "equal" | "proportional_score" | "inverse_volatility";
    normalizedTotal: 1;
    sourceSemanticId: string;
  };
}

export interface ProductFlowNode {
  id: string;
  focusId?: string;
  label: string;
  detail?: string;
  role: "portfolio" | "capital" | "routing" | "behavior" | "timing";
  address: ProductAddress;
  capital?: ProductCapitalSemantics;
}

export interface ProductFlowEdge {
  source: string;
  target: string;
  role: "capital" | "routing" | "action";
  label?: string;
}

export interface ProductStrategyProjection {
  name: string;
  root: ProductNode;
  flow: ProductFlowNode[];
  flowEdges: ProductFlowEdge[];
  sourceVersion: "v1" | "v2";
}

export function formatPortfolioShare(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 4 }).format(value);
}

function role(node: ProductNode): ProductFlowNode["role"] {
  if (node.concept === "portfolio") return "portfolio";
  if (node.concept === "timing" || node.concept === "rebalance") return "timing";
  if (["qualification", "selection", "control"].includes(node.concept)) return "routing";
  if (node.concept === "fallback" || node.concept === "cooldown") return "behavior";
  return "capital";
}

function flowNode(node: ProductNode, overrides: Partial<ProductFlowNode> = {}): ProductFlowNode {
  return { id: node.id, label: node.label, detail: node.detail, role: role(node), address: node.address, capital: node.capital, ...overrides };
}

function fallbackDestination(node: ProductNode): string {
  return node.detail?.replace(/^Otherwise\s*→\s*/i, "") || "Fallback asset";
}

function flowFromRoot(root: ProductNode, includeSelection = false): { nodes: ProductFlowNode[]; edges: ProductFlowEdge[] } {
  const nodes: ProductFlowNode[] = [flowNode(root)];
  const edges: ProductFlowEdge[] = [];
  const endpoints: string[] = [];
  const rebalance = root.children.find((node) => node.concept === "rebalance");
  const split = root.children.find((node) => node.concept === "split");
  const investments = split
    ? split.children
    : root.children.filter((node) => node.concept === "investment" || node.concept === "sleeve");
  let capitalSource = root.id;

  if (split) {
    nodes.push(flowNode(split));
    edges.push({ source: root.id, target: split.id, role: "capital" });
    capitalSource = split.id;
  }

  for (const investment of investments) {
    nodes.push(flowNode(investment));
    edges.push({ source: capitalSource, target: investment.id, role: split ? "routing" : "capital", label: investment.detail });
    const selection = investment.children.find((node) => node.concept === "selection");
    const fallback = investment.children.find((node) => node.concept === "fallback");

    if (includeSelection && selection) {
      nodes.push(flowNode(selection));
      edges.push({ source: investment.id, target: selection.id, role: "capital" });
      if (fallback) {
        const selectedId = `selected:${selection.id}`;
        nodes.push(flowNode(selection, {
          id: selectedId, focusId: selection.id, label: "Selected assets", detail: "Target exposure", role: "capital",
        }));
        nodes.push(flowNode(fallback, {
          label: fallbackDestination(fallback), detail: "Fallback exposure", role: "capital",
        }));
        edges.push(
          { source: selection.id, target: selectedId, role: "routing", label: "selected" },
          { source: selection.id, target: fallback.id, role: "routing", label: "if incomplete" },
        );
        endpoints.push(selectedId, fallback.id);
      } else {
        endpoints.push(selection.id);
      }
    } else {
      endpoints.push(investment.id);
    }
  }

  for (const control of root.children.filter((node) => node.concept === "control")) {
    nodes.push(flowNode(control));
    edges.push({ source: root.id, target: control.id, role: "routing" });
    endpoints.push(control.id);
  }

  if (rebalance) {
    nodes.push(flowNode(rebalance));
    for (const source of endpoints.length ? endpoints : [root.id]) {
      edges.push({ source, target: rebalance.id, role: "action" });
    }
  }
  return { nodes, edges };
}

export function projectV1ProductSemantics(value: ConceptualFlowProjection): ProductStrategyProjection {
  const investments: ProductNode[] = value.groups.map((group) => {
    const children: ProductNode[] = [{
      id: `${group.id}:assets`, concept: "assets", label: "Assets", detail: group.assets.join(", "),
      address: { canonical: "v1", concept: "assets", componentId: group.universeComponentId ?? null, groupId: group.id }, children: [],
    }];
    if (group.choose?.filterComponentId) children.push({
      id: `${group.id}:qualification`, concept: "qualification", label: "Qualification", detail: group.choose.condition,
      address: { canonical: "v1", concept: "qualification", componentId: group.choose.filterComponentId, groupId: group.id, fieldPath: group.choose.eligibilityFieldPath }, children: [],
    });
    if (group.choose) children.push({
      id: `${group.id}:selection`, concept: "selection", label: group.choose.label, detail: group.choose.ranking,
      address: { canonical: "v1", concept: "selection", componentId: group.choose.selectionComponentId, groupId: group.id }, children: [],
    });
    if (group.choose?.cooldownComponentId) children.push({
      id: `${group.id}:cooldown`, concept: "cooldown", label: "Cooldown", detail: group.choose.cooldown,
      address: { canonical: "v1", concept: "cooldown", componentId: group.choose.cooldownComponentId, groupId: group.id, fieldPath: "config.duration" }, children: [],
    });
    if (group.choose?.fallbackComponentId) children.push({
      id: `${group.id}:fallback`, concept: "fallback", label: "Fallback", detail: group.choose.otherwise,
      address: { canonical: "v1", concept: "fallback", componentId: group.choose.fallbackComponentId, groupId: group.id }, children: [],
    });
    return {
      id: `investment:${group.id}`, concept: group.sleeveComponentId ? "sleeve" : "investment",
      label: group.label, detail: group.allocation,
      address: { canonical: "v1", concept: group.sleeveComponentId ? "sleeve" : "investment", componentId: group.sleeveComponentId ?? group.universeComponentId ?? null, groupId: group.id },
      capital: { portfolioShare: { value: group.allocation ? Number.parseFloat(group.allocation) / (group.allocation.includes("%") ? 100 : 1) : 1, source: group.sleeveComponentId ? "v1_sleeve_allocation" : "implicit_single_investment" } },
      children,
    };
  });
  const capital: ProductNode[] = value.split ? [{
    id: "split", concept: "split", label: "Split", detail: value.groups.map((item) => item.allocation).join(" / "),
    address: { canonical: "v1", concept: "split", componentId: value.portfolioComponentId ?? null }, children: investments,
  }] : investments;
  if (value.rebalanceScheduleComponentId) capital.push({
    id: "rebalance", concept: "rebalance", label: "Rebalance", detail: value.rebalance,
    address: { canonical: "v1", concept: "rebalance", componentId: value.rebalanceScheduleComponentId }, children: [],
  });
  const root: ProductNode = { id: "portfolio", concept: "portfolio", label: "Portfolio", address: { canonical: "v1", concept: "portfolio", componentId: value.portfolioComponentId ?? null }, children: capital };
  const flow = flowFromRoot(root, true);
  return { name: value.title, root, flow: flow.nodes, flowEdges: flow.edges, sourceVersion: "v1" };
}

function flatten(items: ProgramStatementV2[]): ProgramStatementV2[] {
  return items.flatMap((item) => [item,
    ...(item.kind === "control" ? flatten([...item.then_statements, ...item.otherwise_statements]) : []),
    ...(item.kind === "on_event" ? flatten(item.statements) : []),
    ...(item.kind === "guarded_allocation" ? [item.primary, ...item.overrides.map((override) => override.action), ...(item.fallback ? [item.fallback] : [])] : []),
  ]);
}

export function isProgramBootstrap(statement: ProgramStatementV2): boolean {
  return statement.kind === "allocate" && statement.semantic_id === "initial-retain-allocation" && statement.legs.length === 1 && statement.legs[0]?.target.kind === "retain";
}

export function visibleProgramStatements(strategy: CanonicalStrategyV2): ProgramStatementV2[] {
  return (strategy.program?.statements ?? []).filter((statement) => !isProgramBootstrap(statement));
}

export function projectV2ProductSemantics(strategy: CanonicalStrategyV2): ProductStrategyProjection {
  const roots = visibleProgramStatements(strategy);
  const all = flatten(roots);
  const selections = all.filter((item): item is SelectionStatementV2 => item.kind === "select");
  const selectionByOutput = new Map(selections.map((item) => [item.output_id, item]));
  const rootAllocations = roots.filter((item): item is Extract<ProgramStatementV2, { kind: "allocate" }> => item.kind === "allocate");
  const split = rootAllocations.find((item) => item.method === "fixed" && (
    item.legs.filter((leg) => leg.target.kind === "group").length > 1
    || item.legs.filter((leg) => leg.target.kind === "selection" && selectionByOutput.has(leg.target.ref ?? "")).length > 1
  ));
  const humanize = (value: string) => value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const groupById = new Map(strategy.definitions.groups.map((group) => [group.id, group]));
  const targetName = (target: Extract<ProgramStatementV2, { kind: "allocate" }>["legs"][number]["target"]) => {
    if (target.kind === "selection") return humanize(selectionByOutput.get(target.ref ?? "")?.output_id ?? target.ref ?? "Selected Subgroup");
    if (target.kind === "group") return groupById.get(target.ref ?? "")?.name ?? humanize(target.ref ?? "Group");
    return target.ref ?? humanize(target.kind);
  };
  const groupNodes: ProductNode[] = strategy.definitions.groups.map((group) => {
    const assets = strategy.definitions.asset_sets.find((item) => item.id === group.asset_set_ref);
    const children: ProductNode[] = [{ id: `assets:${assets?.id ?? group.asset_set_ref}`, concept: "assets", label: "Assets", detail: assets?.assets.length ? assets.assets.join(", ") : "Choose assets", address: { canonical: "v2", concept: "assets", semanticId: group.id, definitionId: assets?.id ?? group.asset_set_ref }, children: [] }];
    for (const statement of selections.filter((item) => item.selection.universe_id === group.id)) {
      const selection = statement.selection;
      const subgroupChildren: ProductNode[] = [];
      if (selection.eligibility) subgroupChildren.push({ id: `qualification:${statement.semantic_id}`, concept: "qualification", label: "Qualification", detail: describeConditionV2(selection.eligibility), address: { canonical: "v2", concept: "qualification", semanticId: statement.semantic_id }, children: [] });
      if (selection.fallback_asset) subgroupChildren.push({ id: `fallback:${statement.semantic_id}`, concept: "fallback", label: "Shortage fallback", detail: `Use ${selection.fallback_asset}`, address: { canonical: "v2", concept: "fallback", semanticId: statement.semantic_id }, children: [] });
      children.push({ id: statement.semantic_id, concept: "subgroup", label: `Subgroup · ${humanize(statement.output_id)}`, detail: `Choose ${selection.count} · ${selection.direction === "descending" ? "highest" : "lowest"} ${describeValueV2(selection.ranking)}`, address: { canonical: "v2", concept: "subgroup", semanticId: statement.semantic_id }, children: subgroupChildren });
    }
    return {
      id: `group:${group.id}`, concept: "group", label: `Group · ${group.name || humanize(group.id)}`,
      detail: `${assets?.assets.length ?? 0} asset${assets?.assets.length === 1 ? "" : "s"}`,
      address: { canonical: "v2", concept: "group", semanticId: group.id, definitionId: assets?.id ?? group.asset_set_ref },
      children,
    };
  });
  const investmentFromLeg = (
    allocation: Extract<ProgramStatementV2, { kind: "allocate" }>,
    leg: Extract<ProgramStatementV2, { kind: "allocate" }>["legs"][number],
    share?: number,
  ): ProductNode => ({
    id: allocation.legs.length === 1 ? `investment:${allocation.semantic_id}` : `investment:${allocation.semantic_id}:${leg.semantic_id}`,
    concept: "investment",
    label: `Investment · ${targetName(leg.target)}`,
    detail: `${share === undefined ? "100%" : formatPortfolioShare(share)} of Portfolio · ${allocation.method === "proportional_score" ? "Proportional to positive Score" : "Equal within target"}`,
    address: { canonical: "v2", concept: "investment", semanticId: allocation.semantic_id, definitionId: leg.semantic_id },
    capital: {
      portfolioShare: { value: share ?? 1, source: share === undefined ? "implicit_single_investment" : "v2_fixed_group_leg" },
      selectedAssetAllocation: { method: allocation.method === "proportional_score" ? "proportional_score" : "equal", normalizedTotal: 1, sourceSemanticId: allocation.semantic_id },
    },
    children: [],
  });
  const investments = split
    ? split.legs.map((leg) => investmentFromLeg(split, leg, Number(leg.weight ?? 0)))
    : rootAllocations.filter((item) => item !== split).flatMap((item) => item.legs.map((leg) => investmentFromLeg(item, leg)));
  const controls: ProductNode[] = roots.filter((item) => item.kind === "control").map((item) => ({ id: item.semantic_id, concept: "control", label: "IF / OTHERWISE", detail: describeConditionV2(item.condition), address: { canonical: "v2", concept: "control", semanticId: item.semantic_id }, children: [] }));
  const capital: ProductNode[] = split ? [{ id: "split", concept: "split", label: "Split", detail: split.legs.map((leg) => formatPortfolioShare(Number(leg.weight ?? 0))).join(" / "), address: { canonical: "v2", concept: "split", semanticId: split.semantic_id }, children: investments }] : investments;
  if (investments.length && strategy.program?.clocks[0]) capital.push({ id: "rebalance", concept: "rebalance", label: "Rebalance", detail: `${strategy.program.clocks[0].timeframe[0]!.toUpperCase()}${strategy.program.clocks[0].timeframe.slice(1)} close`, address: { canonical: "v2", concept: "rebalance", semanticId: strategy.program.clocks[0].id }, children: [] });
  const root: ProductNode = { id: "portfolio", concept: "portfolio", label: "Portfolio", address: { canonical: "v2", concept: "portfolio", semanticId: strategy.program?.semantic_id ?? "program" }, children: [...groupNodes, ...capital, ...controls] };
  const flow = flowFromRoot(root, true);
  return { name: strategy.metadata.name, root, flow: flow.nodes, flowEdges: flow.edges, sourceVersion: "v2" };
}

