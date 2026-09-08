import { validateCanonical } from "./api";
import { GuidedView } from "./views/GuidedView";
import { FlowView } from "./views/FlowView";
import { useStrategyEditor, type EditorView } from "./store/editorStore";

export function StrategyEditor() {
  const { state, dispatch } = useStrategyEditor();

  async function validate() {
    dispatch({ type: "validation_started" });
    try {
      const result = await validateCanonical(state.canonical);
      dispatch({ type: "validation_finished", ...result });
    } catch (error) {
      dispatch({
        type: "validation_finished",
        valid: false,
        issues: [{ path: "network", message: error instanceof Error ? error.message : String(error) }],
      });
    }
  }

  function tab(view: EditorView, label: string) {
    return (
      <button
        className={state.editor.activeView === view ? "view-tab active" : "view-tab"}
        onClick={() => dispatch({ type: "set_active_view", view })}
        aria-pressed={state.editor.activeView === view}
      >
        {label}
      </button>
    );
  }

  return (
    <main className="editor-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">R</span><span>RuleTrade</span></div>
        <div className="strategy-title"><span>Strategy Editor</span><h1>{state.canonical.metadata.name}</h1></div>
        <button className="validate-button" onClick={validate} disabled={state.validation.status === "checking"}>
          {state.validation.status === "checking" ? "Validating…" : "Validate strategy"}
        </button>
      </header>

      <nav className="view-nav" aria-label="Strategy views">
        {tab("guided", "Guided")}
        {tab("flow", "Flow")}
        <span className={`validation-pill ${state.validation.status}`}>
          {state.validation.status === "valid" ? "Valid Canonical" : state.validation.status}
        </span>
      </nav>

      {state.validation.issues.length > 0 && (
        <div className="error-panel" role="alert">
          <strong>Strategy needs attention</strong>
          {state.validation.issues.map((issue) => <p key={`${issue.path}-${issue.message}`}><code>{issue.path}</code> {issue.message}</p>)}
        </div>
      )}

      <section className="workspace">
        {state.editor.activeView === "guided" ? <GuidedView /> : <FlowView />}
      </section>
    </main>
  );
}
