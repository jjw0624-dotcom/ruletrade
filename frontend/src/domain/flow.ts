import type { Edge, Node, XYPosition } from "@xyflow/react";

import type { CanonicalComponent, CanonicalStrategyV1, RegistryPayload } from "./canonical";
import { resolvedConfigValue } from "./patch";

export interface StrategyFlowNodeData extends Record<string, unknown> {
  componentId: string;
  title: string;
  details: string[];
  randomCount?: number;
  resample?: string;
  lookbackBars?: number;
  threshold?: string;
  topN?: number;
  fallbackAssetSetRef?: string;
  fallbackOptions?: Array<{ id: string; asset: string }>;
  sleeveAllocation?: string;
  allocationPair?: {
    growthComponentId: string;
    defensiveComponentId: string;
    value: string;
  };
  scheduleCadence?: "monthly" | "quarterly";
  cooldownDuration?: number;
}

export interface FlowProjection {
  nodes: Array<Node<StrategyFlowNodeData, "strategy">>;
  edges: Edge[];
}

export type NodePositions = Record<string, XYPosition>;

export const DEFAULT_NODE_POSITIONS: NodePositions = {
  monthly: { x: 700, y: 20 },
  growth_assets: { x: 20, y: 70 },
  growth_random: { x: 260, y: 70 },
  growth_weights: { x: 500, y: 70 },
  safe_assets: { x: 140, y: 310 },
  safe_weights: { x: 500, y: 310 },
  targets: { x: 760, y: 190 },
  rebalance: { x: 1010, y: 190 },
  universe_assets: { x: 20, y: 190 },
  momentum: { x: 250, y: 190 },
  positive_return: { x: 480, y: 190 },
  momentum_rank: { x: 710, y: 190 },
  top_n: { x: 930, y: 190 },
  cooldown: { x: 1150, y: 70 },
  weights: { x: 1150, y: 190 },
  fallback: { x: 1150, y: 400 },
  growth_sleeve: { x: 1390, y: 120 },
  defensive_assets: { x: 700, y: 520 },
  defensive_weights: { x: 930, y: 520 },
  defensive_sleeve: { x: 1390, y: 520 },
  portfolio: { x: 1640, y: 300 },
};

function percentage(value: unknown): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric * 100)}%` : String(value);
}

function assetSetDetails(strategy: CanonicalStrategyV1, component: CanonicalComponent): string[] {
  const reference = component.config.asset_set_ref;
  const definition = strategy.definitions.asset_sets.find((item) => item.id === reference);
  return definition ? [definition.assets.join(", ")] : [`Missing asset set: ${String(reference)}`];
}

function nodeData(
  strategy: CanonicalStrategyV1,
  registry: RegistryPayload,
  component: CanonicalComponent,
): StrategyFlowNodeData {
  if (component.primitive === "asset_set@1") {
    const title = component.id === "universe_assets"
      ? "Universe"
      : component.id.startsWith("growth") ? "Growth Assets" : "Safe Assets";
    return { componentId: component.id, title, details: assetSetDetails(strategy, component) };
  }
  if (component.primitive === "random_select@1") {
    const count = resolvedConfigValue(strategy, registry, component.id, "count");
    const resample = resolvedConfigValue(strategy, registry, component.id, "resample");
    return {
      componentId: component.id,
      title: "Random Select",
      details: [`Count: ${String(count)}`, `Resample: ${String(resample)}`],
      randomCount: typeof count === "number" ? count : undefined,
      resample: typeof resample === "string" ? resample : undefined,
    };
  }
  if (component.primitive === "trailing_return@1") {
    const lookback = resolvedConfigValue(strategy, registry, component.id, "lookback_bars");
    return { componentId: component.id, title: "Trailing Return", details: [`Lookback: ${String(lookback)} trading days`, "Adjusted close"], lookbackBars: typeof lookback === "number" ? lookback : undefined };
  }
  if (component.primitive === "filter@1") {
    const threshold = resolvedConfigValue(strategy, registry, component.id, "threshold");
    return {
      componentId: component.id,
      title: `Return > ${percentage(threshold)}`,
      details: ["Strict comparison", "Keeps score values"],
      threshold: String(threshold),
    };
  }
  if (component.primitive === "rank@1") {
    const direction = resolvedConfigValue(strategy, registry, component.id, "direction");
    return { componentId: component.id, title: "Rank", details: [`Direction: ${String(direction)}`, "Tie: ticker A–Z"] };
  }
  if (component.primitive === "top_n@1") {
    const count = resolvedConfigValue(strategy, registry, component.id, "count");
    return { componentId: component.id, title: `Top ${String(count)}`, details: [`Count: ${String(count)}`], topN: typeof count === "number" ? count : undefined };
  }
  if (component.primitive === "cooldown@1") {
    const duration = resolvedConfigValue(strategy, registry, component.id, "duration");
    return {
      componentId: component.id,
      title: `Cooldown ${String(duration)} trading days`,
      details: ["Starts after target exit", "No rank backfill"],
      cooldownDuration: typeof duration === "number" ? duration : undefined,
    };
  }
  if (component.primitive === "equal_weight@1") {
    const total = resolvedConfigValue(strategy, registry, component.id, "total");
    return {
      componentId: component.id,
      title: `Equal Weight ${percentage(total)}`,
      details: ["Portfolio targets"],
    };
  }
  if (component.primitive === "fallback@1") {
    const reference = resolvedConfigValue(strategy, registry, component.id, "fallback_asset_set_ref");
    const definition = strategy.definitions.asset_sets.find((item) => item.id === reference);
    return {
      componentId: component.id,
      title: `Fallback: ${definition?.assets[0] ?? "Missing asset"}`,
      details: ["If fewer than Top N qualify"],
      fallbackAssetSetRef: typeof reference === "string" ? reference : undefined,
      fallbackOptions: strategy.definitions.asset_sets
        .filter((item) => item.assets.length === 1)
        .map((item) => ({ id: item.id, asset: item.assets[0] })),
    };
  }
  if (component.primitive === "portfolio_sleeve@1") {
    const allocation = resolvedConfigValue(strategy, registry, component.id, "allocation");
    return {
      componentId: component.id,
      title: `${String(component.config.name)} Sleeve`,
      details: [`Allocation: ${percentage(allocation)}`],
      sleeveAllocation: String(allocation),
    };
  }
  if (component.primitive === "portfolio@1") {
    const growth = strategy.graph.components.find((item) => item.id === "growth_sleeve");
    const defensive = strategy.graph.components.find((item) => item.id === "defensive_sleeve");
    return {
      componentId: component.id,
      title: String(component.config.name),
      details: ["Aggregate by symbol"],
      allocationPair: growth && defensive ? {
        growthComponentId: growth.id,
        defensiveComponentId: defensive.id,
        value: `${String(growth.config.allocation)}/${String(defensive.config.allocation)}`,
      } : undefined,
    };
  }
  const labels: Record<string, string> = {
    "daily@1": "Daily",
    "monthly@1": "Monthly",
    "quarterly@1": "Quarterly",
    "merge_targets@1": "Merge Targets",
    "rebalance@1": "Rebalance",
  };
  return {
    componentId: component.id,
    title: labels[component.primitive] ?? component.primitive,
    details: component.primitive === "daily@1"
      ? ["Every completed trading day"]
      : ["monthly@1", "quarterly@1"].includes(component.primitive)
        ? ["First trading day", `Cadence: ${labels[component.primitive]}`]
        : [],
    scheduleCadence: component.primitive === "monthly@1"
      ? "monthly"
      : component.primitive === "quarterly@1" ? "quarterly" : undefined,
  };
}

export function projectFlow(
  strategy: CanonicalStrategyV1,
  registry: RegistryPayload,
  positions: NodePositions,
): FlowProjection {
  const nodes = strategy.graph.components.map((component, index) => ({
    id: component.id,
    type: "strategy" as const,
    position: positions[component.id] ?? { x: (index % 4) * 240, y: Math.floor(index / 4) * 190 },
    data: nodeData(strategy, registry, component),
  }));
  const edges: Edge[] = strategy.graph.connections.map((connection, index) => ({
    id: `connection-${index}`,
    source: connection.source.component_id,
    target: connection.target.component_id,
  }));
  edges.push(
    ...strategy.entrypoints.map((entrypoint, index) => ({
      id: `entrypoint-${index}`,
      source: entrypoint.event_component_id,
      target: entrypoint.target_component_id,
      animated: true,
      style: { strokeDasharray: "5 5" },
    })),
  );
  return { nodes, edges };
}
