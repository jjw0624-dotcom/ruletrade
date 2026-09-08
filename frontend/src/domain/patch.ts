import type {
  CanonicalStrategyV1,
  JsonValue,
  RegistryField,
  RegistryPayload,
  ValidationIssue,
} from "./canonical";

export interface UpdateComponentConfig {
  kind: "update_component_config";
  componentId: string;
  field: string;
  value: JsonValue;
}

export type PatchResult =
  | { ok: true; strategy: CanonicalStrategyV1 }
  | { ok: false; issue: ValidationIssue };

function validateValue(field: RegistryField, value: JsonValue): string | null {
  if (field.value_type === "integer" && (typeof value !== "number" || !Number.isInteger(value))) {
    return `${field.name} must be an integer`;
  }
  if (field.value_type === "string" && typeof value !== "string") {
    return `${field.name} must be a string`;
  }
  if (["decimal", "percentage", "shares", "money", "money_per_share"].includes(field.value_type)) {
    if (typeof value === "string" && value.trim() === "") return `${field.name} must be numeric`;
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) return `${field.name} must be numeric`;
  }
  if (field.choices.length > 0 && !field.choices.includes(value)) {
    return `${field.name} must be one of ${field.choices.join(", ")}`;
  }
  if (field.minimum !== null || field.maximum !== null) {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) {
      return `${field.name} must be numeric`;
    }
    if (field.minimum !== null) {
      const minimum = Number(field.minimum);
      if (field.exclusive_minimum ? numeric <= minimum : numeric < minimum) {
        return `${field.name} must be ${field.exclusive_minimum ? "greater than" : "at least"} ${field.minimum}`;
      }
    }
    if (field.maximum !== null && numeric > Number(field.maximum)) {
      return `${field.name} must be at most ${field.maximum}`;
    }
  }
  return null;
}

export function updateComponentConfig(
  strategy: CanonicalStrategyV1,
  registry: RegistryPayload,
  operation: UpdateComponentConfig,
): PatchResult {
  const component = strategy.graph.components.find((item) => item.id === operation.componentId);
  if (!component) {
    return {
      ok: false,
      issue: { path: `graph.components[${operation.componentId}]`, message: "component was not found" },
    };
  }
  const primitive = registry.primitives.find((item) => item.id === component.primitive);
  const field = primitive?.fields.find((item) => item.name === operation.field);
  if (!field) {
    return {
      ok: false,
      issue: {
        path: `graph.components[${component.id}].config.${operation.field}`,
        message: "field is not declared by the Primitive Registry",
      },
    };
  }
  const error = validateValue(field, operation.value);
  if (error) {
    return {
      ok: false,
      issue: { path: `graph.components[${component.id}].config.${operation.field}`, message: error },
    };
  }

  return {
    ok: true,
    strategy: {
      ...strategy,
      graph: {
        ...strategy.graph,
        components: strategy.graph.components.map((item) =>
          item.id === component.id
            ? { ...item, config: { ...item.config, [operation.field]: operation.value } }
            : item,
        ),
      },
    },
  };
}

export function resolvedConfigValue(
  strategy: CanonicalStrategyV1,
  registry: RegistryPayload,
  componentId: string,
  fieldName: string,
): JsonValue | undefined {
  const component = strategy.graph.components.find((item) => item.id === componentId);
  if (!component) return undefined;
  if (fieldName in component.config) return component.config[fieldName];
  return registry.primitives
    .find((item) => item.id === component.primitive)
    ?.fields.find((item) => item.name === fieldName)?.default;
}
