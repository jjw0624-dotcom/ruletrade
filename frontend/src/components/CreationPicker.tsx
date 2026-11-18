import { STRATEGY_EXAMPLES, STRATEGY_STRUCTURES, type ExampleId } from "../domain/examples";

export function CreationPicker({ onChoose, onCatalog, onProgram, onClose, loading, error }: { onChoose: (id: ExampleId) => void; onCatalog: () => void; onProgram?: () => void; onClose: () => void; loading?: ExampleId | null; error?: string | null }) {
  const group = (title: string, items: typeof STRATEGY_EXAMPLES) => <section className="picker-group"><h3>{title}</h3><div>{items.map((item) => <button key={item.id} disabled={loading !== null} onClick={() => onChoose(item.id)}><span><strong>{item.title}</strong><small>{item.description}</small></span><span>{loading === item.id ? "Loading…" : "→"}</span></button>)}</div></section>;
  return <div className="modal-backdrop" role="presentation"><section className="creation-picker" role="dialog" aria-modal="true" aria-labelledby="picker-title"><header><div><span className="eyebrow">New strategy</span><h2 id="picker-title">Create a strategy</h2></div><button className="close-button" aria-label="Close" onClick={onClose}>×</button></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="picker-group"><h3>Build with tested rules</h3><div><button disabled={loading !== null} onClick={onCatalog}><span><strong>Choose a strategy rule</strong><small>Configure one maintained strategy shape, save it, and continue directly to testing and research</small></span><span>→</span></button></div></section>
    {group("Start with an example", STRATEGY_EXAMPLES)}
    {group("Start with a structure", STRATEGY_STRUCTURES)}
    {onProgram && <section className="picker-group"><h3>Builder Lab</h3><div><button disabled={loading !== null} onClick={onProgram}><span><strong>Experimental blank Builder</strong><small>Explore unfinished Flow and Blocky composition without treating it as the MVP creation path</small></span><span>Lab</span></button></div></section>}
    <section className="picker-group"><h3>Bring something in</h3><button className="import-unavailable" disabled><span><strong>Import strategy</strong><small>Bring in a strategy file</small></span><b>Coming later</b></button></section>
  </section></div>;
}
