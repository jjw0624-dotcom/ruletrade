import type { CanonicalStrategyV1 } from "./canonical";
import type { ComposeStrategyOperation } from "../structuralAuthoringApi";

export function insertConditionBeforeRank(
  canonical: CanonicalStrategyV1,
  rankComponentId: string,
): ComposeStrategyOperation | null {
  const incoming = canonical.graph.connections.filter((connection) =>
    connection.target.component_id === rankComponentId && connection.target.port === "scores");
  if (incoming.length !== 1 || incoming[0].source.port !== "scores") return null;
  const source = incoming[0].source;
  return { kind: "compose_strategy", mutations: [
    { kind: "disconnect", source, target: { component_id: rankComponentId, port: "scores" } },
    { kind: "create_component", ref: "condition", primitive: "filter@1", config: { operator: "gt", threshold: "0" } },
    { kind: "connect", source, target: { created_ref: "condition", port: "scores" } },
    { kind: "connect", source: { created_ref: "condition", port: "scores" }, target: { component_id: rankComponentId, port: "scores" } },
  ] };
}

export function composeTwoSleevePortfolio(
  canonical: CanonicalStrategyV1,
  targetComponentId: string,
  growthAllocation: string,
  defensiveAssets: string[],
): ComposeStrategyOperation | null {
  const outgoing = canonical.graph.connections.filter((connection) =>
    connection.source.component_id === targetComponentId && connection.source.port === "targets");
  if (outgoing.length !== 1 || outgoing[0].target.port !== "targets") return null;
  const rebalanceTarget = outgoing[0].target;
  const defensiveAllocation = String(Math.round((1 - Number(growthAllocation)) * 1_000_000) / 1_000_000);
  return { kind: "compose_strategy", mutations: [
    { kind: "disconnect", source: { component_id: targetComponentId, port: "targets" }, target: rebalanceTarget },
    { kind: "create_component", ref: "growth_sleeve", primitive: "portfolio_sleeve@1", config: { name: "Growth", allocation: growthAllocation } },
    { kind: "connect", source: { component_id: targetComponentId, port: "targets" }, target: { created_ref: "growth_sleeve", port: "local_targets" } },
    { kind: "create_asset_set", ref: "defensive_assets", assets: defensiveAssets },
    { kind: "create_component", ref: "defensive_universe", primitive: "asset_set@1", config: {} },
    { kind: "set_component_field", target: { created_ref: "defensive_universe" }, field: "asset_set_ref", created_asset_set_ref: "defensive_assets" },
    { kind: "create_component", ref: "defensive_weight", primitive: "equal_weight@1", config: { total: "1" } },
    { kind: "connect", source: { created_ref: "defensive_universe", port: "assets" }, target: { created_ref: "defensive_weight", port: "assets" } },
    { kind: "create_component", ref: "defensive_sleeve", primitive: "portfolio_sleeve@1", config: { name: "Defensive", allocation: defensiveAllocation } },
    { kind: "connect", source: { created_ref: "defensive_weight", port: "targets" }, target: { created_ref: "defensive_sleeve", port: "local_targets" } },
    { kind: "create_component", ref: "portfolio", primitive: "portfolio@1", config: { name: "Portfolio" } },
    { kind: "connect", source: { created_ref: "growth_sleeve", port: "contribution" }, target: { created_ref: "portfolio", port: "sleeves" } },
    { kind: "connect", source: { created_ref: "defensive_sleeve", port: "contribution" }, target: { created_ref: "portfolio", port: "sleeves" } },
    { kind: "connect", source: { created_ref: "portfolio", port: "targets" }, target: rebalanceTarget },
  ] };
}
