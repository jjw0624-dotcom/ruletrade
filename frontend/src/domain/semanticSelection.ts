export type SemanticRole =
  | "portfolio"
  | "split"
  | "group"
  | "universe"
  | "selection"
  | "qualification"
  | "fallback"
  | "schedule"
  | "cooldown"
  | "rule";

export interface SemanticSelection {
  role: SemanticRole;
  componentId: string | null;
  fieldPath: string | null;
  groupId: string | null;
}

export function semanticSelection(
  role: SemanticRole,
  componentId: string | null,
  options: { fieldPath?: string | null; groupId?: string | null } = {},
): SemanticSelection {
  return {
    role,
    componentId,
    fieldPath: options.fieldPath ?? null,
    groupId: options.groupId ?? null,
  };
}

export function sameSemanticSelection(
  left: SemanticSelection | null,
  right: SemanticSelection | null,
): boolean {
  return left?.role === right?.role
    && left?.componentId === right?.componentId
    && left?.fieldPath === right?.fieldPath
    && left?.groupId === right?.groupId;
}
