export interface BacktestConfig {
  start_date: string;
  end_date: string;
  initial_cash: string;
  dataset_id: "golden-synthetic" | "filter-synthetic";
}

export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  start_date: "2024-01-01",
  end_date: "2024-12-31",
  initial_cash: "100000",
  dataset_id: "filter-synthetic",
};

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

export interface LeanBacktestResponse {
  strategy_hash: string;
  engine: "lean";
  config: BacktestConfig;
  result: BacktestResult;
}

export interface BacktestApiError {
  code: string;
  message: string;
}
