import type { BacktestResult } from "../domain/backtest";

function money(value: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value));
}

function percentage(value: string): string {
  return new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 2 }).format(Number(value));
}

function EquityChart({ result }: { result: BacktestResult }) {
  const width = 720;
  const height = 190;
  const padding = 18;
  const values = result.equity_curve.map((point) => Number(point.value));
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  const denominator = Math.max(values.length - 1, 1);
  const points = values.map((value, index) => {
    const x = padding + (index / denominator) * (width - padding * 2);
    const y = height - padding - ((value - minimum) / range) * (height - padding * 2);
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg className="equity-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Portfolio value equity curve">
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} />
      <polyline points={points} />
    </svg>
  );
}

export function BacktestResultPanel({ result }: { result: BacktestResult }) {
  return (
    <section className="backtest-panel" aria-label="Backtest result">
      <div className="result-heading"><div><span className="eyebrow">LEAN</span><h2>Backtest Result</h2></div><span className="result-success">Completed</span></div>
      <div className="result-metrics">
        <div><span>Final Value</span><strong>{money(result.final_value)}</strong></div>
        <div><span>Return</span><strong>{percentage(result.total_return)}</strong></div>
        <div><span>Orders</span><strong>{result.total_orders}</strong></div>
        <div><span>Fees</span><strong>{money(result.total_fees)}</strong></div>
      </div>
      <h3>Portfolio Value</h3>
      <EquityChart result={result} />
      <div className="chart-range">
        <span>{new Date(result.equity_curve[0].timestamp).toLocaleDateString("en-US", { month: "short" })}</span>
        <span>{new Date(result.equity_curve.at(-1)!.timestamp).toLocaleDateString("en-US", { month: "short" })}</span>
      </div>
    </section>
  );
}
