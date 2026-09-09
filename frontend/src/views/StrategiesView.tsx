export function StrategiesView({ onExplore }: { onExplore: () => void }) {
  return <section className="page strategies-page"><header className="page-heading"><span className="eyebrow">Strategies</span><h1>Your strategies</h1><p>Saved strategies will live here once persistence is available.</p></header><div className="empty-state"><div className="empty-icon">＋</div><h2>No saved strategies yet</h2><p>For now, open a backend-supported example and work with it during this session.</p><button className="primary-button" onClick={onExplore}>Explore examples</button></div></section>;
}
