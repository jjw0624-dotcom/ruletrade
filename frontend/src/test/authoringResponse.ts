import type { CanonicalStrategyV1, JsonValue } from "../domain/canonical";

export function authoringResponse(
  strategy: CanonicalStrategyV1,
  componentId: string,
  config: Record<string, JsonValue>,
): CanonicalStrategyV1 {
  return {
    ...strategy,
    graph: {
      ...strategy.graph,
      components: strategy.graph.components.map((component) => component.id === componentId
        ? { ...component, config: { ...component.config, ...config } }
        : component),
    },
  };
}
