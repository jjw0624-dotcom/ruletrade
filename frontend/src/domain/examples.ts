import type { BacktestConfig } from "./backtest";

export type ExampleId = "sleeves" | "fallback" | "cooldown";

export interface StrategyExample {
  id: ExampleId;
  title: string;
  description: string;
  detail: string;
  tags: string[];
  backtestDefaults: BacktestConfig;
}

export const STRATEGY_EXAMPLES: StrategyExample[] = [
  {
    id: "sleeves",
    title: "Growth + Defensive",
    description: "Use recent strength for Growth and keep a defensive allocation alongside it.",
    detail: "Growth screens four technology-focused funds, selects the strongest two, and uses TLT when too few qualify. Defensive holds TLT and IEF equally.",
    tags: ["Two-part portfolio", "Monthly", "Fallback"],
    backtestDefaults: { start_date: "2024-01-01", end_date: "2024-12-31", initial_cash: "100000", dataset_id: "filter-synthetic" },
  },
  {
    id: "fallback",
    title: "Positive Momentum",
    description: "Pick the strongest assets with positive recent returns.",
    detail: "Each month, screen four funds by their 126-day return, choose the strongest two, and use TLT when fewer than two pass.",
    tags: ["Momentum", "Monthly", "Fallback"],
    backtestDefaults: { start_date: "2024-01-01", end_date: "2024-12-31", initial_cash: "100000", dataset_id: "filter-synthetic" },
  },
  {
    id: "cooldown",
    title: "Momentum with a Waiting Period",
    description: "After selling an asset, wait before buying it again.",
    detail: "Choose the stronger of QQQ and IEF each day. After an asset exits, it cannot return for 20 completed trading days.",
    tags: ["Daily", "Top 1", "20-day wait"],
    backtestDefaults: { start_date: "2024-01-01", end_date: "2024-02-29", initial_cash: "100000", dataset_id: "cooldown-synthetic" },
  },
];

export function findExample(id: string | null | undefined): StrategyExample | undefined {
  return STRATEGY_EXAMPLES.find((example) => example.id === id);
}
