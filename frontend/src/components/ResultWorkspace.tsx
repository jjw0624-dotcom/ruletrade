import type { LeanBacktestResponse } from "../domain/backtest";
import { BacktestResultPanel } from "./BacktestResultPanel";

export function ResultWorkspace({ response, strategyName, onBack }: { response: LeanBacktestResponse; strategyName: string; onBack: () => void }) {
  return <section className="result-workspace page"><header className="workspace-heading"><div><span className="eyebrow">Backtest result</span><h1>{strategyName}</h1><p>{response.config.start_date} to {response.config.end_date}</p></div><button className="secondary-button" onClick={onBack}>Back to strategy</button></header><BacktestResultPanel result={response.result} /><section className="analysis-boundary"><div className="analysis-icon">↳</div><div><span className="eyebrow">Analysis</span><h2>Understand individual decisions</h2><p>Decision explanations will appear here when run evidence is available.</p></div></section></section>;
}
