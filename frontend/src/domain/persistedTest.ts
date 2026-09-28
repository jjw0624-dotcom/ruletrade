import type { BacktestRunRecord } from "../backtestRunApi";
import type { SaveRevisionResponse } from "../strategyApi";
import type { BacktestConfig } from "./backtest";
import type { CanonicalStrategyV1 } from "./canonical";

export interface PersistedTestRequest {
  strategyId: string;
  baseRevisionId: string;
  canonical: CanonicalStrategyV1;
  dirty: boolean;
  config: BacktestConfig;
  save: (strategyId: string, parentRevisionId: string, canonical: CanonicalStrategyV1) => Promise<SaveRevisionResponse>;
  ready: (revisionId: string) => Promise<boolean>;
  onRunStart?: (revisionId: string) => void;
  createRun: (revisionId: string, config: BacktestConfig) => Promise<BacktestRunRecord>;
}

export async function createPersistedTest(request: PersistedTestRequest): Promise<{
  saved: SaveRevisionResponse | null;
  run: BacktestRunRecord | null;
}> {
  const saved = request.dirty
    ? await request.save(request.strategyId, request.baseRevisionId, request.canonical)
    : null;
  const revisionId = saved?.revision.id ?? request.baseRevisionId;
  if (!(await request.ready(revisionId))) return { saved, run: null };
  request.onRunStart?.(revisionId);
  return { saved, run: await request.createRun(revisionId, request.config) };
}
