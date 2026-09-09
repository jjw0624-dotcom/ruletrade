import { useReducer } from "react";

import { LeanBacktestApiError, runLeanBacktest } from "../api";
import { backtestReducer, INITIAL_BACKTEST_STATUS, type BacktestConfig } from "../domain/backtest";
import type { CanonicalStrategyV1 } from "../domain/canonical";

export function useBacktestRun() {
  const [state, dispatch] = useReducer(backtestReducer, INITIAL_BACKTEST_STATUS);

  async function run(strategy: CanonicalStrategyV1, config: BacktestConfig) {
    if (state.status === "running") return;
    dispatch({ type: "started" });
    try {
      dispatch({ type: "succeeded", result: await runLeanBacktest(strategy, config) });
    } catch (error) {
      const detail = error instanceof LeanBacktestApiError
        ? error.detail
        : { code: "request_failed", message: error instanceof Error ? error.message : String(error) };
      dispatch({ type: "failed", error: detail });
    }
  }

  return { state, run, reset: () => dispatch({ type: "reset" }) };
}
