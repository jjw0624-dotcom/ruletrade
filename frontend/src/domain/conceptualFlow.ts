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
}
export interface ConceptualGroup {
  id: string;
  label: string;
  allocation?: string;
  assets: string[];
  timing?: string;
  choose?: ConceptualChoose;
  sourceComponentIds: string[];
}
export interface ConceptualFlowProjection {
  kind: "portfolio" | "single";
  title: string;
  groups: ConceptualGroup[];
  rebalance?: string;
  sourceComponentIds: string[];
}

const percentage = (value: string) => new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 }).format(Number(value));
export function projectConceptualFlow(strategy: CanonicalStrategyV1, registry: RegistryPayload): ConceptualFlowProjection {
  const guided = projectGuided(strategy, registry);
  if (guided.kind === "portfolio") {
    return {
      kind: "portfolio", title: guided.portfolio.name, rebalance: guided.rebalanceSchedule,
      sourceComponentIds: [guided.portfolio.componentId, guided.growth.sleeveComponentId, guided.defensive.sleeveComponentId],
      groups: [
        {
          id: guided.growth.sleeveComponentId, label: guided.growth.sleeveName, allocation: percentage(guided.growth.allocation), assets: guided.growth.assets,
          timing: guided.growth.refreshSchedule ?? guided.growth.schedule,
          sourceComponentIds: [guided.growth.sleeveComponentId, guided.growth.lookbackComponentId, guided.growth.selectionComponentId, ...(guided.growth.filterComponentId ? [guided.growth.filterComponentId] : []), ...(guided.growth.fallbackComponentId ? [guided.growth.fallbackComponentId] : []), ...(guided.growth.cooldownComponentId ? [guided.growth.cooldownComponentId] : [])],
          choose: chooseFrom(guided.growth),
        },
        { id: guided.defensive.sleeveComponentId, label: guided.defensive.sleeveName, allocation: percentage(guided.defensive.allocation), assets: guided.defensive.assets, timing: guided.defensive.refreshSchedule, sourceComponentIds: [guided.defensive.sleeveComponentId] },
      ],
    };
  }
  if (guided.kind === "momentum") return { kind: "single", title: strategy.metadata.name, rebalance: guided.momentum.schedule, sourceComponentIds: [guided.momentum.lookbackComponentId, guided.momentum.selectionComponentId], groups: [{ id: "strategy", label: "Assets", assets: guided.momentum.assets, timing: guided.momentum.schedule, sourceComponentIds: [guided.momentum.lookbackComponentId, guided.momentum.selectionComponentId], choose: chooseFrom(guided.momentum) }] };
  return {
    kind: "portfolio", title: strategy.metadata.name, sourceComponentIds: [guided.growth.selectionComponentId, guided.growth.allocationComponentId, guided.safe.allocationComponentId],
    groups: [
      { id: "growth", label: "Growth", assets: guided.growth.assets, sourceComponentIds: [guided.growth.selectionComponentId, guided.growth.allocationComponentId], choose: { kind: "choose", label: `Choose ${guided.growth.randomCount}`, from: guided.growth.assets, ranking: "Random selection", sourceComponentIds: [guided.growth.selectionComponentId] } },
      { id: "safe", label: "Safe", assets: guided.safe.assets, sourceComponentIds: [guided.safe.allocationComponentId] },
    ],
  };
}
function chooseFrom(value: { assets: string[]; lookbackBars: number; threshold?: string; rankDirection: string; topN: number; fallbackAsset?: string; cooldownDuration?: number; schedule: string; lookbackComponentId: string; filterComponentId?: string; selectionComponentId: string; fallbackComponentId?: string; cooldownComponentId?: string }): ConceptualChoose {
  const months = Math.max(1, Math.round(value.lookbackBars / 21));
  return {
    kind: "choose", label: `Choose ${value.topN}`, from: value.assets,
    condition: value.threshold === undefined ? undefined : `${months}M return > ${percentage(value.threshold)}`,
    ranking: value.rankDirection === "desc" ? "Strongest first" : "Weakest first",
    otherwise: value.fallbackAsset ? `Otherwise → ${value.fallbackAsset}` : undefined,
    cooldown: value.cooldownDuration ? `After selling, wait ${value.cooldownDuration} trading days` : undefined,
    timing: value.schedule,
    sourceComponentIds: [value.lookbackComponentId, value.selectionComponentId, ...(value.filterComponentId ? [value.filterComponentId] : []), ...(value.fallbackComponentId ? [value.fallbackComponentId] : []), ...(value.cooldownComponentId ? [value.cooldownComponentId] : [])],
  };
}
export const conceptualOnlyAllocationExample = {
  supported: false,
  label: "Conditional allocation concept",
  summary: "When Index > 5,000: Growth 70% / Safe 30%. Otherwise: 60% / 40%.",
  reason: "Current Canonical strategies do not express this allocation condition.",
} as const;

