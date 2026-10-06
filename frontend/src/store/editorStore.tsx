import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from "react";

import type {
  CanonicalStrategyV1,
  ConditionExpression,
  EditorBootstrap,
  RegistryPayload,
  ValidationIssue,
} from "../domain/canonical";
import { selectionInCanonical, type SemanticSelection } from "../domain/semanticSelection";
import { EMPTY_LOGIC_DRAFT, type DraftControlKind, type LogicDraftState, type LogicDraftStatus, type LogicWorkingProgram } from "../domain/logicDraft";
import { EMPTY_FLOW_DRAFT, type FlowDraftConnection, type FlowDraftIntent, type FlowDraftState, type FlowDraftStatus } from "../domain/flowDraft";

export type EditorView = "overview" | "guided" | "flow" | "blocky" | "rules" | "code" | "ai";

export interface StrategyEditorState {
  canonical: CanonicalStrategyV1;
  registry: RegistryPayload;
  editor: {
    activeView: EditorView;
    selection: SemanticSelection | null;
    leftPanelOpen: boolean;
    leftPanelTab: "structure" | "blocks";
    logicDraft: LogicDraftState;
    flowDraft: FlowDraftState;
  };
  validation: {
    status: "valid" | "dirty" | "invalid" | "checking";
    issues: ValidationIssue[];
  };
}

export type StrategyEditorAction =
  | { type: "replace_canonical"; canonical: CanonicalStrategyV1 }
  | { type: "replace_canonical_dirty"; canonical: CanonicalStrategyV1; selection?: SemanticSelection | null }
  | { type: "set_active_view"; view: EditorView }
  | { type: "select_semantic"; selection: SemanticSelection | null }
  | { type: "set_left_panel_open"; open: boolean }
  | { type: "set_left_panel_tab"; tab: "structure" | "blocks" }
  | { type: "request_logic_control"; kind: DraftControlKind; position?: { x: number; y: number } }
  | { type: "ack_logic_control"; draftId: string }
  | { type: "set_logic_working_program"; program: LogicWorkingProgram | null; status: LogicDraftStatus }
  | { type: "set_logic_draft_condition"; draftId: string; condition: ConditionExpression }
  | { type: "select_logic_draft"; draftId: string | null }
  | { type: "request_remove_logic_draft"; draftId: string }
  | { type: "ack_remove_logic_draft" }
  | { type: "restore_logic_program" }
  | { type: "begin_flow_draft"; intent: FlowDraftIntent }
  | { type: "set_flow_draft_connection"; connection: FlowDraftConnection; status: FlowDraftStatus; message?: string | null }
  | { type: "clear_flow_draft_connection" }
  | { type: "set_flow_draft_status"; status: FlowDraftStatus; message?: string | null }
  | { type: "clear_flow_draft" }
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
      logicDraft: EMPTY_LOGIC_DRAFT,
      flowDraft: EMPTY_FLOW_DRAFT,
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
      return { ...state, canonical: action.canonical,
        editor: { ...state.editor, selection: selectionInCanonical(state.editor.selection, new Set(action.canonical.graph.components.map((item) => item.id))) },
        validation: { status: "valid", issues: [] } };
    case "replace_canonical_dirty": {
      const survivingIds = new Set(action.canonical.graph.components.map((item) => item.id));
      const selection = selectionInCanonical(action.selection !== undefined ? action.selection : state.editor.selection, survivingIds);
      return {
        ...state,
        canonical: action.canonical,
        editor: {
          ...state.editor,
          selection,
        },
        validation: { status: "dirty", issues: [] },
      };
    }
    case "set_active_view":
      return { ...state, editor: { ...state.editor, activeView: action.view } };
    case "select_semantic":
      return { ...state, editor: { ...state.editor, selection: action.selection, logicDraft: { ...state.editor.logicDraft, selectedDraftId: action.selection ? null : state.editor.logicDraft.selectedDraftId } } };
    case "set_left_panel_open":
      return { ...state, editor: { ...state.editor, leftPanelOpen: action.open } };
    case "set_left_panel_tab":
      return { ...state, editor: { ...state.editor, leftPanelTab: action.tab } };
    case "request_logic_control": {
      const draftId = `logic-draft-${state.editor.logicDraft.nextId}`;
      return { ...state, editor: { ...state.editor, logicDraft: {
        ...state.editor.logicDraft,
        nextId: state.editor.logicDraft.nextId + 1,
        pendingControls: [...state.editor.logicDraft.pendingControls, { draftId, kind: action.kind, position: action.position }],
        selectedDraftId: draftId,
      } } };
    }
    case "ack_logic_control":
      return { ...state, editor: { ...state.editor, logicDraft: {
        ...state.editor.logicDraft,
        pendingControls: state.editor.logicDraft.pendingControls.filter((item) => item.draftId !== action.draftId),
      } } };
    case "set_logic_working_program":
      return { ...state, editor: { ...state.editor, logicDraft: {
        ...state.editor.logicDraft,
        workingProgram: action.program,
        status: action.status,
        selectedDraftId: action.status === "clean" ? null : state.editor.logicDraft.selectedDraftId,
      } } };
    case "set_logic_draft_condition": {
      const program = state.editor.logicDraft.workingProgram;
      if (!program) return state;
      return { ...state, editor: { ...state.editor, logicDraft: {
        ...state.editor.logicDraft,
        workingProgram: { blocks: program.blocks.map((item) => item.workingId === action.draftId ? { ...item, condition: action.condition } : item) },
        status: "incomplete",
      } } };
    }
    case "select_logic_draft":
      return { ...state, editor: { ...state.editor, selection: action.draftId ? null : state.editor.selection, logicDraft: { ...state.editor.logicDraft, selectedDraftId: action.draftId } } };
    case "request_remove_logic_draft":
      return { ...state, editor: { ...state.editor, logicDraft: { ...state.editor.logicDraft, removalRequestId: action.draftId } } };
    case "ack_remove_logic_draft":
      return { ...state, editor: { ...state.editor, logicDraft: { ...state.editor.logicDraft, removalRequestId: null, selectedDraftId: null } } };
    case "restore_logic_program":
      return { ...state, editor: { ...state.editor, logicDraft: { ...EMPTY_LOGIC_DRAFT, nextId: state.editor.logicDraft.nextId, restoreVersion: state.editor.logicDraft.restoreVersion + 1 } } };
    case "begin_flow_draft":
      return { ...state, editor: { ...state.editor, flowDraft: {
        status: "incomplete", intent: action.intent, connection: null,
        message: `Configure ${action.intent.kind} for ${action.intent.targetLabel}, or discard this Flow draft.`,
      } } };
    case "set_flow_draft_connection":
      return { ...state, editor: { ...state.editor, flowDraft: {
        ...state.editor.flowDraft, connection: action.connection, status: action.status,
        message: action.message ?? state.editor.flowDraft.message,
      } } };
    case "clear_flow_draft_connection":
      return { ...state, editor: { ...state.editor, flowDraft: {
        ...state.editor.flowDraft, connection: null, status: "incomplete",
        message: state.editor.flowDraft.intent
          ? `Reconnect ${state.editor.flowDraft.intent.kind} to a compatible capital unit, or discard this draft.`
          : "Reconnect or discard this Flow draft.",
      } } };
    case "set_flow_draft_status":
      return { ...state, editor: { ...state.editor, flowDraft: {
        ...state.editor.flowDraft, status: action.status,
        message: action.message ?? state.editor.flowDraft.message,
      } } };
    case "clear_flow_draft":
      return { ...state, editor: { ...state.editor, flowDraft: EMPTY_FLOW_DRAFT } };
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
  initialSelection = null,
  initialLeftPanelTab = "structure",
  children,
}: {
  bootstrap: EditorBootstrap;
  initialView?: EditorView;
  initialSelection?: SemanticSelection | null;
  initialLeftPanelTab?: "structure" | "blocks";
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(editorReducer, bootstrap, (value) => {
    const initial = createEditorState(value, initialView);
    initial.editor.selection = initialSelection;
    initial.editor.leftPanelTab = initialLeftPanelTab;
    return initial;
  });
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StrategyEditorContext.Provider value={value}>{children}</StrategyEditorContext.Provider>;
}

export function useStrategyEditor(): StrategyEditorContextValue {
  const context = useContext(StrategyEditorContext);
  if (!context) throw new Error("useStrategyEditor must be used inside StrategyEditorProvider");
  return context;
}
