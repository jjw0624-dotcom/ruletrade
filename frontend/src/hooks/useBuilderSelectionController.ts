import { useCallback, useState } from "react";

/**
 * Owns navigation focus only. Draft lifecycle is deliberately absent from this
 * controller so selecting or clearing focus cannot commit or discard work.
 */
export function useBuilderSelectionController(onNavigate: () => void) {
  const [selectedId, replaceSelection] = useState<string | null>(null);
  const select = useCallback((id: string | null) => {
    replaceSelection(id);
    if (id) onNavigate();
  }, [onNavigate]);
  return { selectedId, select, replaceSelection };
}
