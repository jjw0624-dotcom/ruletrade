import type { CanonicalComponent, CanonicalStrategyV1, RegistryPayload } from "./canonical";
import { resolvedConfigValue } from "./patch";

export interface GoldenGuidedProjection {
  kind: "golden";
  growth: {
    assets: string[];
    selectionComponentId: string;
    randomCount: number;
    resample: string;
    allocationComponentId: string;
    total: string;
  };
  safe: {
    assets: string[];
    allocationComponentId: string;
    total: string;
  };
}

export interface MomentumGuidedProjection {
  kind: "momentum";
  momentum: {
    assets: string[];
    lookbackComponentId: string;
    lookbackBars: number;
    filterComponentId?: string;
    threshold?: string;
    rankDirection: string;
    selectionComponentId: string;
    topN: number;
    fallbackComponentId?: string;
    fallbackAssetSetRef?: string;
    fallbackAsset?: string;
    fallbackOptions: Array<{ id: string; asset: string }>;
    total: string;
    schedule: string;
  };
}

export interface PortfolioGuidedProjection {
  kind: "portfolio";
  portfolio: { componentId: string; name: string };
  growth: MomentumGuidedProjection["momentum"] & {
    sleeveComponentId: string;
    sleeveName: string;
    allocation: string;
    refreshScheduleComponentId?: string;
    refreshSchedule?: string;
  };
  defensive: {
    sleeveComponentId: string;
    sleeveName: string;
    allocation: string;
    assets: string[];
    refreshScheduleComponentId?: string;
    refreshSchedule?: string;
  };
  rebalanceScheduleComponentId?: string;
  rebalanceSchedule?: string;
}

export type GuidedProjection = GoldenGuidedProjection | MomentumGuidedProjection | PortfolioGuidedProjection;

function requireComponent(strategy: CanonicalStrategyV1, id: string): CanonicalComponent {
  const component = strategy.graph.components.find((item) => item.id === id);
  if (!component) throw new Error(`Guided View requires component ${id}`);
  return component;
}

function assetsFor(strategy: CanonicalStrategyV1, componentId: string): string[] {
  const component = requireComponent(strategy, componentId);
  const reference = component.primitive === "fallback@1"
    ? component.config.fallback_asset_set_ref
    : component.config.asset_set_ref;
  const definition = strategy.definitions.asset_sets.find((item) => item.id === reference);
  if (!definition) throw new Error(`Guided View cannot resolve asset set ${String(reference)}`);
  return definition.assets;
}

function scheduleForTarget(strategy: CanonicalStrategyV1, targetId: string) {
  const entrypoint = strategy.entrypoints.find((item) => item.target_component_id === targetId);
  const component = strategy.graph.components.find(
    (item) => item.id === entrypoint?.event_component_id,
  );
  if (!component) return undefined;
  return {
    componentId: component.id,
    label: component.primitive === "quarterly@1" ? "Quarterly" : "Monthly",
  };
}

export function projectGuided(
  strategy: CanonicalStrategyV1,
  registry: RegistryPayload,
): GuidedProjection {
  const topN = strategy.graph.components.find((item) => item.primitive === "top_n@1");
  if (topN) {
    const trailingReturn = strategy.graph.components.find((item) => item.primitive === "trailing_return@1");
    const rank = strategy.graph.components.find((item) => item.primitive === "rank@1");
    const filter = strategy.graph.components.find((item) => item.primitive === "filter@1");
    const assets = strategy.graph.components.find((item) => item.primitive === "asset_set@1");
    const weighting = strategy.graph.components.find((item) => item.primitive === "equal_weight@1");
    const fallback = strategy.graph.components.find((item) => item.primitive === "fallback@1");
    if (!trailingReturn || !rank || !assets || !weighting) {
      throw new Error("Guided View cannot project the Momentum strategy");
    }
    const lookbackBars = resolvedConfigValue(strategy, registry, trailingReturn.id, "lookback_bars");
    const count = resolvedConfigValue(strategy, registry, topN.id, "count");
    const direction = resolvedConfigValue(strategy, registry, rank.id, "direction");
    if (typeof lookbackBars !== "number" || typeof count !== "number" || typeof direction !== "string") {
      throw new Error("Guided View cannot project Momentum settings");
    }
    const momentum = {
        assets: assetsFor(strategy, assets.id),
        lookbackComponentId: trailingReturn.id,
        lookbackBars,
        filterComponentId: filter?.id,
        threshold: filter
          ? String(resolvedConfigValue(strategy, registry, filter.id, "threshold"))
          : undefined,
        rankDirection: direction,
        selectionComponentId: topN.id,
        topN: count,
        fallbackComponentId: fallback?.id,
        fallbackAssetSetRef: fallback
          ? String(resolvedConfigValue(strategy, registry, fallback.id, "fallback_asset_set_ref"))
          : undefined,
        fallbackAsset: fallback ? assetsFor(strategy, fallback.id).at(0) : undefined,
        fallbackOptions: strategy.definitions.asset_sets
          .filter((definition) => definition.assets.length === 1)
          .map((definition) => ({ id: definition.id, asset: definition.assets[0] })),
        total: String(resolvedConfigValue(strategy, registry, weighting.id, "total")),
        schedule: "Monthly",
    };
    const sleeveComponents = strategy.graph.components.filter(
      (item) => item.primitive === "portfolio_sleeve@1",
    );
    const portfolio = strategy.graph.components.find((item) => item.primitive === "portfolio@1");
    if (portfolio && sleeveComponents.length === 2) {
      const growthSleeve = sleeveComponents.find((item) => item.id === "growth_sleeve") ?? sleeveComponents[0];
      const defensiveSleeve = sleeveComponents.find((item) => item.id === "defensive_sleeve") ?? sleeveComponents[1];
      const defensiveAssets = strategy.graph.components.find((item) => item.id === "defensive_assets");
      const growthSchedule = scheduleForTarget(strategy, growthSleeve.id);
      const defensiveSchedule = scheduleForTarget(strategy, defensiveSleeve.id);
      const rebalanceSchedule = scheduleForTarget(strategy, "rebalance");
      if (!defensiveAssets) throw new Error("Guided View cannot project Defensive sleeve assets");
      return {
        kind: "portfolio",
        portfolio: { componentId: portfolio.id, name: String(portfolio.config.name) },
        growth: {
          ...momentum,
          sleeveComponentId: growthSleeve.id,
          sleeveName: String(growthSleeve.config.name),
          allocation: String(growthSleeve.config.allocation),
          refreshScheduleComponentId: growthSchedule?.componentId,
          refreshSchedule: growthSchedule?.label,
        },
        defensive: {
          sleeveComponentId: defensiveSleeve.id,
          sleeveName: String(defensiveSleeve.config.name),
          allocation: String(defensiveSleeve.config.allocation),
          assets: assetsFor(strategy, defensiveAssets.id),
          refreshScheduleComponentId: defensiveSchedule?.componentId,
          refreshSchedule: defensiveSchedule?.label,
        },
        rebalanceScheduleComponentId: rebalanceSchedule?.componentId,
        rebalanceSchedule: rebalanceSchedule?.label,
      };
    }
    return {
      kind: "momentum",
      momentum,
    };
  }
  const randomCount = resolvedConfigValue(strategy, registry, "growth_random", "count");
  const resample = resolvedConfigValue(strategy, registry, "growth_random", "resample");
  const growthTotal = resolvedConfigValue(strategy, registry, "growth_weights", "total");
  const safeTotal = resolvedConfigValue(strategy, registry, "safe_weights", "total");
  if (typeof randomCount !== "number" || typeof resample !== "string") {
    throw new Error("Guided View cannot project the Growth selection");
  }

  return {
    kind: "golden",
    growth: {
      assets: assetsFor(strategy, "growth_assets"),
      selectionComponentId: "growth_random",
      randomCount,
      resample,
      allocationComponentId: "growth_weights",
      total: String(growthTotal),
    },
    safe: {
      assets: assetsFor(strategy, "safe_assets"),
      allocationComponentId: "safe_weights",
      total: String(safeTotal),
    },
  };
}
