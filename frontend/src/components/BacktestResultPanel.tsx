import type { BacktestResult } from "../domain/backtest";
import type { DecisionSession } from "../domain/decisionPresentation";

function money(value: string): string { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value)); }
function percentage(value: string): string { return new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 2 }).format(Number(value)); }

function markerKind(session: DecisionSession) { const kinds = new Set(session.events.map((event) => event.kind)); return kinds.has("fallback") ? "fallback" : kinds.has("cooldown") ? "eligibility" : kinds.has("filter") || kinds.has("selection") ? "selection" : "portfolio"; }

function EquityChart({ result, selectedTimestamp, decisionSessions = [], onSelectDecision }: { result: BacktestResult; selectedTimestamp?: string | null; decisionSessions?: DecisionSession[]; onSelectDecision?: (session: DecisionSession) => void }) {
  const width = 900, height = 260, padding = 24;
  const values = result.equity_curve.map((point) => Number(point.value));
  const minimum = Math.min(...values), maximum = Math.max(...values), range = maximum - minimum || 1, denominator = Math.max(values.length - 1, 1);
  const points = values.map((value, index) => `${padding + (index / denominator) * (width - padding * 2)},${height - padding - ((value - minimum) / range) * (height - padding * 2)}`).join(" ");
  const selectedIndex = selectedTimestamp ? result.equity_curve.findIndex((point) => point.timestamp.startsWith(selectedTimestamp)) : -1;
  const selectedX = selectedIndex >= 0 ? padding + (selectedIndex / denominator) * (width - padding * 2) : null;
  const markers = decisionSessions.flatMap((session) => { const index = result.equity_curve.findIndex((point) => point.timestamp.startsWith(session.sessionId)); if (index < 0) return []; const x = padding + (index / denominator) * (width - padding * 2); const value = values[index]; const y = height - padding - ((value - minimum) / range) * (height - padding * 2); return [{ session, x, y, kind: markerKind(session) }]; });
  return <svg className="equity-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Portfolio value equity curve with ${markers.length} decision markers${selectedTimestamp ? `, decision selected on ${selectedTimestamp}` : ""}`}><line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} /><polyline points={points} />{selectedX !== null && <line className="decision-crosshair" x1={selectedX} y1={padding} x2={selectedX} y2={height - padding} />}{markers.map(({ session, x, y, kind }) => <g key={session.sessionId} className={`decision-marker ${kind}${selectedTimestamp === session.sessionId ? " selected" : ""}`} role="button" tabIndex={0} aria-label={`${session.label}, ${session.sessionId}`} onClick={() => onSelectDecision?.(session)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectDecision?.(session); } }}><title>{session.label} · {session.sessionId}</title>{kind === "fallback" ? <path d={`M ${x} ${y - 8} L ${x + 8} ${y} L ${x} ${y + 8} L ${x - 8} ${y} Z`} /> : kind === "portfolio" ? <path d={`M ${x} ${y - 8} L ${x + 8} ${y + 7} L ${x - 8} ${y + 7} Z`} /> : <circle cx={x} cy={y} r="7" />}</g>)}</svg>;
}

export function BacktestResultPanel({ result, selectedTimestamp, decisionSessions, onSelectDecision }: { result: BacktestResult; selectedTimestamp?: string | null; decisionSessions?: DecisionSession[]; onSelectDecision?: (session: DecisionSession) => void }) {
  return <section className="backtest-panel" aria-label="Backtest result">
    <div className="result-question"><span className="eyebrow">How did it do?</span><h2>{money(result.initial_value)} became <strong>{money(result.final_value)}</strong></h2></div>
    <div className="result-metrics"><div><span>Initial value</span><strong>{money(result.initial_value)}</strong></div><div><span>Final value</span><strong>{money(result.final_value)}</strong></div><div><span>Total return</span><strong>{percentage(result.total_return)}</strong></div><div><span>Total orders</span><strong>{result.total_orders}</strong></div><div><span>Total fees</span><strong>{money(result.total_fees)}</strong></div></div>
    <div className="chart-heading"><div><span className="eyebrow">Portfolio value</span><h3>Value across the test period</h3></div><span>Real normalized engine result</span></div>
    {selectedTimestamp && <p className="chart-selection">Decision selected: {new Date(`${selectedTimestamp}T00:00:00`).toLocaleDateString()}</p>}
    <EquityChart result={result} selectedTimestamp={selectedTimestamp} decisionSessions={decisionSessions} onSelectDecision={onSelectDecision} />
    <div className="chart-range"><span>{new Date(result.equity_curve[0].timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span><span>{new Date(result.equity_curve.at(-1)!.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span></div>
  </section>;
}
