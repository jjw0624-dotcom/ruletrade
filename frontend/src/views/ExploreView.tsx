import { STRATEGY_EXAMPLES, STRATEGY_STRUCTURES, type ExampleId } from "../domain/examples";
import { StartingPointCard } from "../components/StartingPointCard";

export function ExploreView({ onOpen, onCreate }: { onOpen: (id: ExampleId) => void; onCreate: () => void }) {
  return <section className="page explore-page"><header className="page-heading"><span className="eyebrow">Explore</span><h1>Ideas you can actually test</h1><p>Every starting point becomes an ordinary saved Strategy. Understand and edit it in the shared Builder.</p></header><section className="explore-section"><h2>Strategy examples</h2><div className="starting-grid">{STRATEGY_EXAMPLES.map((point) => <StartingPointCard key={point.id} point={point} onSelect={onOpen} />)}</div></section><section className="explore-section"><div className="section-heading"><div><h2>Start with a structure</h2><p>Use a valid foundation and shape it in Guide or Flow.</p></div><button className="primary-button" onClick={onCreate}>+ New strategy</button></div><div className="starting-grid">{STRATEGY_STRUCTURES.map((point) => <StartingPointCard key={point.id} point={point} onSelect={onOpen} />)}</div></section></section>;
}
