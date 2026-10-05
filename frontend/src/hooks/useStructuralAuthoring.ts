import { useCallback, useEffect, useRef, useState } from "react";

import {
  authoringApi,
  StructuralAuthoringApiError,
  type StructuralAuthoringCapabilities,
  type AuthoringApplyResult,
  type ComposeStrategyOperation,
  type StructuralAuthoringOperation,
} from "../structuralAuthoringApi";
import { useStrategyEditor } from "../store/editorStore";
import type { SemanticSelection } from "../domain/semanticSelection";

export type StructuralStatus = "checking" | "ready" | "applying" | "error";
export type SemanticEditStatus = "idle" | "unfinished" | "updating" | "invalid";
export interface SemanticEditState { status: SemanticEditStatus; message: string | null }

const IDLE_SEMANTIC_EDIT: SemanticEditState = { status: "idle", message: null };

export function isLatestAuthoringRequest(requestId: number, latestRequestId: number): boolean {
  return requestId === latestRequestId;
}

function productMessage(reason: unknown): { message: string; detail?: string } {
  if (!(reason instanceof StructuralAuthoringApiError)) {
    return {
      message: "We couldn't update the strategy right now.",
      detail: reason instanceof Error ? reason.message : undefined,
    };
  }
  const code = reason.detail.code;
  if (code === "component_not_found" || code === "unsupported_group"
    || code === "unsupported_qualification_target"
    || code === "unsupported_shape_transformation" || code === "unsupported_target") {
    return { message: "That strategy object is no longer available.", detail: code };
  }
  if (code === "selection_count_exceeds_assets") {
    return { message: "Choose cannot be greater than the number of available assets.", detail: code };
  }
  if (code === "result_invalid") {
    return {
      message: "That change would make this strategy invalid. Nothing was changed.",
      detail: `${code}: ${reason.detail.message}`,
    };
  }
  if (code === "invalid_input") {
    return { message: reason.detail.message || "That value is not valid for this strategy.", detail: code };
  }
  if (code === "qualification_condition_exists"
    || code === "unsupported_qualification_structure") {
    return { message: "That structural change isn't available here.", detail: code };
  }
  return { message: reason.detail.message, detail: code };
}

export function useAuthoring() {
  const { state, dispatch } = useStrategyEditor();
  const latest = useRef(state.canonical);
  const [capabilities, setCapabilities] = useState<StructuralAuthoringCapabilities | null>(null);
  const [status, setStatus] = useState<StructuralStatus>("checking");
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null);
  const [semanticEdit, setSemanticEdit] = useState<SemanticEditState>(IDLE_SEMANTIC_EDIT);
  const requestSequence = useRef(0);
  latest.current = state.canonical;

  useEffect(() => {
    let active = true;
    setCapabilities(null);
    setStatus("checking");
    setError(null);
    authoringApi.capabilities(state.canonical)
      .then((result) => {
        if (!active) return;
        setCapabilities(result);
        setStatus("ready");
      })
      .catch((reason) => {
        if (!active) return;
        setStatus("error");
        setError(productMessage(reason));
      });
    return () => { active = false; };
  }, [state.canonical]);

  const applyResolved = useCallback(async (
    operation: StructuralAuthoringOperation,
    resolveSelection?: (result: AuthoringApplyResult) => SemanticSelection | null | undefined,
  ) => {
    const source = latest.current;
    const requestId = ++requestSequence.current;
    setStatus("applying");
    setError(null);
    setSemanticEdit({ status: "updating", message: "Updating…" });
    try {
      const result = await authoringApi.applyWithResult(source, operation);
      if (!isLatestAuthoringRequest(requestId, requestSequence.current)) return false;
      if (latest.current !== source) {
        setStatus("error");
        setError({ message: "The strategy changed while this update was being applied. Please try again." });
        setSemanticEdit({ status: "invalid", message: "The committed strategy changed. Review this edit and try again." });
        return false;
      }
      dispatch({
        type: "replace_canonical_dirty",
        canonical: result.strategy,
        selection: resolveSelection?.(result),
      });
      setStatus("ready");
      setSemanticEdit(IDLE_SEMANTIC_EDIT);
      return true;
    } catch (reason) {
      if (!isLatestAuthoringRequest(requestId, requestSequence.current)) return false;
      const product = productMessage(reason);
      setStatus("error");
      setError(product);
      setSemanticEdit({ status: "invalid", message: product.message });
      return false;
    }
  }, [dispatch]);

  const apply = useCallback((operation: StructuralAuthoringOperation, selection?: SemanticSelection | null) =>
    applyResolved(operation, () => selection), [applyResolved]);
  const compose = useCallback((operation: ComposeStrategyOperation, selection?: (result: AuthoringApplyResult) => SemanticSelection | null) =>
    applyResolved(operation, selection), [applyResolved]);

  const setSemanticEditStatus = useCallback((next: SemanticEditStatus, message?: string | null) => {
    setSemanticEdit(next === "idle" ? IDLE_SEMANTIC_EDIT : { status: next, message: message ?? (next === "unfinished" ? "Finish this semantic value before saving or testing." : next === "updating" ? "Updating…" : "This edit is invalid.") });
  }, []);

  return { capabilities, status, error, semanticEdit, setSemanticEditStatus, apply, compose };
}

export const useStructuralAuthoring = useAuthoring;
export type StructuralAuthoringController = Omit<ReturnType<typeof useAuthoring>, "semanticEdit" | "setSemanticEditStatus"> & {
  semanticEdit?: SemanticEditState;
  setSemanticEditStatus?: (next: SemanticEditStatus, message?: string | null) => void;
};
