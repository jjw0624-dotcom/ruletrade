import type { CanonicalStrategyV1, RegistryPayload } from "./canonical";
import { projectGuided } from "./guided";

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
}

const percentage = (value: string) => new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 }).format(Number(value));
export function projectConceptualFlow(strategy: CanonicalStrategyV1, registry: RegistryPayload): ConceptualFlowProjection {
  const guided = projectGuided(strategy, registry);
  if (guided.kind === "portfolio") {
    return {
      kind: "portfolio", title: guided.portfolio.name, rebalance: guided.rebalanceSchedule,
      sourceComponentIds: [guided.portfolio.componentId, guided.growth.sleeveComponentId, guided.defensive.sleeveComponentId],
      split: { groups: [{ id: guided.growth.sleeveComponentId, label: guided.growth.sleeveName, componentId: guided.growth.sleeveComponentId, allocation: guided.growth.allocation }, { id: guided.defensive.sleeveComponentId, label: guided.defensive.sleeveName, componentId: guided.defensive.sleeveComponentId, allocation: guided.defensive.allocation }] },
      rebalanceScheduleComponentId: guided.rebalanceScheduleComponentId,
      groups: [
        {
          id: guided.growth.sleeveComponentId, label: guided.growth.sleeveName, allocation: percentage(guided.growth.allocation), assets: guided.growth.assets,
          timing: guided.growth.refreshSchedule ?? guided.growth.schedule,
          sourceComponentIds: [guided.growth.sleeveComponentId, guided.growth.lookbackComponentId, guided.growth.selectionComponentId, ...(guided.growth.filterComponentId ? [guided.growth.filterComponentId] : []), ...(guided.growth.fallbackComponentId ? [guided.growth.fallbackComponentId] : []), ...(guided.growth.cooldownComponentId ? [guided.growth.cooldownComponentId] : [])],
          assetSetId: guided.growth.assetSetId, sleeveComponentId: guided.growth.sleeveComponentId, allocationValue: guided.growth.allocation, scheduleComponentId: guided.growth.refreshScheduleComponentId,
          choose: chooseFrom(guided.growth),
        },
        { id: guided.defensive.sleeveComponentId, label: guided.defensive.sleeveName, allocation: percentage(guided.defensive.allocation), assets: guided.defensive.assets, timing: guided.defensive.refreshSchedule, sourceComponentIds: [guided.defensive.sleeveComponentId], assetSetId: guided.defensive.assetSetId, sleeveComponentId: guided.defensive.sleeveComponentId, allocationValue: guided.defensive.allocation, scheduleComponentId: guided.defensive.refreshScheduleComponentId },
      ],
    };
  }
  if (guided.kind === "momentum") return { kind: "single", title: strategy.metadata.name, rebalance: guided.momentum.schedule, sourceComponentIds: [guided.momentum.lookbackComponentId, guided.momentum.selectionComponentId], rebalanceScheduleComponentId: guided.momentum.scheduleComponentId, groups: [{ id: "strategy", label: "Assets", assets: guided.momentum.assets, timing: guided.momentum.schedule, sourceComponentIds: [guided.momentum.lookbackComponentId, guided.momentum.selectionComponentId], assetSetId: guided.momentum.assetSetId, choose: chooseFrom(guided.momentum) }] };
  if (guided.kind === "single") return {
    kind: "single",
    title: strategy.metadata.name,
    rebalance: guided.investment.schedule,
    sourceComponentIds: [guided.investment.assetComponentId],
    rebalanceScheduleComponentId: guided.investment.scheduleComponentId,
    groups: [{ id: "investment", label: "Investment", allocation: percentage(guided.investment.total), assets: guided.investment.assets, timing: guided.investment.schedule, sourceComponentIds: [guided.investment.assetComponentId], assetSetId: guided.investment.assetSetId }],
  };
  return {
    kind: "portfolio", title: strategy.metadata.name, sourceComponentIds: [guided.growth.selectionComponentId, guided.growth.allocationComponentId, guided.safe.allocationComponentId],
    groups: [
      { id: "growth", label: "Growth", allocation:percentage(guided.growth.total), allocationValue:guided.growth.total, assets: guided.growth.assets, assetSetId: guided.growth.assetSetId, sourceComponentIds: [guided.growth.selectionComponentId, guided.growth.allocationComponentId], choose: { kind: "choose", label: `Choose ${guided.growth.randomCount}`, from: guided.growth.assets, ranking: "Choose randomly", selectionMode:"random", resample:guided.growth.resample, sourceComponentIds: [guided.growth.selectionComponentId], selectionComponentId: guided.growth.selectionComponentId, fallbackOptions: [], topN: guided.growth.randomCount } },
      { id: "safe", label: "Safe", allocation:percentage(guided.safe.total), allocationValue:guided.safe.total, assets: guided.safe.assets, assetSetId: guided.safe.assetSetId, sourceComponentIds: [guided.safe.allocationComponentId] },
    ],
  };
}
function chooseFrom(value: { assets: string[]; lookbackBars: number; threshold?: string; rankDirection: string; rankComponentId:string; topN: number; fallbackAsset?: string; fallbackAssetSetRef?: string; fallbackOptions: Array<{id:string;asset:string}>; cooldownDuration?: number; schedule: string; scheduleComponentId?:string; lookbackComponentId: string; filterComponentId?: string; selectionComponentId: string; fallbackComponentId?: string; cooldownComponentId?: string; refreshScheduleComponentId?: string }): ConceptualChoose {
  const months = Math.max(1, Math.round(value.lookbackBars / 21));
  return {
    kind: "choose", label: `Choose ${value.topN}`, from: value.assets,
    selectionMode:"ranked",
    condition: value.threshold === undefined ? undefined : `${months}M return > ${percentage(value.threshold)}`,
    ranking: value.rankDirection === "descending" || value.rankDirection === "desc" ? "Strongest first" : "Weakest first",
    otherwise: value.fallbackAsset ? `Otherwise → ${value.fallbackAsset}` : undefined,
    cooldown: value.cooldownDuration ? `After selling, wait ${value.cooldownDuration} trading days` : undefined,
    timing: value.schedule,
    sourceComponentIds: [value.lookbackComponentId, value.selectionComponentId, ...(value.filterComponentId ? [value.filterComponentId] : []), ...(value.fallbackComponentId ? [value.fallbackComponentId] : []), ...(value.cooldownComponentId ? [value.cooldownComponentId] : [])],
    lookbackComponentId: value.lookbackComponentId, filterComponentId: value.filterComponentId, selectionComponentId: value.selectionComponentId, fallbackComponentId: value.fallbackComponentId, fallbackAssetSetRef: value.fallbackAssetSetRef, fallbackOptions: value.fallbackOptions, cooldownComponentId: value.cooldownComponentId, scheduleComponentId: value.refreshScheduleComponentId ?? value.scheduleComponentId, lookbackBars: value.lookbackBars, threshold: value.threshold, rankDirection: value.rankDirection, rankComponentId:value.rankComponentId, topN: value.topN, cooldownDuration: value.cooldownDuration,
  };
}
export const conceptualOnlyAllocationExample = {
  supported: false,
  label: "Conditional allocation concept",
  summary: "When Index > 5,000: Growth 70% / Safe 30%. Otherwise: 60% / 40%.",
  reason: "Current Canonical strategies do not express this allocation condition.",
} as const;
