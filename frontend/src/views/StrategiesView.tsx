import type { StrategyRecord } from "../strategyApi";

export function StrategiesView({ status, strategies, error, onExplore, onOpen, onRetry }: {
  status: "loading" | "loaded" | "error";
  strategies: StrategyRecord[];
  error: string | null;
  onExplore: () => void;
  onOpen: (id: string) => void;
  onRetry: () => void;
}) {
  return <section className="page strategies-page"><header className="page-heading"><span className="eyebrow">Strategies</span><h1>My Strategies</h1><p>Your saved investment ideas and research.</p><button className="primary-button" onClick={onExplore}>+ New strategy</button></header>
    {status === "loading" && <div className="page-state" role="status"><span className="loading-spinner" /><h2>Loading strategies…</h2></div>}
    {status === "error" && <div className="empty-state error-state" role="alert"><h2>We couldn't load your strategies</h2><p>{error}</p><button className="primary-button" onClick={onRetry}>Try again</button></div>}
    {status === "loaded" && strategies.length === 0 && <div className="empty-state"><div className="empty-icon">＋</div><h2>No saved strategies yet</h2><p>Start with an example, understand how it works, then make it yours.</p><button className="primary-button" onClick={onExplore}>Explore ideas</button></div>}
    {status === "loaded" && strategies.length > 0 && <div className="strategy-list">{strategies.map((strategy) => <button className="strategy-list-item" key={strategy.id} onClick={() => onOpen(strategy.id)}><span><strong>{strategy.name}</strong><small>Updated {new Date(strategy.updated_at).toLocaleString()}</small></span><span aria-hidden="true">→</span></button>)}</div>}
  </section>;
}
