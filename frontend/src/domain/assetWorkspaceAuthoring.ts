import type { CanonicalComponent, CanonicalStrategyV1 } from "./canonical";
import type { StructuralAuthoringCapabilities } from "../structuralAuthoringApi";

export type MembershipKind = "asset_set" | "group" | "universe";

export interface AssetMembershipAuthoringTarget {
  assetSetId: string;
  semanticId: string;
  componentId: string | null;
  kind: MembershipKind;
  label: string;
  assets: string[];
}

function assetSetComponent(strategy: CanonicalStrategyV1, assetSetId: string): CanonicalComponent | undefined {
  return strategy.graph.components.find((component) =>
    component.primitive === "asset_set@1" && component.config.asset_set_ref === assetSetId);
}

function groupAssetSet(strategy: CanonicalStrategyV1, groupId: string): string | null {
  return strategy.definitions.groups?.find((group) => group.id === groupId)?.asset_set_ref ?? null;
}

function universeAssetSet(strategy: CanonicalStrategyV1, universeId: string): string | null {
  const universe = strategy.definitions.universes?.find((item) => item.id === universeId);
  if (!universe || universe.source === "provider") return null;
  return universe.source === "asset_set"
    ? universe.asset_set_ref ?? null
    : universe.group_ref ? groupAssetSet(strategy, universe.group_ref) : null;
}

function universeComponent(strategy: CanonicalStrategyV1, universeId: string): CanonicalComponent | undefined {
  return strategy.graph.components.find((component) =>
    component.primitive === "universe@1" && component.config.universe_ref === universeId);
}

/**
 * Converts backend-advertised editable asset sets into user-facing static Group /
 * explicit Universe targets. The capability remains authoritative; definitions
 * only add product identity and never create an unsupported mutation.
 */
export function assetMembershipAuthoringTargets(
  strategy: CanonicalStrategyV1,
  capabilities: StructuralAuthoringCapabilities | null,
): AssetMembershipAuthoringTarget[] {
  if (!capabilities) return [];
  const result: AssetMembershipAuthoringTarget[] = [];
  for (const target of capabilities.asset_set_targets) {
    const directComponent = assetSetComponent(strategy, target.asset_set_id);
    const groups = (strategy.definitions.groups ?? [])
      .filter((group) => group.asset_set_ref === target.asset_set_id);
    const universes = (strategy.definitions.universes ?? [])
      .filter((universe) => universeAssetSet(strategy, universe.id) === target.asset_set_id
        && universe.source !== "provider");

    for (const universe of universes) {
      const component = universeComponent(strategy, universe.id) ?? directComponent;
      result.push({
        assetSetId: target.asset_set_id,
        semanticId: universe.id,
        componentId: component?.id ?? null,
        kind: "universe",
        label: universe.name,
        assets: [...target.assets],
      });
    }
    for (const group of groups) {
      const component = strategy.graph.components.find((item) => item.id === group.id)
        ?? directComponent;
      result.push({
        assetSetId: target.asset_set_id,
        semanticId: group.id,
        componentId: component?.id ?? null,
        kind: "group",
        label: group.name,
        assets: [...target.assets],
      });
    }
    if (groups.length === 0 && universes.length === 0) {
      result.push({
        assetSetId: target.asset_set_id,
        semanticId: target.asset_set_id,
        componentId: directComponent?.id ?? null,
        kind: "asset_set",
        label: target.asset_set_id.replaceAll("_", " "),
        assets: [...target.assets],
      });
    }
  }
  return result;
}

export interface HistoricalRuleReference {
  componentId: string;
  fieldPath: string | null;
}

export function historicalRuleReferences(evidence: Array<Record<string, unknown>>): HistoricalRuleReference[] {
  const found: HistoricalRuleReference[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const record = value as Record<string, unknown>;
    if (typeof record.component_id === "string") {
      const fieldPath = typeof record.field_path === "string" ? record.field_path : null;
      const key = `${record.component_id}:${fieldPath ?? ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        found.push({ componentId: record.component_id, fieldPath });
      }
    }
    Object.values(record).forEach(visit);
  };
  evidence.forEach(visit);
  return found;
}
