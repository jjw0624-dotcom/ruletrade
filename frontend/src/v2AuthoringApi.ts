import { jsonBody, readApiErrorDetail } from "./apiError";
import type { CanonicalStrategyV2, V2AuthoringOperation } from "./domain/canonicalV2";

export interface V2AuthoringCapability {
  operation_id: string;
  label: string;
  available: boolean;
  reason: string | null;
}

export class V2AuthoringApiError extends Error {
  constructor(public readonly status: number, public readonly detail: { code: string; path?: string; message: string }) {
    super(detail.message);
  }
}

export const v2AuthoringApi = {
  async capabilities(fetcher: typeof fetch = fetch): Promise<V2AuthoringCapability[]> {
    const response = await fetcher("/api/v2/canonical/authoring/capabilities");
    if (!response.ok) throw new Error(`Capability discovery failed (${response.status})`);
    return await response.json() as V2AuthoringCapability[];
  },

  async apply(
    strategy: CanonicalStrategyV2,
    expectedSourceHash: string,
    operation: V2AuthoringOperation,
    fetcher: typeof fetch = fetch,
  ): Promise<{ strategy: CanonicalStrategyV2; source_hash: string }> {
    const response = await fetcher("/api/v2/canonical/authoring/apply", jsonBody("POST", {
      strategy,
      expected_source_hash: expectedSourceHash,
      operation,
    }));
    if (!response.ok) {
      const detail = await readApiErrorDetail(response, `v2 authoring failed (${response.status})`) as { code: string; path?: string; message: string };
      throw new V2AuthoringApiError(response.status, detail);
    }
    return await response.json() as { strategy: CanonicalStrategyV2; source_hash: string };
  },
};
