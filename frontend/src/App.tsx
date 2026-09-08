import { useEffect, useState } from "react";

import { loadEditorBootstrap } from "./api";
import type { EditorBootstrap } from "./domain/canonical";
import { StrategyEditor } from "./StrategyEditor";
import { StrategyEditorProvider } from "./store/editorStore";

export default function App() {
  const [bootstrap, setBootstrap] = useState<EditorBootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadEditorBootstrap().then(setBootstrap).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, []);

  if (error) return <div className="load-state error-panel"><strong>Could not load Strategy Editor</strong><p>{error}</p></div>;
  if (!bootstrap) return <div className="load-state">Loading Canonical strategy…</div>;
  return <StrategyEditorProvider bootstrap={bootstrap}><StrategyEditor /></StrategyEditorProvider>;
}
