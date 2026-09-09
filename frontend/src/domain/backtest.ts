export interface BacktestConfig {
  start_date: string;
  end_date: string;
  initial_cash: string;
  dataset_id: "golden-synthetic" | "filter-synthetic" | "cooldown-synthetic";
}

export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  start_date: "2024-01-01",
  end_date: "2024-02-29",
  initial_cash: "100000",
  dataset_id: "cooldown-synthetic",
};

export type BacktestStatus =
  | { status: "idle"; result: null; error: null }
  | { status: "running"; result: null; error: null }
  | { status: "success"; result: LeanBacktestResponse; error: null }
  | { status: "error"; result: null; error: BacktestApiError };

export type BacktestAction =
  | { type: "started" }
  | { type: "succeeded"; result: LeanBacktestResponse }
  | { type: "failed"; error: BacktestApiError }
  | { type: "reset" };

export const INITIAL_BACKTEST_STATUS: BacktestStatus = { status: "idle", result: null, error: null };

export function backtestReducer(state: BacktestStatus, action: BacktestAction): BacktestStatus {
  switch (action.type) {
    case "started": return state.status === "running" ? state : { status: "running", result: null, error: null };
    case "succeeded": return { status: "success", result: action.result, error: null };
    case "failed": return { status: "error", result: null, error: action.error };
    case "reset": return INITIAL_BACKTEST_STATUS;
  }
}

export interface EquityPoint {
  timestamp: string;
  value: string;
}

export interface BacktestResult {
  initial_value: string;
  final_value: string;
  total_return: string;
  total_orders: number;
  total_fees: string;
  equity_curve: EquityPoint[];
}

export interface BacktestTimings {
  source_load_ms: number;
  validation_ms: number;
  compiler_ms: number;
  codegen_ms: number;
  csharp_compile_ms: number;
  lean_execution_ms: number;
  result_load_ms: number;
  normalization_ms: number;
  total_ms: number;
}

export interface LeanBacktestResponse {
  strategy_hash: string;
  engine: "lean";
  config: BacktestConfig;
  result: BacktestResult;
  timings: BacktestTimings;
}

export interface BacktestApiError {
  code: string;
  message: string;
}
