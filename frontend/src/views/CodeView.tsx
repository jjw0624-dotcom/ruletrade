import { useEffect, useRef } from "react";
import { useStrategyEditor } from "../store/editorStore";
import { isBlankWorkspaceTarget } from "../domain/semanticSelection";

// A precise, read-oriented source view. Editing arbitrary JSON would create a second authoring grammar.
export function CodeView() {
  const { state, dispatch } = useStrategyEditor();
  const selected = state.editor.selection?.componentId;
  const focused = useRef<HTMLElement>(null);
  useEffect(() => { if (state.editor.activeView === "code") focused.current?.scrollIntoView({ block: "nearest" }); }, [selected, state.editor.activeView]);
  return <div className="code-representation" onClick={(event) => { if (isBlankWorkspaceTarget(event.target)) dispatch({ type: "select_semantic", selection: null }); }}><header className="representation-intro"><span className="eyebrow">Code</span><h1>Canonical Strategy v1</h1><p>Exact components and connections. Select a component to edit supported fields in the Inspector. Arbitrary text editing needs a restricted parser and is deferred.</p></header>
    <pre className="code-metadata">{JSON.stringify({ api_version: state.canonical.api_version, metadata: state.canonical.metadata, definitions: state.canonical.definitions, entrypoints: state.canonical.entrypoints }, null, 2)}</pre>
    <h2>Components</h2>{state.canonical.graph.components.map((item) => <section key={item.id} ref={selected === item.id ? focused : undefined} className={`code-component${selected === item.id ? " selected" : ""}`} data-component-id={item.id}>
      <button className="rule-select" onClick={() => dispatch({ type: "select_semantic", selection: { role: "rule", componentId: item.id, fieldPath: state.editor.selection?.componentId === item.id ? state.editor.selection.fieldPath : null, groupId: null } })}>{item.id} · {item.primitive}</button>
      <pre>{JSON.stringify(item.config, null, 2)}</pre>
    </section>)}
    <h2>Connections</h2><pre className="code-metadata">{JSON.stringify(state.canonical.graph.connections, null, 2)}</pre>
  </div>;
}
