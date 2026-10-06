import type { ConstructionOption } from "./builderProjection";
import { semanticSelection } from "./semanticSelection";
import type { StructuralAuthoringController } from "../hooks/useStructuralAuthoring";

export const SPLIT_SCAFFOLD_DEFAULTS = {
  growthAllocation: "0.5",
  defensiveAssets: ["IEF"] as string[],
} as const;

/**
 * The one production dispatch path for an advertised Flow Split.
 * Availability comes from growth_defensive_targets; execution uses the matching
 * backend-owned atomic operation so a click or drop can never create local-only
 * or incomplete portfolio state.
 */
export function dispatchSplitConstruction(
  option: ConstructionOption,
  structural: StructuralAuthoringController,
  growthAllocation: string = SPLIT_SCAFFOLD_DEFAULTS.growthAllocation,
  defensiveAssets: string[] = [...SPLIT_SCAFFOLD_DEFAULTS.defensiveAssets],
): Promise<boolean> {
  if (option.kind !== "split") return Promise.resolve(false);
  return structural.apply({
    kind: "transform_to_growth_defensive",
    target_component_id: option.targetComponentId,
    growth_allocation: growthAllocation,
    defensive_assets: defensiveAssets,
  }, semanticSelection("split", `${option.targetComponentId}_portfolio`));
}
