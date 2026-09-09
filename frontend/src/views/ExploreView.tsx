import { STRATEGY_EXAMPLES, type ExampleId } from "../domain/examples";
export function ExploreView({ onOpen }: { onOpen: (id: ExampleId) => void }) {
  return <section className="page explore-page"><header className="page-heading"><span className="eyebrow">Explore</span><h1>Start with a strategy you can understand</h1><p>Open a backend-supported example, inspect every rule, and run it through the real backtest engine.</p></header><div className="example-grid">
    {STRATEGY_EXAMPLES.map((example, index) => <article className="example-card" key={example.id}><div className="example-number">0{index + 1}</div><div><h2>{example.title}</h2><p>{example.description}</p></div><p className="example-detail">{example.detail}</p><div className="tag-row">{example.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><button className="primary-button" onClick={() => onOpen(example.id)}>Explore strategy <span>→</span></button></article>)}
  </div></section>;
}
