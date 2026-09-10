export interface ApiErrorDetail {
  code: string;
  message: string;
  [key: string]: unknown;
}

export async function readApiErrorDetail(
  response: Response,
  fallback: string,
): Promise<ApiErrorDetail> {
  let raw: unknown;
  try {
    raw = ((await response.json()) as { detail?: unknown }).detail;
  } catch {
    // The status and endpoint-specific fallback remain useful for non-JSON failures.
  }
  if (raw && typeof raw === "object") {
    const detail = raw as Record<string, unknown>;
    return {
      ...detail,
      code: typeof detail.code === "string" ? detail.code : "request_failed",
      message: typeof detail.message === "string" ? detail.message : fallback,
    };
  }
  return {
    code: "request_failed",
    message: typeof raw === "string" ? raw : fallback,
  };
}

export const jsonBody = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
