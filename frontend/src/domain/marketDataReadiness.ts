import type { BacktestConfig } from "./backtest";
import type {
  MarketDataPreflight,
  MarketDataReason,
} from "../marketDataApi";

export type DataReadiness =
  | { status: "not_checked" }
  | { status: "checking"; key: string }
  | { status: "available" | "partial" | "unavailable"; key: string; result: MarketDataPreflight }
  | { status: "error"; key: string; message: string };

export const NOT_CHECKED: DataReadiness = { status: "not_checked" };

export function dataReadinessKey(
  revisionId: string,
  config: BacktestConfig,
): string {
  return JSON.stringify([revisionId, config]);
}

export function freshDataReadiness(
  readiness: DataReadiness,
  key: string | null,
): DataReadiness {
  if (key === null || readiness.status === "not_checked") return NOT_CHECKED;
  return readiness.key === key ? readiness : NOT_CHECKED;
}

export function readinessFromResult(
  key: string,
  result: MarketDataPreflight,
): DataReadiness {
  return { status: result.overall, key, result };
}

export function canLaunchPersistedRealDataRun(
  readiness: DataReadiness,
  key: string,
): boolean {
  const fresh = freshDataReadiness(readiness, key);
  return fresh.status === "available";
}

export function marketDataReasonMessage(reason: MarketDataReason): string {
  switch (reason) {
    case "available":
      return "Ready";
    case "provider_unavailable":
      return "Historical market data isn't available right now.";
    case "no_data":
      return "Required market history is unavailable.";
    case "security_master_missing":
      return "Complete historical data for this asset isn't available.";
    case "insufficient_history":
      return "This strategy needs earlier market history before the test can begin.";
    case "requested_period_unavailable":
      return "Historical data doesn't cover the full test period.";
    case "corrupt_cache":
      return "Historical data for this asset couldn't be read.";
  }
}
