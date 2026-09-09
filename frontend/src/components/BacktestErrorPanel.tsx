import type { BacktestApiError } from "../domain/backtest";

const messages: Record<string, { title: string; guidance: string }> = {
  invalid_strategy: { title: "This strategy needs attention", guidance: "Review the highlighted strategy fields, then try again." },
  unsupported_strategy: { title: "This strategy cannot be tested yet", guidance: "The current backtest engine does not support this combination of rules." },
  runtime_unavailable: { title: "The backtest service is unavailable", guidance: "Try again after the execution service is running." },
  execution_failed: { title: "The backtest could not finish", guidance: "The execution service returned an error. Try again or ask a developer to inspect the run logs." },
  malformed_result: { title: "The result could not be read", guidance: "The execution completed without a usable result." },
};

export function BacktestErrorPanel({ error }: { error: BacktestApiError }) {
  const copy = messages[error.code] ?? { title: "The backtest could not run", guidance: "Try again. If this continues, ask a developer to inspect the service." };
  return <section className="backtest-error" role="alert"><strong>{copy.title}</strong><p>{copy.guidance}</p><details><summary>Developer detail</summary><code>{error.code}</code><p>{error.message}</p></details></section>;
}
