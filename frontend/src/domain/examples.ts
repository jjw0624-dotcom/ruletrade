import type { BacktestConfig } from "./backtest";

export type ExampleId = "sleeves" | "fallback" | "cooldown" | "one_investment" | "filter" | "golden";
export type StartingKind = "example" | "structure";

export interface StrategyExample {
  id: ExampleId;
  kind: StartingKind;
  title: string;
  question: string;
  description: string;
  detail: string;
  tags: string[];
  initialView: "overview" | "guided";
  backtestDefaults: BacktestConfig;
}

const filterDefaults: BacktestConfig = { start_date: "2024-01-01", end_date: "2024-12-31", initial_cash: "100000", dataset_id: "filter-synthetic" };

export const STRATEGY_EXAMPLES: StrategyExample[] = [
  { id: "fallback", kind: "example", title: "Strongest ETFs", question: "What if I bought the strongest ETFs each month?", description: "Choose the strongest assets with positive recent returns.", detail: "Each month, four funds qualify by their 126-day return. The strongest two are chosen, with TLT used when too few qualify.", tags: ["Strongest", "Monthly", "Fallback"], initialView: "overview", backtestDefaults: filterDefaults },
  { id: "sleeves", kind: "example", title: "Growth + Defensive", question: "What if I only bought rising ETFs, and used bonds otherwise?", description: "Use recent strength for Growth and keep a defensive allocation alongside it.", detail: "Growth chooses from four technology funds and can use TLT. Defensive holds TLT and IEF equally.", tags: ["Two-part portfolio", "Monthly", "Fallback"], initialView: "overview", backtestDefaults: filterDefaults },
  { id: "cooldown", kind: "example", title: "Waiting period", question: "What if I waited before buying an asset again?", description: "After selling an asset, wait before buying it again.", detail: "Choose the stronger of QQQ and IEF each day, then wait 20 completed trading days before a sold asset can return.", tags: ["Daily", "Strongest 1", "20-day wait"], initialView: "overview", backtestDefaults: { start_date: "2024-01-01", end_date: "2024-02-29", initial_cash: "100000", dataset_id: "cooldown-synthetic" } },
];

export const STRATEGY_STRUCTURES: StrategyExample[] = [
  { id: "one_investment", kind: "structure", title: "One investment", question: "Start with one investment", description: "Invest in QQQ and check the allocation monthly.", detail: "A small, valid strategy intended for changing the asset and schedule in Guide.", tags: ["QQQ", "Monthly", "100%"], initialView: "guided", backtestDefaults: filterDefaults },
  { id: "filter", kind: "structure", title: "Choose assets", question: "Start by choosing assets", description: "Qualify assets by recent returns and choose the strongest.", detail: "Four editable assets, a positive 126-day return check, strongest-first ranking, and Top 2 selection.", tags: ["Qualify", "Choose", "Monthly"], initialView: "guided", backtestDefaults: filterDefaults },
  { id: "golden", kind: "structure", title: "Split a portfolio", question: "Start with a split portfolio", description: "Split the portfolio between Growth and Safety.", detail: "Growth and Safety are existing supported sleeves with a simple 70 / 30 allocation.", tags: ["Split", "Growth", "Safety"], initialView: "guided", backtestDefaults: filterDefaults },
];

export const ALL_STARTING_POINTS = [...STRATEGY_EXAMPLES, ...STRATEGY_STRUCTURES];

export function findExample(id: string | null | undefined): StrategyExample | undefined {
  return ALL_STARTING_POINTS.find((example) => example.id === id);
}
