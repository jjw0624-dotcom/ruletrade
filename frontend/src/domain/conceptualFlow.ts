import type { CanonicalStrategyV1, RegistryPayload } from "./canonical";
import { tryProjectSemanticStrategy, type SemanticGroup } from "./semanticProjection";

export interface ConceptualChoose {
  kind: "choose";
  label: string;
  from: string[];
  condition?: string;
  ranking?: string;
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
}

const percentage = (value: string) => new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 }).format(Number(value));
export function projectConceptualFlow(strategy: CanonicalStrategyV1, registry: RegistryPayload): ConceptualFlowProjection {
  const result = tryProjectSemanticStrategy(strategy, registry);
  if (!result.supported) return { kind: "single", title: strategy.metadata.name, groups: [], sourceComponentIds: [], unsupportedReason: result.reason };
  const semantic = result.projection;
  const groups = semantic.groups.map(conceptualGroup);
  return {
    kind: semantic.kind, title: semantic.title, groups,
    rebalance: semantic.rebalanceSchedule,
    rebalanceScheduleComponentId: semantic.rebalanceScheduleComponentId,
    portfolioComponentId: semantic.portfolioComponentId,
    sourceComponentIds: [semantic.portfolioComponentId, ...semantic.groups.flatMap((group) => [group.sleeveComponentId, ...groupSourceIds(group)])].filter((id): id is string => Boolean(id)),
    split: semantic.portfolioComponentId ? { groups: semantic.groups.map((group) => ({ id: group.id, label: group.name, componentId: group.sleeveComponentId!, allocation: group.allocation })) } : undefined,
  };
}

function groupSourceIds(group: SemanticGroup): string[] {
  const pipeline = group.pipeline;
  return [pipeline.assetComponentId, pipeline.allocationComponentId, pipeline.lookbackComponentId,
    pipeline.filterComponentId, pipeline.rankComponentId, pipeline.selectionComponentId,
    pipeline.fallbackComponentId, pipeline.cooldownComponentId].filter((id): id is string => Boolean(id));
}

function conceptualGroup(group: SemanticGroup): ConceptualGroup {
  const pipeline = group.pipeline;
  return {
    id: group.id, label: group.name, allocation: percentage(group.allocation), assets: pipeline.assets,
    timing: group.refreshSchedule ?? pipeline.schedule, sourceComponentIds: groupSourceIds(group),
    assetSetId: pipeline.assetSetId, universeComponentId: pipeline.assetComponentId,
    allocationComponentId: pipeline.allocationComponentId, sleeveComponentId: group.sleeveComponentId,
    allocationValue: group.allocation, scheduleComponentId: group.refreshScheduleComponentId,
    choose: pipeline.selectionComponentId ? chooseFrom(group) : undefined,
  };
}

function chooseFrom(group: SemanticGroup): ConceptualChoose {
  const value = group.pipeline;
  if (value.selectionMode === "random") return {
    kind: "choose", label: `Choose ${value.randomCount}`, from: value.assets, ranking: "Choose randomly",
    selectionMode: "random", resample: value.resample, sourceComponentIds: [value.selectionComponentId!],
    selectionComponentId: value.selectionComponentId!, fallbackOptions: [], topN: value.randomCount,
  };
  const months = Math.max(1, Math.round(value.lookbackBars! / 21));
  return {
    kind: "choose", label: `Choose ${value.topN}`, from: value.assets,
    selectionMode:"ranked",
    condition: value.threshold === undefined ? undefined : `${months}M return > ${percentage(value.threshold)}`,
    ranking: value.rankDirection === "descending" || value.rankDirection === "desc" ? "Strongest first" : "Weakest first",
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
