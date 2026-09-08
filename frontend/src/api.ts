import type { CanonicalStrategyV1, EditorBootstrap, ValidationIssue } from "./domain/canonical";
import {
  DEFAULT_BACKTEST_CONFIG,
  type BacktestApiError,
  type BacktestConfig,
  type LeanBacktestResponse,
} from "./domain/backtest";

export class LeanBacktestApiError extends Error {
  constructor(public readonly detail: BacktestApiError) {
    super(detail.message);
  }
}

export async function loadEditorBootstrap(): Promise<EditorBootstrap> {
  const response = await fetch("/api/v1/editor/bootstrap?example=fallback");
  if (!response.ok) throw new Error(`Editor bootstrap failed (${response.status})`);
  return (await response.json()) as EditorBootstrap;
}

export async function validateCanonical(
  strategy: CanonicalStrategyV1,
): Promise<{ valid: boolean; issues: ValidationIssue[] }> {
  const response = await fetch("/api/v1/canonical/strategies/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(strategy),
  });
  if (response.ok) return { valid: true, issues: [] };
  const payload = (await response.json()) as { detail?: ValidationIssue[] | string };
  if (Array.isArray(payload.detail)) return { valid: false, issues: payload.detail };
  return {
    valid: false,
    issues: [{ path: "strategy", message: String(payload.detail ?? `Validation failed (${response.status})`) }],
  };
}

export async function runLeanBacktest(
  strategy: CanonicalStrategyV1,
  config: BacktestConfig = DEFAULT_BACKTEST_CONFIG,
  fetcher: typeof fetch = fetch,
): Promise<LeanBacktestResponse> {
  const response = await fetcher("/api/v1/backtests/lean", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ strategy, config }),
  });
  if (response.ok) return (await response.json()) as LeanBacktestResponse;
  const payload = (await response.json()) as {
    detail?: BacktestApiError | string;
  };
  const detail = payload.detail;
  if (detail && typeof detail === "object" && "code" in detail) {
    throw new LeanBacktestApiError(detail);
  }
  throw new LeanBacktestApiError({
    code: "request_failed",
    message: typeof detail === "string" ? detail : `Backtest failed (${response.status})`,
  });
}
