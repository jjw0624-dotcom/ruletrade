import bootstrapPayload from "./generated-bootstrap.json";
import momentumBootstrapPayload from "./generated-momentum-bootstrap.json";
import sleevesBootstrapPayload from "./generated-sleeves-bootstrap.json";

import type { EditorBootstrap } from "../domain/canonical";

// Generated on demand from ruletrade.api.editor_bootstrap; this file contains
// no frontend-owned strategy definition.
export const goldenBootstrap = bootstrapPayload as unknown as EditorBootstrap;
export const momentumBootstrap = momentumBootstrapPayload as unknown as EditorBootstrap;
export const sleevesBootstrap = sleevesBootstrapPayload as unknown as EditorBootstrap;

export const filterBootstrap = structuredClone(momentumBootstrap);
filterBootstrap.strategy.metadata = {
  ...filterBootstrap.strategy.metadata,
  name: "Positive Trailing Return Top 2",
};
const rankIndex = filterBootstrap.strategy.graph.components.findIndex(
  (item) => item.id === "momentum_rank",
);
filterBootstrap.strategy.graph.components.splice(rankIndex, 0, {
  id: "positive_return",
  primitive: "filter@1",
  config: { operator: "gt", threshold: "0" },
  condition: null,
  actions: [],
});
filterBootstrap.strategy.graph.connections = filterBootstrap.strategy.graph.connections.flatMap(
  (connection) => connection.source.component_id === "momentum"
    && connection.target.component_id === "momentum_rank"
    ? [
      { source: connection.source, target: { component_id: "positive_return", port: "scores" } },
      {
        source: { component_id: "positive_return", port: "scores" },
        target: connection.target,
      },
    ]
    : [connection],
);
filterBootstrap.registry.primitives.push({
  id: "filter@1",
  category: "transform",
  authoring_views: ["blocks", "code", "flow", "guided", "rules"],
  inputs: [{ name: "scores", value_type: "asset_scores", required: true, multiple: false }],
  outputs: [{ name: "scores", value_type: "asset_scores", required: true, multiple: false }],
  fields: [
    {
      name: "operator",
      value_type: "string",
      required: false,
      default: "gt",
      minimum: null,
      maximum: null,
      exclusive_minimum: false,
      choices: ["gt"],
      reference: null,
    },
    {
      name: "threshold",
      value_type: "percentage",
      required: true,
      default: null,
      minimum: null,
      maximum: null,
      exclusive_minimum: false,
      choices: [],
      reference: null,
    },
  ],
});

export const fallbackBootstrap = structuredClone(filterBootstrap);
fallbackBootstrap.strategy.metadata = {
  ...fallbackBootstrap.strategy.metadata,
  name: "Positive Trailing Return Top 2 with TLT Fallback",
};
fallbackBootstrap.strategy.definitions.asset_sets.push(
  { id: "fallback_tlt", assets: ["TLT"] },
  { id: "fallback_ief", assets: ["IEF"] },
);
const rebalanceIndex = fallbackBootstrap.strategy.graph.components.findIndex(
  (item) => item.id === "rebalance",
);
fallbackBootstrap.strategy.graph.components.splice(rebalanceIndex, 0, {
  id: "fallback",
  primitive: "fallback@1",
  config: { fallback_asset_set_ref: "fallback_tlt" },
  condition: null,
  actions: [],
});
fallbackBootstrap.strategy.graph.connections = fallbackBootstrap.strategy.graph.connections.flatMap(
  (connection) => connection.source.component_id === "weights"
    && connection.target.component_id === "rebalance"
    ? [
      { source: connection.source, target: { component_id: "fallback", port: "primary" } },
      {
        source: { component_id: "fallback", port: "targets" },
        target: connection.target,
      },
    ]
    : [connection],
);
fallbackBootstrap.registry.primitives.push({
  id: "fallback@1",
  category: "transform",
  authoring_views: ["blocks", "code", "flow", "guided", "rules"],
  inputs: [{ name: "primary", value_type: "portfolio_targets", required: true, multiple: false }],
  outputs: [{ name: "targets", value_type: "portfolio_targets", required: true, multiple: false }],
  fields: [{
    name: "fallback_asset_set_ref",
    value_type: "string",
    required: true,
    default: null,
    minimum: null,
    maximum: null,
    exclusive_minimum: false,
    choices: [],
    reference: "asset_set",
  }],
});
