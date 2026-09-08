import type { CanonicalStrategyV1, EditorBootstrap, ValidationIssue } from "./domain/canonical";

export async function loadEditorBootstrap(): Promise<EditorBootstrap> {
  const response = await fetch("/api/v1/editor/bootstrap");
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
