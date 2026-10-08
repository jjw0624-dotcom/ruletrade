import type { CanonicalStrategyV2, ConditionV2, DailyValueNode, ProgramStatementV2, V2AuthoringOperation } from "./canonicalV2";
import type { StructuralAuthoringOperation } from "../structuralAuthoringApi";

/** The Builder's public editing grammar. Neither canonical version leaks through this boundary. */
export type BuilderProductOperation =
  | { kind: "addInvestment"; investmentId: string; name: string; assetSetId: string; assets: string[] }
  | { kind: "setAssets"; assets: string[] }
  | { kind: "setQualification"; lookback: number; operator: "gt" | "gte" | "lt" | "lte"; threshold: number }
  | { kind: "setSelection"; lookback: number; direction: "highest" | "lowest"; take: number; shortage: "choose_all" | "require_full" }
  | { kind: "setFallback"; asset: string | null }
  | { kind: "setAllocation"; method: "equal" | "fixed"; investments?: Array<{ id: string; weight: number }> }
  | { kind: "setRebalance"; cadence: "daily" | "weekly" | "monthly" };

export interface V1ProductAddress {
  assetSetId?: string; rankComponentId?: string; selectionComponentId?: string;
  qualificationComponentId?: string; weightComponentId?: string; fallbackComponentId?: string;
  fallbackAssetSetId?: string; scheduleComponentId?: string; allocationComponents?: Array<{ component_id: string; allocation: string }>;
}

export function adaptV1ProductOperation(operation: BuilderProductOperation, address: V1ProductAddress): StructuralAuthoringOperation[] {
  switch (operation.kind) {
    case "setAssets": return address.assetSetId ? [{ kind: "update_asset_set", asset_set_id: address.assetSetId, assets: operation.assets }] : [];
    case "setQualification":
      if (address.qualificationComponentId) return [{ kind: "update_qualification_threshold", component_id: address.qualificationComponentId, threshold: String(operation.threshold) }];
      return address.rankComponentId ? [{ kind: "add_qualification_condition", rank_component_id: address.rankComponentId, threshold: String(operation.threshold) }] : [];
    case "setSelection": return address.rankComponentId && address.selectionComponentId ? [{
      kind: "update_selection_semantics", rank_component_id: address.rankComponentId, selection_component_id: address.selectionComponentId,
      direction: operation.direction === "highest" ? "descending" : "ascending", count: operation.take, shortage_policy: operation.shortage,
      value_expression: { kind: "indicator", indicator_id: "trailing_return_indicator@1", asset: { kind: "candidate" }, parameters: { lookback_bars: operation.lookback } },
    }] : address.weightComponentId ? [{ kind: "transform_to_choose_assets", weight_component_id: address.weightComponentId, lookback_observations: operation.lookback, count: operation.take }] : [];
    case "setFallback":
      if (address.fallbackComponentId && address.fallbackAssetSetId) return [{ kind: "update_fallback_asset_set", component_id: address.fallbackComponentId, asset_set_id: address.fallbackAssetSetId }];
      return operation.asset && address.weightComponentId ? [{ kind: "add_fallback_selection", weight_component_id: address.weightComponentId, fallback_asset: operation.asset }] : [];
    case "setAllocation": return address.allocationComponents ? [{ kind: "update_sleeve_allocations", allocations: address.allocationComponents }] : [];
    case "setRebalance": return address.scheduleComponentId && operation.cadence !== "weekly" ? [{ kind: "update_schedule", component_id: address.scheduleComponentId, cadence: operation.cadence }] : [];
    case "addInvestment": return [];
  }
}

export interface V2ProductAddress { investmentId?: string; assetSetId?: string; selectionId?: string; clockId?: string }

function candidateReturn(prefix: string, bindingId: string, lookback: number): DailyValueNode {
  const close: DailyValueNode = { semantic_id: `${prefix}-close`, kind: "observe", operands: [], subject_kind: "candidate", subject_id: null, binding_id: bindingId, field: "close", basis: "adjusted", skip: 0, missing_policy: "require_all", minimum_count: 1, minimum_fraction: 1 };
  return { semantic_id: `${prefix}-return`, kind: "trailing_return", operands: [close], observations: lookback, skip: 0, missing_policy: "require_all", minimum_count: 1, minimum_fraction: 1 };
}

function qualification(prefix: string, bindingId: string, operation: Extract<BuilderProductOperation, { kind: "setQualification" }>): ConditionV2 {
  return { kind: "comparison", semantic_id: `${prefix}-qualification`, operator: operation.operator,
    left: candidateReturn(`${prefix}-qualification`, bindingId, operation.lookback),
    right: { semantic_id: `${prefix}-threshold`, kind: "literal", operands: [], quantity: "return", unit: "ratio", refinement: "trailing_return:adjusted_close", value: operation.threshold, skip: 0, missing_policy: "require_all", minimum_count: 1, minimum_fraction: 1 },
  };
}

export function adaptV2ProductOperation(strategy: CanonicalStrategyV2, operation: BuilderProductOperation, address: V2ProductAddress): V2AuthoringOperation[] {
  const selection = strategy.program?.statements.find((item) => item.kind === "select" && (!address.selectionId || item.semantic_id === address.selectionId));
  switch (operation.kind) {
    case "addInvestment": return [{ kind: "add_program_investment", investment_id: operation.investmentId, name: operation.name, asset_set_id: operation.assetSetId, assets: operation.assets }];
    case "setAssets": return address.assetSetId ? [{ kind: "set_program_asset_set", asset_set_id: address.assetSetId, assets: operation.assets }] : [];
    case "setQualification": return selection?.kind === "select" ? [{ kind: "set_program_condition", semantic_id: selection.semantic_id, role: "selection_eligibility", condition: qualification(selection.semantic_id, selection.selection.binding.id, operation) }] : [];
    case "setSelection": {
      if (!address.investmentId || !strategy.program) return [];
      const id = address.selectionId ?? `selection-${address.investmentId}`;
      const binding = `${id}-candidate`;
      const next = { kind: "select", semantic_id: id, output_id: `${id}-output`, clock_id: address.clockId ?? strategy.program.clocks[0]!.id,
        selection: { semantic_id: `${id}-definition`, universe_id: address.investmentId, binding: { id: binding, domain_id: address.investmentId }, eligibility: selection?.kind === "select" ? selection.selection.eligibility : null, ranking: candidateReturn(id, binding, operation.lookback), direction: operation.direction === "highest" ? "descending" : "ascending", count: operation.take, shortage_policy: operation.shortage, fallback_asset: selection?.kind === "select" ? selection.selection.fallback_asset : null } } satisfies Extract<ProgramStatementV2, { kind: "select" }>;
      if (selection?.kind === "select") return [{ kind: "set_program_selection", semantic_id: selection.semantic_id, selection: next.selection }];
      const allocationId = `allocation-${id}`;
      const allocation: ProgramStatementV2 = { kind: "allocate", semantic_id: allocationId, method: "equal", legs: [{ semantic_id: `${allocationId}-leg`, target: { semantic_id: `${allocationId}-target`, kind: "selection", ref: next.output_id }, weight: null }], clock_id: next.clock_id, minimum_weight: null, maximum_weight: null, cash_remainder_asset: null };
      return [{ kind: "set_semantic_program", program: { ...strategy.program, statements: [...strategy.program.statements, next, allocation] } }];
    }
    case "setFallback": return selection?.kind === "select" ? [{ kind: "set_program_selection", semantic_id: selection.semantic_id, selection: { ...selection.selection, fallback_asset: operation.asset } }] : [];
    case "setAllocation": {
      if (!strategy.program) return [];
      const split = operation.investments && operation.investments.length > 1;
      if (!split && selection?.kind !== "select") return [];
      const id = split ? "portfolio-split" : `allocation-${selection!.semantic_id}`;
      const allocation: ProgramStatementV2 = { kind: "allocate", semantic_id: id, method: split ? "fixed" : "equal", legs: split
        ? operation.investments!.map((investment, index) => ({ semantic_id: `${id}-leg-${index + 1}`, target: { semantic_id: `${id}-target-${index + 1}`, kind: "group" as const, ref: investment.id }, weight: investment.weight }))
        : [{ semantic_id: `${id}-leg`, target: { semantic_id: `${id}-target`, kind: "selection", ref: (selection as Extract<ProgramStatementV2, { kind: "select" }>).output_id }, weight: null }], clock_id: address.clockId ?? strategy.program.clocks[0]!.id, minimum_weight: null, maximum_weight: null, cash_remainder_asset: null };
      return [{ kind: "set_semantic_program", program: { ...strategy.program, statements: [...strategy.program.statements, allocation] } }];
    }
    case "setRebalance": return [{ kind: "set_program_schedule", clock_id: address.clockId ?? strategy.program?.clocks[0]?.id ?? "daily-close", timeframe: operation.cadence }];
  }
}
