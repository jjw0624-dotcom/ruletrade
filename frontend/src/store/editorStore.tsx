import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from "react";

import type {
  CanonicalStrategyV1,
  EditorBootstrap,
  RegistryPayload,
  ValidationIssue,
} from "../domain/canonical";
import { applySemanticPatch, type SemanticPatch } from "../domain/patch";
import type { SemanticSelection } from "../domain/semanticSelection";
import { semanticSelection } from "../domain/semanticSelection";
import { DEFAULT_NODE_POSITIONS, type NodePositions } from "../domain/flow";

export type EditorView = "overview" | "guided" | "flow";

export interface StrategyEditorState {
  canonical: CanonicalStrategyV1;
  registry: RegistryPayload;
  editor: {
    activeView: EditorView;
    selection: SemanticSelection | null;
    leftPanelOpen: boolean;
    leftPanelTab: "structure" | "blocks";
    dashboardOpen: boolean;
    /** Compatibility-only visual state for the retired primitive canvas projection. */
    nodePositions: NodePositions;
    selectedNodeId: string | null;
    selectedFieldPath: string | null;
    selectedConceptId: string | null;
    openGroupId: string | null;
  };
  validation: {
    status: "valid" | "dirty" | "invalid" | "checking";
    issues: ValidationIssue[];
  };
}

export type StrategyEditorAction =
  | { type: "apply_semantic_patch"; operation: SemanticPatch }
  | { type: "replace_canonical"; canonical: CanonicalStrategyV1 }
  | { type: "replace_canonical_dirty"; canonical: CanonicalStrategyV1; selection?: SemanticSelection | null; selectedNodeId?: string | null; selectedConceptId?: string | null }
  | { type: "set_active_view"; view: EditorView }
  | { type: "select_semantic"; selection: SemanticSelection | null }
  | { type: "set_left_panel_open"; open: boolean }
  | { type: "set_left_panel_tab"; tab: "structure" | "blocks" }
  | { type: "set_dashboard_open"; open: boolean }
  | { type: "move_node"; componentId: string; position: { x: number; y: number } }
  | { type: "select_node"; componentId: string | null; fieldPath?: string | null }
  | { type: "select_concept"; conceptId: string | null }
  | { type: "open_group"; groupId: string | null }
  | { type: "validation_started" }
  | { type: "validation_finished"; valid: boolean; issues: ValidationIssue[] };

export function createEditorState(bootstrap: EditorBootstrap, initialView: EditorView = "overview"): StrategyEditorState {
  return {
    canonical: bootstrap.strategy,
    registry: bootstrap.registry,
    editor: {
      activeView: initialView,
      selection: null,
      leftPanelOpen: true,
      leftPanelTab: "structure",
      dashboardOpen: false,
      nodePositions: { ...DEFAULT_NODE_POSITIONS },
      selectedNodeId: null,
      selectedFieldPath: null,
      selectedConceptId: null,
      openGroupId: null,
    },
    validation: {
      status: bootstrap.validation.valid ? "valid" : "invalid",
      issues: bootstrap.validation.issues,
    },
  };
}

export function editorReducer(
  state: StrategyEditorState,
  action: StrategyEditorAction,
): StrategyEditorState {
  switch (action.type) {
    case "replace_canonical":
      return { ...state, canonical: action.canonical, validation: { status: "valid", issues: [] } };
    case "replace_canonical_dirty": {
      const survivingIds = new Set(action.canonical.graph.components.map((item) => item.id));
      const currentSurvives = state.editor.selection?.componentId == null
        || survivingIds.has(state.editor.selection.componentId);
      const selection = action.selection !== undefined
        ? action.selection
        : action.selectedNodeId ? semanticSelection("rule", action.selectedNodeId) 
        : currentSurvives ? state.editor.selection : null;
      return {
        ...state,
        canonical: action.canonical,
        editor: {
          ...state.editor,
          selection,
          selectedNodeId: selection?.componentId ?? null,
          selectedFieldPath: selection?.fieldPath ?? null,
          selectedConceptId: action.selectedConceptId ?? state.editor.selectedConceptId,
        },
        validation: { status: "dirty", issues: [] },
      };
    }
    case "apply_semantic_patch": {
      const result = applySemanticPatch(state.canonical, state.registry, action.operation);
      if (!result.ok) {
        return { ...state, validation: { status: "invalid", issues: [result.issue] } };
      }
      return { ...state, canonical: result.strategy, validation: { status: "dirty", issues: [] } };
    }
    case "set_active_view":
      return { ...state, editor: { ...state.editor, activeView: action.view } };
    case "select_semantic":
      return { ...state, editor: { ...state.editor, selection: action.selection, selectedNodeId: action.selection?.componentId ?? null, selectedFieldPath: action.selection?.fieldPath ?? null } };
    case "set_left_panel_open":
      return { ...state, editor: { ...state.editor, leftPanelOpen: action.open } };
    case "set_left_panel_tab":
      return { ...state, editor: { ...state.editor, leftPanelTab: action.tab } };
    case "set_dashboard_open":
      return { ...state, editor: { ...state.editor, dashboardOpen: action.open } };
    case "move_node":
      return { ...state, editor: { ...state.editor, nodePositions: { ...state.editor.nodePositions, [action.componentId]: action.position } } };
    case "select_node":
      return { ...state, editor: { ...state.editor, selectedNodeId: action.componentId, selectedFieldPath: action.fieldPath ?? null, selection: action.componentId ? semanticSelection("rule", action.componentId, { fieldPath: action.fieldPath }) : null } };
    case "select_concept":
      return { ...state, editor: { ...state.editor, selectedConceptId: action.conceptId } };
    case "open_group":
      return { ...state, editor: { ...state.editor, openGroupId: action.groupId, selectedConceptId: null } };
    case "validation_started":
      return { ...state, validation: { ...state.validation, status: "checking" } };
    case "validation_finished":
      return {
        ...state,
        validation: { status: action.valid ? "valid" : "invalid", issues: action.issues },
      };
  }
}

interface StrategyEditorContextValue {
  state: StrategyEditorState;
  dispatch: Dispatch<StrategyEditorAction>;
}

const StrategyEditorContext = createContext<StrategyEditorContextValue | null>(null);

export function StrategyEditorProvider({
  bootstrap,
  initialView = "overview",
  children,
}: {
  bootstrap: EditorBootstrap;
  initialView?: EditorView;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(editorReducer, bootstrap, (value) => createEditorState(value, initialView));
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StrategyEditorContext.Provider value={value}>{children}</StrategyEditorContext.Provider>;
}

export function useStrategyEditor(): StrategyEditorContextValue {
  const context = useContext(StrategyEditorContext);
  if (!context) throw new Error("useStrategyEditor must be used inside StrategyEditorProvider");
  return context;
}
