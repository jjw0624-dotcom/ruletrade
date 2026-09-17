import type { CanonicalComponent, CanonicalConnection, CanonicalStrategyV1, RegistryPayload } from "./canonical";
import { resolvedConfigValue } from "./patch";

export interface SemanticSelectionPipeline {
  assets: string[];
  assetSetId: string;
  assetComponentId: string;
  allocationComponentId: string;
  selectionMode: "ranked" | "random";
  selectionComponentId?: string;
  randomCount?: number;
  resample?: string;
  lookbackComponentId?: string;
  lookbackBars?: number;
  filterComponentId?: string;
  threshold?: string;
  rankDirection?: string;
  rankComponentId?: string;
  topN?: number;
  fallbackComponentId?: string;
  fallbackAssetSetRef?: string;
  fallbackAsset?: string;
  fallbackOptions: Array<{ id: string; asset: string }>;
  cooldownComponentId?: string;
  cooldownDuration?: number;
  cooldownUnit?: string;
  total: string;
  schedule: string;
  scheduleComponentId?: string;
}

export interface SemanticGroup {
  id: string;
  name: string;
  allocation: string;
  sleeveComponentId?: string;
  refreshScheduleComponentId?: string;
  refreshSchedule?: string;
  pipeline: SemanticSelectionPipeline;
}

export interface SemanticStrategyProjection {
  kind: "single" | "portfolio";
  title: string;
  portfolioComponentId?: string;
  groups: SemanticGroup[];
  rebalanceScheduleComponentId?: string;
  rebalanceSchedule?: string;
}

export type SemanticProjectionResult =
  | { supported: true; projection: SemanticStrategyProjection }
  | { supported: false; reason: string };

class ProjectionGraph {
  private readonly components = new Map<string, CanonicalComponent>();
  private readonly incoming = new Map<string, CanonicalConnection[]>();

  constructor(readonly strategy: CanonicalStrategyV1) {
    for (const component of strategy.graph.components) this.components.set(component.id, component);
    for (const connection of strategy.graph.connections) {
      const connections = this.incoming.get(connection.target.component_id) ?? [];
      connections.push(connection);
      this.incoming.set(connection.target.component_id, connections);
    }
  }

  component(id: string): CanonicalComponent | undefined { return this.components.get(id); }

  uniquePrimitive(primitive: string, within?: Set<string>): CanonicalComponent | undefined {
    const matches = this.strategy.graph.components.filter(
      (component) => component.primitive === primitive && (!within || within.has(component.id)),
    );
    if (matches.length > 1) throw new Error(`Expected one ${primitive} component, found ${matches.length}`);
    return matches[0];
  }

  sources(targetId: string): CanonicalComponent[] {
    return (this.incoming.get(targetId) ?? [])
      .map((connection) => this.component(connection.source.component_id))
      .filter((component): component is CanonicalComponent => Boolean(component));
  }

  ancestors(targetId: string): Set<string> {
    const found = new Set<string>();
    const pending = [targetId];
    while (pending.length > 0) {
      for (const source of this.sources(pending.pop()!)) {
        if (found.has(source.id)) continue;
        found.add(source.id);
        pending.push(source.id);
      }
    }
    return found;
  }
}

function scheduleForTarget(graph: ProjectionGraph, targetId: string) {
  const entrypoints = graph.strategy.entrypoints.filter((item) => item.target_component_id === targetId);
  if (entrypoints.length > 1) throw new Error(`Expected at most one schedule for ${targetId}`);
  const component = entrypoints[0] ? graph.component(entrypoints[0].event_component_id) : undefined;
  if (!component) return undefined;
  const labels: Record<string, string> = { "daily@1": "Daily", "monthly@1": "Monthly", "quarterly@1": "Quarterly" };
  const label = labels[component.primitive];
  if (!label) throw new Error(`Unsupported schedule primitive ${component.primitive}`);
  return { componentId: component.id, label };
}

function assetsFor(strategy: CanonicalStrategyV1, component: CanonicalComponent): { id: string; assets: string[] } {
  const reference = component.config.asset_set_ref;
  if (typeof reference !== "string") throw new Error(`Missing asset set reference on ${component.id}`);
  const definition = strategy.definitions.asset_sets.find((item) => item.id === reference);
  if (!definition) throw new Error(`Missing asset set ${reference}`);
  return { id: reference, assets: definition.assets };
}

function projectPipeline(
  graph: ProjectionGraph,
  registry: RegistryPayload,
  targetId: string,
): SemanticSelectionPipeline {
  const upstream = graph.ancestors(targetId);
  upstream.add(targetId);
  const weighting = graph.uniquePrimitive("equal_weight@1", upstream);
  const universe = graph.uniquePrimitive("asset_set@1", upstream);
  if (!weighting || !universe) throw new Error(`Selection path for ${targetId} needs one universe and weighting`);
  const assetSet = assetsFor(graph.strategy, universe);
  const ranked = graph.uniquePrimitive("top_n@1", upstream);
  const random = graph.uniquePrimitive("random_select@1", upstream);
  if (ranked && random) throw new Error(`Selection path for ${targetId} has two selection modes`);
  const schedule = scheduleForTarget(graph, targetId);
  const fallback = graph.uniquePrimitive("fallback@1", upstream);
  const cooldown = graph.uniquePrimitive("cooldown@1", upstream);
  const base: SemanticSelectionPipeline = {
    assets: assetSet.assets,
    assetSetId: assetSet.id,
    assetComponentId: universe.id,
    allocationComponentId: weighting.id,
    selectionMode: ranked ? "ranked" : "random",
    fallbackOptions: graph.strategy.definitions.asset_sets
      .filter((definition) => definition.assets.length === 1)
      .map((definition) => ({ id: definition.id, asset: definition.assets[0] })),
    fallbackComponentId: fallback?.id,
    fallbackAssetSetRef: fallback ? String(resolvedConfigValue(graph.strategy, registry, fallback.id, "fallback_asset_set_ref")) : undefined,
    fallbackAsset: fallback
      ? graph.strategy.definitions.asset_sets.find((definition) => definition.id === fallback.config.fallback_asset_set_ref)?.assets[0]
      : undefined,
    cooldownComponentId: cooldown?.id,
    cooldownDuration: cooldown ? Number(resolvedConfigValue(graph.strategy, registry, cooldown.id, "duration")) : undefined,
    cooldownUnit: cooldown ? String(resolvedConfigValue(graph.strategy, registry, cooldown.id, "unit")) : undefined,
    total: String(resolvedConfigValue(graph.strategy, registry, weighting.id, "total")),
    schedule: schedule?.label ?? "Monthly",
    scheduleComponentId: schedule?.componentId,
  };
  if (random) {
    return {
      ...base,
      selectionComponentId: random.id,
      randomCount: Number(resolvedConfigValue(graph.strategy, registry, random.id, "count")),
      resample: String(resolvedConfigValue(graph.strategy, registry, random.id, "resample")),
    };
  }
  if (!ranked) return base;
  const lookback = graph.uniquePrimitive("trailing_return@1", upstream);
  const rank = graph.uniquePrimitive("rank@1", upstream);
  const filter = graph.uniquePrimitive("filter@1", upstream);
  if (!lookback || !rank) throw new Error(`Ranked selection path for ${targetId} is incomplete`);
  return {
    ...base,
    selectionMode: "ranked",
    selectionComponentId: ranked.id,
    lookbackComponentId: lookback.id,
    lookbackBars: Number(resolvedConfigValue(graph.strategy, registry, lookback.id, "lookback_bars")),
    filterComponentId: filter?.id,
    threshold: filter ? String(resolvedConfigValue(graph.strategy, registry, filter.id, "threshold")) : undefined,
    rankDirection: String(resolvedConfigValue(graph.strategy, registry, rank.id, "direction")),
    rankComponentId: rank.id,
    topN: Number(resolvedConfigValue(graph.strategy, registry, ranked.id, "count")),
  };
}

function projectSemanticStrategyUnsafe(
  strategy: CanonicalStrategyV1,
  registry: RegistryPayload,
): SemanticStrategyProjection {
  const graph = new ProjectionGraph(strategy);
  const rebalance = graph.uniquePrimitive("rebalance@1");
  if (!rebalance) throw new Error("A supported strategy needs one rebalance component");
  const rebalanceSchedule = scheduleForTarget(graph, rebalance.id);
  const portfolio = graph.uniquePrimitive("portfolio@1");
  if (portfolio) {
    const sleeves = graph.sources(portfolio.id).filter((component) => component.primitive === "portfolio_sleeve@1");
    if (sleeves.length !== 2) throw new Error(`Supported portfolios require two sleeves, found ${sleeves.length}`);
    return {
      kind: "portfolio",
      title: String(portfolio.config.name ?? strategy.metadata.name),
      portfolioComponentId: portfolio.id,
      groups: sleeves.map((sleeve) => {
        const refresh = scheduleForTarget(graph, sleeve.id);
        return {
          id: sleeve.id,
          name: String(sleeve.config.name),
          allocation: String(sleeve.config.allocation),
          sleeveComponentId: sleeve.id,
          refreshScheduleComponentId: refresh?.componentId,
          refreshSchedule: refresh?.label,
          pipeline: projectPipeline(graph, registry, sleeve.id),
        };
      }),
      rebalanceScheduleComponentId: rebalanceSchedule?.componentId,
      rebalanceSchedule: rebalanceSchedule?.label,
    };
  }
  const merge = graph.uniquePrimitive("merge_targets@1");
  if (merge) {
    const branches = graph.sources(merge.id);
    if (branches.length !== 2) throw new Error(`Supported merged portfolios require two branches, found ${branches.length}`);
    const groups = branches.map((branch) => {
      const pipeline = projectPipeline(graph, registry, branch.id);
      return { branch, pipeline };
    });
    const selected = groups.filter(({ pipeline }) => pipeline.selectionComponentId);
    if (selected.length !== 1) throw new Error("Merged portfolio must have one selection branch");
    const growthId = selected[0].branch.id;
    return {
      kind: "portfolio",
      title: strategy.metadata.name,
      groups: groups.map(({ branch, pipeline }) => ({
        id: branch.id,
        name: branch.id === growthId ? "Growth" : "Safe",
        allocation: pipeline.total,
        pipeline,
      })),
      rebalanceScheduleComponentId: rebalanceSchedule?.componentId,
      rebalanceSchedule: rebalanceSchedule?.label,
    };
  }
  return {
    kind: "single",
    title: strategy.metadata.name,
    groups: [{
      id: graph.sources(rebalance.id)[0]?.id ?? rebalance.id,
      name: "Investment",
      allocation: "1",
      pipeline: projectPipeline(graph, registry, rebalance.id),
    }],
    rebalanceScheduleComponentId: rebalanceSchedule?.componentId,
    rebalanceSchedule: rebalanceSchedule?.label,
  };
}

export function tryProjectSemanticStrategy(
  strategy: CanonicalStrategyV1,
  registry: RegistryPayload,
): SemanticProjectionResult {
  try {
    return { supported: true, projection: projectSemanticStrategyUnsafe(strategy, registry) };
  } catch (error) {
    return { supported: false, reason: error instanceof Error ? error.message : "Unsupported strategy shape" };
  }
}

export function projectSemanticStrategy(
  strategy: CanonicalStrategyV1,
  registry: RegistryPayload,
): SemanticStrategyProjection {
  const result = tryProjectSemanticStrategy(strategy, registry);
  if (!result.supported) throw new Error(result.reason);
  return result.projection;
}
