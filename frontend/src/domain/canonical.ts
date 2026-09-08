export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface StrategyMetadata {
  name: string;
  description: string;
  tags: string[];
}

export interface AssetSetDefinition {
  id: string;
  assets: string[];
}

export interface StrategyDefinitions {
  asset_sets: AssetSetDefinition[];
  parameters: JsonValue[];
  state: JsonValue[];
}

export interface CanonicalComponent {
  id: string;
  primitive: string;
  config: Record<string, JsonValue>;
  condition: JsonValue;
  actions: JsonValue[];
}

export interface PortReference {
  component_id: string;
  port: string;
}

export interface CanonicalConnection {
  source: PortReference;
  target: PortReference;
}

export interface CanonicalStrategyV1 {
  api_version: "ruletrade.dev/strategy/v1";
  metadata: StrategyMetadata;
  random_seed: number;
  definitions: StrategyDefinitions;
  graph: {
    components: CanonicalComponent[];
    connections: CanonicalConnection[];
  };
  entrypoints: Array<{
    event_component_id: string;
    target_component_id: string;
  }>;
}

export interface RegistryField {
  name: string;
  value_type: string;
  required: boolean;
  default: JsonValue;
  minimum: string | null;
  maximum: string | null;
  exclusive_minimum: boolean;
  choices: JsonValue[];
  reference: string | null;
}

export interface RegistryPrimitive {
  id: string;
  category: string;
  authoring_views: string[];
  inputs: Array<{ name: string; value_type: string; required: boolean; multiple: boolean }>;
  outputs: Array<{ name: string; value_type: string; required: boolean; multiple: boolean }>;
  fields: RegistryField[];
}

export interface RegistryPayload {
  primitives: RegistryPrimitive[];
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface EditorBootstrap {
  strategy: CanonicalStrategyV1;
  registry: RegistryPayload;
  validation: {
    valid: boolean;
    issues: ValidationIssue[];
  };
}
