import type { BacktestResult } from "../domain/backtest";

function money(value: string): string { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value)); }
function percentage(value: string): string { return new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 2 }).format(Number(value)); }

function EquityChart({ result }: { result: BacktestResult }) {
  const width = 900, height = 260, padding = 24;
  const values = result.equity_curve.map((point) => Number(point.value));
  const minimum = Math.min(...values), maximum = Math.max(...values), range = maximum - minimum || 1, denominator = Math.max(values.length - 1, 1);
  const points = values.map((value, index) => `${padding + (index / denominator) * (width - padding * 2)},${height - padding - ((value - minimum) / range) * (height - padding * 2)}`).join(" ");
  return <svg className="equity-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Portfolio value equity curve"><line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} /><polyline points={points} /></svg>;
}

export function BacktestResultPanel({ result }: { result: BacktestResult }) {
  return <section className="backtest-panel" aria-label="Backtest result">
    <div className="result-question"><span className="eyebrow">How did it do?</span><h2>{money(result.initial_value)} became <strong>{money(result.final_value)}</strong></h2></div>
    <div className="result-metrics"><div><span>Initial value</span><strong>{money(result.initial_value)}</strong></div><div><span>Final value</span><strong>{money(result.final_value)}</strong></div><div><span>Total return</span><strong>{percentage(result.total_return)}</strong></div><div><span>Total orders</span><strong>{result.total_orders}</strong></div><div><span>Total fees</span><strong>{money(result.total_fees)}</strong></div></div>
    <div className="chart-heading"><div><span className="eyebrow">Portfolio value</span><h3>Value across the test period</h3></div><span>Real normalized engine result</span></div>
    <EquityChart result={result} />
    <div className="chart-range"><span>{new Date(result.equity_curve[0].timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span><span>{new Date(result.equity_curve.at(-1)!.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span></div>
  </section>;
}
