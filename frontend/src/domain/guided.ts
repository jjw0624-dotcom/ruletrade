import type { CanonicalStrategyV1, RegistryPayload } from "./canonical";
import { projectSemanticStrategy, type SemanticGroup } from "./semanticProjection";

export interface GoldenGuidedProjection {
  kind: "golden";
  growth: { assets: string[]; assetSetId: string; assetComponentId: string; selectionComponentId: string; randomCount: number; resample: string; allocationComponentId: string; total: string };
  safe: { assets: string[]; assetSetId: string; assetComponentId: string; allocationComponentId: string; total: string };
}
export interface SingleInvestmentGuidedProjection {
  kind: "single";
  investment: { assets: string[]; assetSetId: string; assetComponentId: string; total: string; allocationComponentId: string; schedule: string; scheduleComponentId?: string };
}
interface RankedGuidedSelection {
  assets: string[]; assetSetId: string; assetComponentId: string; allocationComponentId: string;
  lookbackComponentId: string; lookbackBars: number; filterComponentId?: string; threshold?: string;
  rankDirection: string; rankComponentId: string; selectionComponentId: string; topN: number;
  fallbackComponentId?: string; fallbackAssetSetRef?: string; fallbackAsset?: string;
  fallbackOptions: Array<{ id: string; asset: string }>;
  cooldownComponentId?: string; cooldownDuration?: number; cooldownUnit?: string;
  total: string; schedule: string; scheduleComponentId?: string;
}
export interface MomentumGuidedProjection { kind: "momentum"; momentum: RankedGuidedSelection }
export interface PortfolioGuidedProjection {
  kind: "portfolio";
  portfolio: { componentId: string; name: string };
  growth: RankedGuidedSelection & { sleeveComponentId: string; sleeveName: string; allocation: string; refreshScheduleComponentId?: string; refreshSchedule?: string };
  defensive: { sleeveComponentId: string; sleeveName: string; allocation: string; assets: string[]; assetSetId: string; assetComponentId: string; allocationComponentId: string; refreshScheduleComponentId?: string; refreshSchedule?: string };
  rebalanceScheduleComponentId?: string;
  rebalanceSchedule?: string;
}
export type GuidedProjection = SingleInvestmentGuidedProjection | GoldenGuidedProjection | MomentumGuidedProjection | PortfolioGuidedProjection;

function ranked(group: SemanticGroup): RankedGuidedSelection {
  const pipeline = group.pipeline;
  if (pipeline.selectionMode !== "ranked" || !pipeline.selectionComponentId
    || !pipeline.lookbackComponentId || pipeline.lookbackBars === undefined
    || !pipeline.rankComponentId || !pipeline.rankDirection || pipeline.topN === undefined) {
    throw new Error(`Guide cannot project ranked selection for ${group.id}`);
  }
  return {
    assets: pipeline.assets, assetSetId: pipeline.assetSetId, assetComponentId: pipeline.assetComponentId,
    allocationComponentId: pipeline.allocationComponentId, lookbackComponentId: pipeline.lookbackComponentId,
    lookbackBars: pipeline.lookbackBars, filterComponentId: pipeline.filterComponentId,
    threshold: pipeline.threshold, rankDirection: pipeline.rankDirection, rankComponentId: pipeline.rankComponentId,
    selectionComponentId: pipeline.selectionComponentId, topN: pipeline.topN,
    fallbackComponentId: pipeline.fallbackComponentId, fallbackAssetSetRef: pipeline.fallbackAssetSetRef,
    fallbackAsset: pipeline.fallbackAsset, fallbackOptions: pipeline.fallbackOptions,
    cooldownComponentId: pipeline.cooldownComponentId, cooldownDuration: pipeline.cooldownDuration,
    cooldownUnit: pipeline.cooldownUnit, total: pipeline.total, schedule: pipeline.schedule,
    scheduleComponentId: pipeline.scheduleComponentId,
  };
}

export function projectGuided(strategy: CanonicalStrategyV1, registry: RegistryPayload): GuidedProjection {
  const semantic = projectSemanticStrategy(strategy, registry);
  if (semantic.kind === "portfolio" && semantic.portfolioComponentId) {
    const growth = semantic.groups.find((group) => group.pipeline.selectionMode === "ranked");
    const defensive = semantic.groups.find((group) => group !== growth);
    if (!growth?.sleeveComponentId || !defensive?.sleeveComponentId) throw new Error("Guide requires one ranked and one defensive sleeve");
    return {
      kind: "portfolio", portfolio: { componentId: semantic.portfolioComponentId, name: semantic.title },
      growth: { ...ranked(growth), sleeveComponentId: growth.sleeveComponentId, sleeveName: growth.name, allocation: growth.allocation, refreshScheduleComponentId: growth.refreshScheduleComponentId, refreshSchedule: growth.refreshSchedule },
      defensive: { sleeveComponentId: defensive.sleeveComponentId, sleeveName: defensive.name, allocation: defensive.allocation, assets: defensive.pipeline.assets, assetSetId: defensive.pipeline.assetSetId, assetComponentId: defensive.pipeline.assetComponentId, allocationComponentId: defensive.pipeline.allocationComponentId, refreshScheduleComponentId: defensive.refreshScheduleComponentId, refreshSchedule: defensive.refreshSchedule },
      rebalanceScheduleComponentId: semantic.rebalanceScheduleComponentId, rebalanceSchedule: semantic.rebalanceSchedule,
    };
  }
  if (semantic.kind === "portfolio") {
    const growth = semantic.groups.find((group) => group.pipeline.selectionComponentId);
    const safe = semantic.groups.find((group) => group !== growth);
    if (!growth?.pipeline.selectionComponentId || growth.pipeline.randomCount === undefined || !growth.pipeline.resample || !safe) throw new Error("Guide cannot project merged portfolio");
    return {
      kind: "golden",
      growth: { assets: growth.pipeline.assets, assetSetId: growth.pipeline.assetSetId, assetComponentId: growth.pipeline.assetComponentId, selectionComponentId: growth.pipeline.selectionComponentId, randomCount: growth.pipeline.randomCount, resample: growth.pipeline.resample, allocationComponentId: growth.pipeline.allocationComponentId, total: growth.pipeline.total },
      safe: { assets: safe.pipeline.assets, assetSetId: safe.pipeline.assetSetId, assetComponentId: safe.pipeline.assetComponentId, allocationComponentId: safe.pipeline.allocationComponentId, total: safe.pipeline.total },
    };
  }
  const group = semantic.groups[0];
  if (group.pipeline.selectionMode === "ranked" && group.pipeline.selectionComponentId) return { kind: "momentum", momentum: ranked(group) };
  return { kind: "single", investment: { assets: group.pipeline.assets, assetSetId: group.pipeline.assetSetId, assetComponentId: group.pipeline.assetComponentId, total: group.pipeline.total, allocationComponentId: group.pipeline.allocationComponentId, schedule: group.pipeline.schedule, scheduleComponentId: group.pipeline.scheduleComponentId } };
}
