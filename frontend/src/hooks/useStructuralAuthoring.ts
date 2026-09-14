import { useCallback, useEffect, useRef, useState } from "react";

import {
  structuralAuthoringApi,
  StructuralAuthoringApiError,
  type StructuralAuthoringCapabilities,
  type StructuralAuthoringOperation,
} from "../structuralAuthoringApi";
import { useStrategyEditor } from "../store/editorStore";

export type StructuralStatus = "checking" | "ready" | "applying" | "error";

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
    || code === "unsupported_shape_transformation") {
    return { message: "That strategy object is no longer available.", detail: code };
  }
  if (code === "selection_count_exceeds_assets") {
    return { message: "Choose cannot be greater than the number of available assets.", detail: code };
  }
  if (code === "result_invalid") {
    return {
      message: "This condition can't be removed because the current strategy still needs it.",
      detail: `${code}: ${reason.detail.message}`,
    };
  }
  if (code === "qualification_condition_exists"
    || code === "unsupported_qualification_structure") {
    return { message: "That structural change isn't available here.", detail: code };
  }
  return { message: reason.detail.message, detail: code };
}

export function useStructuralAuthoring() {
  const { state, dispatch } = useStrategyEditor();
  const latest = useRef(state.canonical);
  const [capabilities, setCapabilities] = useState<StructuralAuthoringCapabilities | null>(null);
  const [status, setStatus] = useState<StructuralStatus>("checking");
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null);
  latest.current = state.canonical;

  useEffect(() => {
    let active = true;
    setCapabilities(null);
    setStatus("checking");
    setError(null);
    structuralAuthoringApi.capabilities(state.canonical)
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

  const apply = useCallback(async (
    operation: StructuralAuthoringOperation,
    focus?: { componentId?: string | null; conceptId?: string | null },
  ) => {
    const source = latest.current;
    setStatus("applying");
    setError(null);
    try {
      const canonical = await structuralAuthoringApi.apply(source, operation);
      if (latest.current !== source) {
        setStatus("error");
        setError({ message: "The strategy changed while this update was being applied. Please try again." });
        return false;
      }
      dispatch({
        type: "replace_canonical_dirty",
        canonical,
        selectedNodeId: focus?.componentId,
        selectedConceptId: focus?.conceptId,
      });
      return true;
    } catch (reason) {
      setStatus("error");
      setError(productMessage(reason));
      return false;
    }
  }, [dispatch]);

  return { capabilities, status, error, apply };
}
