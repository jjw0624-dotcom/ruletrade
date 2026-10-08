import type { CanonicalStrategyV2, ProgramStatementV2, SelectionStatementV2 } from "./canonicalV2";
import type { ConceptualFlowProjection } from "./conceptualFlow";
import { describeConditionV2, describeValueV2 } from "./v2Semantics";

export type ProductConcept = "portfolio" | "investment" | "sleeve" | "assets" | "qualification" | "selection" | "fallback" | "cooldown" | "split" | "allocation" | "timing" | "rebalance" | "control";
export type ProductAddress =
  | { canonical: "v1"; concept: ProductConcept; componentId: string | null; groupId?: string | null; fieldPath?: string | null }
  | { canonical: "v2"; concept: ProductConcept; semanticId: string; definitionId?: string | null };

export interface ProductNode {
  id: string;
  concept: ProductConcept;
  label: string;
  detail?: string;
  address: ProductAddress;
  children: ProductNode[];
}

export interface ProductFlowNode {
  id: string;
  label: string;
  detail?: string;
  role: "portfolio" | "capital" | "routing" | "behavior" | "timing";
  address: ProductAddress;
}

export interface ProductStrategyProjection {
  name: string;
  root: ProductNode;
  flow: ProductFlowNode[];
  sourceVersion: "v1" | "v2";
}

function role(node: ProductNode): ProductFlowNode["role"] {
  if (node.concept === "portfolio") return "portfolio";
  if (node.concept === "timing" || node.concept === "rebalance") return "timing";
  if (["qualification", "selection", "control"].includes(node.concept)) return "routing";
  if (node.concept === "fallback" || node.concept === "cooldown") return "behavior";
  return "capital";
}

function flowFromRoot(root: ProductNode, includeSelection = false): ProductFlowNode[] {
  const result: ProductFlowNode[] = [];
  const hiddenConcepts: ProductConcept[] = includeSelection
    ? ["assets", "qualification"]
    : ["assets", "qualification", "selection"];
  const visit = (node: ProductNode) => {
    // Flow stays capital-first while Selection remains a visible routing decision.
    if (!hiddenConcepts.includes(node.concept)) {
      result.push({ id: node.id, label: node.label, detail: node.detail, role: role(node), address: node.address });
    }
    node.children.forEach(visit);
  };
  visit(root);
  return result;
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
  return { name: value.title, root, flow: flowFromRoot(root), sourceVersion: "v1" };
}

function flatten(items: ProgramStatementV2[]): ProgramStatementV2[] {
  return items.flatMap((item) => [item,
    ...(item.kind === "control" ? flatten([...item.then_statements, ...item.otherwise_statements]) : []),
    ...(item.kind === "on_event" ? flatten(item.statements) : []),
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
  const selections = flatten(roots).filter((item): item is SelectionStatementV2 => item.kind === "select");
  const investments: ProductNode[] = strategy.definitions.groups.map((group) => {
    const statement = selections.find((item) => item.selection.universe_id === group.id);
    const selection = statement?.selection;
    const assets = strategy.definitions.asset_sets.find((item) => item.id === group.asset_set_ref);
    const children: ProductNode[] = [{ id: `assets:${assets?.id ?? group.asset_set_ref}`, concept: "assets", label: "Assets", detail: assets?.assets.length ? assets.assets.join(", ") : "Choose assets", address: { canonical: "v2", concept: "assets", semanticId: group.id, definitionId: assets?.id ?? group.asset_set_ref }, children: [] }];
    if (selection?.eligibility && statement) children.push({ id: `qualification:${statement.semantic_id}`, concept: "qualification", label: "Qualification", detail: describeConditionV2(selection.eligibility), address: { canonical: "v2", concept: "qualification", semanticId: statement.semantic_id }, children: [] });
    if (selection && statement) children.push({ id: statement.semantic_id, concept: "selection", label: `Choose ${selection.count} assets`, detail: `${selection.direction === "descending" ? "highest" : "lowest"} ${describeValueV2(selection.ranking)}`, address: { canonical: "v2", concept: "selection", semanticId: statement.semantic_id }, children: [] });
    if (selection?.fallback_asset && statement) children.push({ id: `fallback:${statement.semantic_id}`, concept: "fallback", label: "Fallback", detail: `Otherwise → ${selection.fallback_asset}`, address: { canonical: "v2", concept: "fallback", semanticId: statement.semantic_id }, children: [] });
    return { id: `investment:${group.id}`, concept: "investment", label: group.name || "Investment", detail: "100%", address: { canonical: "v2", concept: "investment", semanticId: group.id }, children };
  });
  const split = roots.find((item): item is Extract<ProgramStatementV2, { kind: "allocate" }> => item.kind === "allocate" && item.method === "fixed" && item.legs.filter((leg) => leg.target.kind === "group").length > 1);
  const controls: ProductNode[] = roots.filter((item) => item.kind === "control").map((item) => ({ id: item.semantic_id, concept: "control", label: "IF / OTHERWISE", detail: describeConditionV2(item.condition), address: { canonical: "v2", concept: "control", semanticId: item.semantic_id }, children: [] }));
  const capital: ProductNode[] = split ? [{ id: "split", concept: "split", label: "Split", detail: split.legs.map((leg) => `${Number(leg.weight ?? 0) * 100}%`).join(" / "), address: { canonical: "v2", concept: "split", semanticId: split.semantic_id }, children: investments }] : investments;
  if (selections.length && strategy.program?.clocks[0]) capital.push({ id: "rebalance", concept: "rebalance", label: "Rebalance", detail: `${strategy.program.clocks[0].timeframe[0]!.toUpperCase()}${strategy.program.clocks[0].timeframe.slice(1)} close`, address: { canonical: "v2", concept: "rebalance", semanticId: strategy.program.clocks[0].id }, children: [] });
  const root: ProductNode = { id: "portfolio", concept: "portfolio", label: "Portfolio", address: { canonical: "v2", concept: "portfolio", semanticId: strategy.program?.semantic_id ?? "program" }, children: [...capital, ...controls] };
  return { name: strategy.metadata.name, root, flow: flowFromRoot(root, true), sourceVersion: "v2" };
}

