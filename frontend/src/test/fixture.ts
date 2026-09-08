import type { EditorBootstrap } from "../domain/canonical";

const field = (
  name: string,
  value_type: string,
  options: Partial<{
    required: boolean;
    default: string | number | null;
    minimum: string | null;
    maximum: string | null;
    exclusive_minimum: boolean;
    choices: string[];
  }> = {},
) => ({
  name,
  value_type,
  required: options.required ?? true,
  default: options.default ?? null,
  minimum: options.minimum ?? null,
  maximum: options.maximum ?? null,
  exclusive_minimum: options.exclusive_minimum ?? false,
  choices: options.choices ?? [],
  reference: null,
});

export const goldenBootstrap: EditorBootstrap = {
  strategy: {
    api_version: "ruletrade.dev/strategy/v1",
    metadata: {
      name: "Growth 70 / Safe 30",
      description: "Deterministic per-event growth selection with a stable safe sleeve.",
      tags: [],
    },
    random_seed: 123,
    definitions: {
      asset_sets: [
        { id: "growth", assets: ["QQQ", "VGT", "SOXX", "SCHG"] },
        { id: "safe", assets: ["TLT", "IEF"] },
      ],
      parameters: [],
      state: [],
    },
    graph: {
      components: [
        { id: "monthly", primitive: "monthly@1", config: { day: 1 }, condition: null, actions: [] },
        { id: "growth_assets", primitive: "asset_set@1", config: { asset_set_ref: "growth" }, condition: null, actions: [] },
        { id: "growth_random", primitive: "random_select@1", config: { count: 2, resample: "per_event" }, condition: null, actions: [] },
        { id: "growth_weights", primitive: "equal_weight@1", config: { total: "0.70" }, condition: null, actions: [] },
        { id: "safe_assets", primitive: "asset_set@1", config: { asset_set_ref: "safe" }, condition: null, actions: [] },
        { id: "safe_weights", primitive: "equal_weight@1", config: { total: "0.30" }, condition: null, actions: [] },
        { id: "targets", primitive: "merge_targets@1", config: {}, condition: null, actions: [] },
        { id: "rebalance", primitive: "rebalance@1", config: {}, condition: null, actions: [] },
      ],
      connections: [
        { source: { component_id: "growth_assets", port: "assets" }, target: { component_id: "growth_random", port: "assets" } },
        { source: { component_id: "growth_random", port: "selected" }, target: { component_id: "growth_weights", port: "assets" } },
        { source: { component_id: "growth_weights", port: "targets" }, target: { component_id: "targets", port: "left" } },
        { source: { component_id: "safe_assets", port: "assets" }, target: { component_id: "safe_weights", port: "assets" } },
        { source: { component_id: "safe_weights", port: "targets" }, target: { component_id: "targets", port: "right" } },
        { source: { component_id: "targets", port: "targets" }, target: { component_id: "rebalance", port: "targets" } },
      ],
    },
    entrypoints: [{ event_component_id: "monthly", target_component_id: "rebalance" }],
  },
  registry: {
    primitives: [
      { id: "monthly@1", category: "event", authoring_views: ["guided", "flow"], inputs: [], outputs: [], fields: [field("day", "integer", { required: false, default: 1, minimum: "1", maximum: "31" })] },
      { id: "asset_set@1", category: "transform", authoring_views: ["guided", "flow"], inputs: [], outputs: [], fields: [field("asset_set_ref", "string")] },
      { id: "random_select@1", category: "transform", authoring_views: ["guided", "flow"], inputs: [], outputs: [], fields: [field("count", "integer", { minimum: "1" }), field("resample", "string", { required: false, default: "per_event", choices: ["once", "per_event"] })] },
      { id: "equal_weight@1", category: "allocator", authoring_views: ["guided", "flow"], inputs: [], outputs: [], fields: [field("total", "percentage", { minimum: "0", maximum: "1", exclusive_minimum: true })] },
      { id: "merge_targets@1", category: "transform", authoring_views: ["guided", "flow"], inputs: [], outputs: [], fields: [] },
      { id: "rebalance@1", category: "effect", authoring_views: ["guided", "flow"], inputs: [], outputs: [], fields: [] },
      { id: "rule@1", category: "rule", authoring_views: ["flow"], inputs: [], outputs: [], fields: [] },
    ],
  },
  validation: { valid: true, issues: [] },
};
