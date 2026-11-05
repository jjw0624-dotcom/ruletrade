import type { CanonicalStrategyV2 } from "./canonicalV2";

export type BuilderConflictClassification = "compatible_semantic_change" | "direct_conflict";

export interface BuilderRevisionConflictAnalysis {
  classification: BuilderConflictClassification;
  conflictPaths: string[];
  localChangePaths: string[];
  remoteChangePaths: string[];
  merged: CanonicalStrategyV2 | null;
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const identity = (value: unknown): string | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const key = record.semantic_id ?? record.id;
  return typeof key === "string" ? key : null;
};

interface MergeResult { value: unknown; local: string[]; remote: string[]; conflicts: string[] }

function mergeValue(base: unknown, local: unknown, remote: unknown, path: string): MergeResult {
  if (same(local, base)) return { value: remote, local: [], remote: same(remote, base) ? [] : [path], conflicts: [] };
  if (same(remote, base)) return { value: local, local: [path], remote: [], conflicts: [] };
  if (same(local, remote)) return { value: local, local: [path], remote: [path], conflicts: [] };

  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    const identifiable = [...base, ...local, ...remote].every((item) => identity(item) !== null);
    if (!identifiable) return { value: remote, local: [path], remote: [path], conflicts: [path] };
    const baseMap = new Map(base.map((item) => [identity(item)!, item]));
    const localMap = new Map(local.map((item) => [identity(item)!, item]));
    const remoteMap = new Map(remote.map((item) => [identity(item)!, item]));
    const orderedIds = [...new Set([...remoteMap.keys(), ...localMap.keys(), ...baseMap.keys()])];
    const values: unknown[] = []; const localPaths: string[] = []; const remotePaths: string[] = []; const conflicts: string[] = [];
    for (const id of orderedIds) {
      const childPath = `${path}/${id}`;
      const child = mergeValue(baseMap.get(id), localMap.get(id), remoteMap.get(id), childPath);
      localPaths.push(...child.local); remotePaths.push(...child.remote); conflicts.push(...child.conflicts);
      if (child.value !== undefined) values.push(child.value);
    }
    return { value: values, local: localPaths, remote: remotePaths, conflicts };
  }

  if (base && local && remote && typeof base === "object" && typeof local === "object" && typeof remote === "object"
    && !Array.isArray(base) && !Array.isArray(local) && !Array.isArray(remote)) {
    const baseRecord = base as Record<string, unknown>; const localRecord = local as Record<string, unknown>; const remoteRecord = remote as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(baseRecord), ...Object.keys(localRecord), ...Object.keys(remoteRecord)])].sort();
    const value: Record<string, unknown> = {}; const localPaths: string[] = []; const remotePaths: string[] = []; const conflicts: string[] = [];
    for (const key of keys) {
      const child = mergeValue(baseRecord[key], localRecord[key], remoteRecord[key], `${path}/${key}`);
      localPaths.push(...child.local); remotePaths.push(...child.remote); conflicts.push(...child.conflicts);
      if (child.value !== undefined) value[key] = child.value;
    }
    return { value, local: localPaths, remote: remotePaths, conflicts };
  }

  return { value: remote, local: [path], remote: [path], conflicts: [path] };
}

export function analyzeBuilderRevisionConflict(base: CanonicalStrategyV2, local: CanonicalStrategyV2, remote: CanonicalStrategyV2): BuilderRevisionConflictAnalysis {
  const result = mergeValue(base, local, remote, "strategy");
  const conflictPaths = [...new Set(result.conflicts)].sort();
  return {
    classification: conflictPaths.length ? "direct_conflict" : "compatible_semantic_change",
    conflictPaths,
    localChangePaths: [...new Set(result.local)].sort(),
    remoteChangePaths: [...new Set(result.remote)].sort(),
    merged: conflictPaths.length ? null : result.value as CanonicalStrategyV2,
  };
}
