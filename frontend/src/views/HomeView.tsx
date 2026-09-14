import type { StrategyRecord } from "../strategyApi";
import { STRATEGY_EXAMPLES, type ExampleId } from "../domain/examples";
import { StartingPointCard } from "../components/StartingPointCard";

type Status = "loading" | "loaded" | "error";
const updated = (value: string) => new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export function HomeView({ status, strategies, error, onOpen, onRetry, onCreate, onExample, context = "home" }: { status: Status; strategies: StrategyRecord[]; error: string | null; onOpen: (id: string) => void; onRetry: () => void; onCreate: () => void; onExample: (id: ExampleId) => void; context?: "home" | "strategies" }) {
  const recent = [...strategies].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return <section className="page home-page"><header className="home-heading"><div><span className="eyebrow">{context === "strategies" ? "My strategies" : "Home"}</span><h1>{context === "strategies" ? "Your strategies" : "What were you working on?"}</h1></div><button className="primary-button" onClick={onCreate}>+ New strategy</button></header>
    {status === "loading" && <div className="page-state" role="status"><span className="loading-spinner" /><h2>Loading your work…</h2></div>}
    {status === "error" && <div className="empty-state error-state" role="alert"><h2>We couldn't load your strategies</h2><p>{error}</p><button className="primary-button" onClick={onRetry}>Try again</button></div>}
    {status === "loaded" && recent.length === 0 && <section className="home-empty"><span className="eyebrow">Start here</span><h2>What would you like to try?</h2><div>{STRATEGY_EXAMPLES.map((point) => <StartingPointCard compact key={point.id} point={point} onSelect={onExample} />)}</div><button className="secondary-button" onClick={onCreate}>Build your own strategy</button></section>}
    {status === "loaded" && recent.length > 0 && <><section className="continue-work"><span className="eyebrow">Continue</span><button onClick={() => onOpen(recent[0].id)}><div><h2>{recent[0].name}</h2><p>Updated {updated(recent[0].updated_at)}</p><small>Current version · {recent[0].current_revision_id.slice(0, 8)}</small></div><span>Open →</span></button></section><section className="recent-work"><h2>Recent strategies</h2><div>{recent.map((strategy) => <button key={strategy.id} onClick={() => onOpen(strategy.id)}><span><strong>{strategy.name}</strong><small>Updated {updated(strategy.updated_at)}</small></span><span>{strategy.current_revision_id.slice(0, 8)} · →</span></button>)}</div></section></>}
  </section>;
}
