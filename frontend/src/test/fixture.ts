import bootstrapPayload from "./generated-bootstrap.json";
import momentumBootstrapPayload from "./generated-momentum-bootstrap.json";

import type { EditorBootstrap } from "../domain/canonical";

// Generated on demand from ruletrade.api.editor_bootstrap; this file contains
// no frontend-owned strategy definition.
export const goldenBootstrap = bootstrapPayload as unknown as EditorBootstrap;
export const momentumBootstrap = momentumBootstrapPayload as unknown as EditorBootstrap;

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
