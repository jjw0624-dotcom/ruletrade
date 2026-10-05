import type { CanonicalStrategyV1, ConditionExpression, RegistryPayload, ValueExpression } from "./canonical";
import { tryProjectSemanticStrategy, type SemanticGroup } from "./semanticProjection";
import { describeConditionExpression, describeSelectionSummary, describeUniverse, describeValueExpression } from "./valueSemantics";

export interface ConceptualChoose {
  kind: "choose";
  label: string;
  from: string[];
  condition?: string;
  eligibilityCondition?: ConditionExpression;
  eligibilityFieldPath?: "condition" | "config.threshold";
  ranking?: string;
  rankingValue?: ValueExpression;
  otherwise?: string;
  cooldown?: string;
  timing?: string;
  sourceComponentIds: string[];
  lookbackComponentId?: string;
  filterComponentId?: string;
  selectionComponentId: string;
  fallbackComponentId?: string;
  fallbackAssetSetRef?: string;
  fallbackOptions: Array<{ id: string; asset: string }>;
  cooldownComponentId?: string;
  scheduleComponentId?: string;
  lookbackBars?: number;
  threshold?: string;
  rankDirection?: string;
  rankComponentId?: string;
  topN?: number;
  cooldownDuration?: number;
  selectionMode: "ranked" | "random";
  resample?: string;
}
export interface ConceptualGroup {
  id: string;
  label: string;
  allocation?: string;
  assets: string[];
  timing?: string;
  choose?: ConceptualChoose;
  sourceComponentIds: string[];
  assetSetId?: string;
  universeComponentId?: string;
  universeLabel?: string;
  allocationComponentId?: string;
  sleeveComponentId?: string;
  allocationValue?: string;
  scheduleComponentId?: string;
}
export interface ConceptualFlowProjection {
  kind: "portfolio" | "single";
  title: string;
  groups: ConceptualGroup[];
  rebalance?: string;
  sourceComponentIds: string[];
  split?: { groups: Array<{ id: string; label: string; componentId: string; allocation: string }> };
  rebalanceScheduleComponentId?: string;
  portfolioComponentId?: string;
  unsupportedReason?: string;
  predicate?: { componentId: string; label: string; thenTarget?: string; otherwiseTarget?: string };
}

const percentage = (value: string) => new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 }).format(Number(value));
export function projectConceptualFlow(strategy: CanonicalStrategyV1, registry: RegistryPayload): ConceptualFlowProjection {
  const result = tryProjectSemanticStrategy(strategy, registry);
  if (!result.supported) return { kind: "single", title: strategy.metadata.name, groups: [], sourceComponentIds: [], unsupportedReason: result.reason };
  const semantic = result.projection;
  const groups = semantic.groups.map((group) => conceptualGroup(group, strategy));
  const rule = strategy.graph.components.find((item) => item.primitive === "rule@1");
  const actionTarget = (action: unknown) => {
    if (!action || typeof action !== "object" || Array.isArray(action)) return undefined;
    const targets = (action as Record<string, unknown>).targets;
    if (!targets || typeof targets !== "object" || Array.isArray(targets)) return undefined;
    const componentId = (targets as Record<string, unknown>).component_id;
    return typeof componentId === "string" ? componentId : undefined;
  };
  const predicate = rule?.condition ? {
    componentId: rule.id,
    label: describeConditionExpression(rule.condition),
    thenTarget: actionTarget(rule.actions[0]),
    otherwiseTarget: actionTarget(rule.else_actions?.[0]),
  } : undefined;
  return {
    kind: semantic.kind, title: semantic.title, groups,
    rebalance: semantic.rebalanceSchedule,
    rebalanceScheduleComponentId: semantic.rebalanceScheduleComponentId,
    portfolioComponentId: semantic.portfolioComponentId,
    sourceComponentIds: [semantic.portfolioComponentId, ...semantic.groups.flatMap((group) => [group.sleeveComponentId, ...groupSourceIds(group)])].filter((id): id is string => Boolean(id)),
    split: semantic.portfolioComponentId ? { groups: semantic.groups.map((group) => ({ id: group.id, label: group.name, componentId: group.sleeveComponentId!, allocation: group.allocation })) } : undefined,
    predicate,
  };
}

function groupSourceIds(group: SemanticGroup): string[] {
  const pipeline = group.pipeline;
  return [pipeline.assetComponentId, pipeline.allocationComponentId, pipeline.lookbackComponentId,
    pipeline.filterComponentId, pipeline.rankComponentId, pipeline.selectionComponentId,
    pipeline.fallbackComponentId, pipeline.cooldownComponentId].filter((id): id is string => Boolean(id));
}

function conceptualGroup(group: SemanticGroup, strategy: CanonicalStrategyV1): ConceptualGroup {
  const pipeline = group.pipeline;
  return {
    id: group.id, label: group.name, allocation: percentage(group.allocation), assets: pipeline.assets,
    timing: group.refreshSchedule ?? pipeline.schedule, sourceComponentIds: groupSourceIds(group),
    assetSetId: pipeline.assetSetId, universeComponentId: pipeline.assetComponentId,
    universeLabel: describeUniverse(strategy, pipeline.assetComponentId) ?? "Assets",
    allocationComponentId: pipeline.allocationComponentId, sleeveComponentId: group.sleeveComponentId,
    allocationValue: group.allocation, scheduleComponentId: group.refreshScheduleComponentId,
    choose: pipeline.selectionComponentId ? chooseFrom(group, strategy) : undefined,
  };
}

function chooseFrom(group: SemanticGroup, strategy: CanonicalStrategyV1): ConceptualChoose {
  const value = group.pipeline;
  if (value.selectionMode === "random") return {
    kind: "choose", label: `Choose ${value.randomCount}`, from: value.assets, ranking: "Choose randomly",
    selectionMode: "random", resample: value.resample, sourceComponentIds: [value.selectionComponentId!],
    selectionComponentId: value.selectionComponentId!, fallbackOptions: [], topN: value.randomCount,
  };
  const filter = value.filterComponentId
    ? strategy.graph.components.find((item) => item.id === value.filterComponentId) : undefined;
  const eligibilityCondition = filter?.condition ?? (filter && value.lookbackBars ? {
    kind: "comparison" as const,
    operator: "gt" as const,
    left: {
      kind: "indicator" as const,
      indicator_id: "trailing_return_indicator@1",
      asset: { kind: "candidate" as const },
      parameters: { lookback_bars: value.lookbackBars },
    },
    right: { kind: "literal" as const, value_type: "percentage", value: Number(value.threshold ?? 0) },
  } : undefined);
  const rank = value.rankComponentId
    ? strategy.graph.components.find((item) => item.id === value.rankComponentId) : undefined;
  const rankingValue = rank?.value_expression ?? (value.lookbackBars ? {
    kind: "indicator" as const,
    indicator_id: "trailing_return_indicator@1",
    asset: { kind: "candidate" as const },
    parameters: { lookback_bars: value.lookbackBars },
  } : undefined);
  return {
    kind: "choose", label: describeSelectionSummary(value.topN ?? 1, eligibilityCondition ? 1 : 0, rankingValue, value.rankDirection), from: value.assets,
    selectionMode:"ranked",
    condition: eligibilityCondition ? describeConditionExpression(eligibilityCondition) : undefined,
    eligibilityCondition,
    eligibilityFieldPath: filter?.condition ? "condition" : filter ? "config.threshold" : undefined,
    ranking: rankingValue ? describeValueExpression(rankingValue) : undefined,
    rankingValue,
    otherwise: value.fallbackAsset ? `Otherwise → ${value.fallbackAsset}` : undefined,
    cooldown: value.cooldownDuration ? `After selling, wait ${value.cooldownDuration} trading days` : undefined,
    timing: value.schedule, sourceComponentIds: groupSourceIds(group),
    lookbackComponentId: value.lookbackComponentId, filterComponentId: value.filterComponentId,
    selectionComponentId: value.selectionComponentId!, fallbackComponentId: value.fallbackComponentId,
    fallbackAssetSetRef: value.fallbackAssetSetRef, fallbackOptions: value.fallbackOptions,
    cooldownComponentId: value.cooldownComponentId, scheduleComponentId: group.refreshScheduleComponentId ?? value.scheduleComponentId,
    lookbackBars: value.lookbackBars, threshold: value.threshold, rankDirection: value.rankDirection,
    rankComponentId:value.rankComponentId, topN: value.topN, cooldownDuration: value.cooldownDuration,
  };
}
export const conceptualOnlyAllocationExample = {
  supported: false,
  label: "Conditional allocation concept",
  summary: "When Index > 5,000: Growth 70% / Safe 30%. Otherwise: 60% / 40%.",
  reason: "Current Canonical strategies do not express this allocation condition.",
} as const;
