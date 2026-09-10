import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import type { Viewport, XYPosition } from "@xyflow/react";

import type {
  CanonicalStrategyV1,
  EditorBootstrap,
  RegistryPayload,
  ValidationIssue,
} from "../domain/canonical";
import { DEFAULT_NODE_POSITIONS, type NodePositions } from "../domain/flow";
import { applySemanticPatch, type SemanticPatch } from "../domain/patch";

export type EditorView = "overview" | "guided" | "flow";

export interface StrategyEditorState {
  canonical: CanonicalStrategyV1;
  registry: RegistryPayload;
  editor: {
    activeView: EditorView;
    nodePositions: NodePositions;
    viewport: Viewport;
    selectedNodeId: string | null;
    selectedFieldPath: string | null;
  };
  validation: {
    status: "valid" | "dirty" | "invalid" | "checking";
    issues: ValidationIssue[];
  };
}

export type StrategyEditorAction =
  | { type: "apply_semantic_patch"; operation: SemanticPatch }
  | { type: "replace_canonical"; canonical: CanonicalStrategyV1 }
  | { type: "set_active_view"; view: EditorView }
  | { type: "move_node"; componentId: string; position: XYPosition }
  | { type: "set_viewport"; viewport: Viewport }
  | { type: "select_node"; componentId: string | null; fieldPath?: string | null }
  | { type: "validation_started" }
  | { type: "validation_finished"; valid: boolean; issues: ValidationIssue[] };

export function createEditorState(bootstrap: EditorBootstrap): StrategyEditorState {
  return {
    canonical: bootstrap.strategy,
    registry: bootstrap.registry,
    editor: {
      activeView: "overview",
      nodePositions: { ...DEFAULT_NODE_POSITIONS },
      viewport: { x: 0, y: 0, zoom: 0.85 },
      selectedNodeId: null,
      selectedFieldPath: null,
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
    case "apply_semantic_patch": {
      const result = applySemanticPatch(state.canonical, state.registry, action.operation);
      if (!result.ok) {
        return { ...state, validation: { status: "invalid", issues: [result.issue] } };
      }
      return { ...state, canonical: result.strategy, validation: { status: "dirty", issues: [] } };
    }
    case "set_active_view":
      return { ...state, editor: { ...state.editor, activeView: action.view } };
    case "move_node":
      return {
        ...state,
        editor: {
          ...state.editor,
          nodePositions: { ...state.editor.nodePositions, [action.componentId]: action.position },
        },
      };
    case "set_viewport":
      return { ...state, editor: { ...state.editor, viewport: action.viewport } };
    case "select_node":
      return { ...state, editor: { ...state.editor, selectedNodeId: action.componentId, selectedFieldPath: action.fieldPath ?? null } };
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
  children,
}: {
  bootstrap: EditorBootstrap;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(editorReducer, bootstrap, createEditorState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StrategyEditorContext.Provider value={value}>{children}</StrategyEditorContext.Provider>;
}

export function useStrategyEditor(): StrategyEditorContextValue {
  const context = useContext(StrategyEditorContext);
  if (!context) throw new Error("useStrategyEditor must be used inside StrategyEditorProvider");
  return context;
}
