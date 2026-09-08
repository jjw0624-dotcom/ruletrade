import type { CanonicalComponent, CanonicalStrategyV1, RegistryPayload } from "./canonical";
import { resolvedConfigValue } from "./patch";

export interface GuidedProjection {
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

function requireComponent(strategy: CanonicalStrategyV1, id: string): CanonicalComponent {
  const component = strategy.graph.components.find((item) => item.id === id);
  if (!component) throw new Error(`Guided View requires component ${id}`);
  return component;
}

function assetsFor(strategy: CanonicalStrategyV1, componentId: string): string[] {
  const component = requireComponent(strategy, componentId);
  const reference = component.config.asset_set_ref;
  const definition = strategy.definitions.asset_sets.find((item) => item.id === reference);
  if (!definition) throw new Error(`Guided View cannot resolve asset set ${String(reference)}`);
  return definition.assets;
}

export function projectGuided(
  strategy: CanonicalStrategyV1,
  registry: RegistryPayload,
): GuidedProjection {
  const randomCount = resolvedConfigValue(strategy, registry, "growth_random", "count");
  const resample = resolvedConfigValue(strategy, registry, "growth_random", "resample");
  const growthTotal = resolvedConfigValue(strategy, registry, "growth_weights", "total");
  const safeTotal = resolvedConfigValue(strategy, registry, "safe_weights", "total");
  if (typeof randomCount !== "number" || typeof resample !== "string") {
    throw new Error("Guided View cannot project the Growth selection");
  }

  return {
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
