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

/** Canonical component and optional field form the cross-surface address.
 * Role and group describe presentation context, not a second identity system.
 */
export function sameSemanticAddress(
  left: Pick<SemanticSelection, "componentId" | "fieldPath"> | null,
  right: Pick<SemanticSelection, "componentId" | "fieldPath"> | null,
): boolean {
  return Boolean(left?.componentId) && left?.componentId === right?.componentId
    && (left?.fieldPath ?? null) === (right?.fieldPath ?? null);
}

/** Reconcile selection only when an authoritative Canonical replaces the working copy.
 * A field may be supplied by Registry defaults, so component existence is the safe check.
 */
export function selectionInCanonical(
  selection: SemanticSelection | null,
  componentIds: ReadonlySet<string>,
): SemanticSelection | null {
  return selection?.componentId && !componentIds.has(selection.componentId) ? null : selection;
}

/** Blank workspace gestures clear selection; semantic and interactive descendants do not. */
export function isBlankWorkspaceTarget(target: EventTarget | null): boolean {
  if (!target || !("closest" in target) || typeof target.closest !== "function") return true;
  return target.closest("[data-component-id],button,input,textarea,select,a") === null;
}
