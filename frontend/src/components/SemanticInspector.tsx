import type { ReactNode } from "react";

import type { ConceptualFlowProjection, ConceptualGroup } from "../domain/conceptualFlow";
import { semanticSelection } from "../domain/semanticSelection";
import type { StructuralAuthoringController } from "../hooks/useStructuralAuthoring";
import { useStrategyEditor } from "../store/editorStore";
import { AssetMembershipEditor, LookbackControl, ScheduleControl, SleeveAllocationEditor } from "./AuthoringControls";
import {
  ChooseTransformationControl,
  FallbackTransformationControl,
  GrowthDefensiveTransformationControl,
} from "./ShapeTransformationControls";
import { GroupRenameControl } from "./StructuralAuthoringControls";

function groupFor(
  projection: ConceptualFlowProjection,
  componentId: string | null,
  groupId: string | null,
): ConceptualGroup | undefined {
  return projection.groups.find((group) => group.id === groupId
    || group.sourceComponentIds.includes(componentId ?? "")
    || group.choose?.sourceComponentIds.includes(componentId ?? ""));
}

export function SemanticInspector({
  projection,
  structural,
  evidence,
}: {
  projection: ConceptualFlowProjection;
  structural: StructuralAuthoringController;
  evidence?: ReactNode;
}) {
  const { state, dispatch } = useStrategyEditor();
  const selection = state.editor.selection;
  if (!selection) return null;
  const group = groupFor(projection, selection.componentId, selection.groupId);
  const choose = group?.choose;
  const role = selection.role === "rule"
    ? selection.componentId === choose?.filterComponentId ? "qualification"
      : selection.componentId === choose?.selectionComponentId || selection.componentId === choose?.lookbackComponentId ? "selection"
      : selection.componentId === group?.universeComponentId ? "universe"
      : selection.componentId === group?.scheduleComponentId || selection.componentId === projection.rebalanceScheduleComponentId ? "schedule"
      : selection.role
    : selection.role;
  const busy = structural.status === "applying";
  const close = () => dispatch({ type: "select_semantic", selection: null });

  let content: ReactNode;
  if (role === "portfolio") {
    const chooseTarget = structural.capabilities?.choose_pipeline_targets[0];
    const splitTarget = structural.capabilities?.growth_defensive_targets[0];
    content = <>
      <h2>{projection.title}</h2>
      <p>Money can go to {projection.groups.map((item) => item.label).join(" and ")}.</p>
      {chooseTarget && <ChooseTransformationControl busy={busy} error={structural.error} onApply={(lookback, count) => structural.apply({
        kind: "transform_to_choose_assets",
        weight_component_id: chooseTarget,
        lookback_observations: lookback,
        count,
      }, semanticSelection("selection", `${chooseTarget}_top_n`, { groupId: projection.groups[0]?.id }))} />}
      {splitTarget && <GrowthDefensiveTransformationControl busy={busy} error={structural.error} onApply={(allocation, assets) => structural.apply({
        kind: "transform_to_growth_defensive",
        target_component_id: splitTarget,
        growth_allocation: allocation,
        defensive_assets: assets,
      }, semanticSelection("split", `${splitTarget}_portfolio`))} />}
    </>;
  } else if (role === "split" && projection.split) {
    content = <><h2>Portfolio split</h2><SleeveAllocationEditor groups={projection.split.groups} /></>;
  } else if (role === "group" && group) {
    content = <>
      {group.sleeveComponentId
        ? <GroupRenameControl componentId={group.sleeveComponentId} name={group.label} capabilities={structural.capabilities} busy={busy} error={structural.error} onRename={(name) => structural.apply({ kind: "rename_group", group_component_id: group.sleeveComponentId!, name }, semanticSelection("group", group.sleeveComponentId!, { groupId: group.id }))} />
        : <h2>{group.label}</h2>}
      <p>{group.allocation ? `${group.allocation} of the portfolio` : "The current investment path"}</p>
    </>;
  } else if (role === "universe" && group?.assetSetId) {
    content = <><h2>{group.label} assets</h2><AssetMembershipEditor question="What can it invest in?" assetSetId={group.assetSetId} assets={group.assets} /></>;
  } else if (role === "selection" && choose && group) {
    const qualificationTarget = choose.rankComponentId
      && structural.capabilities?.qualification_add_targets.includes(choose.rankComponentId)
      ? choose.rankComponentId : null;
    const fallbackTarget = group.allocationComponentId
      && structural.capabilities?.fallback_add_targets.includes(group.allocationComponentId)
      ? group.allocationComponentId : null;
    content = <>
      <h2>{choose.label}</h2>
      {choose.lookbackComponentId && <LookbackControl id="inspector-lookback" componentId={choose.lookbackComponentId} value={choose.lookbackBars!} />}
      {choose.selectionMode === "ranked"
        ? <p className="fixed-setting">Strongest return first</p>
        : <label>Choose again<select value={choose.resample} onChange={(event) => dispatch({ type: "apply_semantic_patch", operation: { kind: "update_component_config", componentId: choose.selectionComponentId, field: "resample", value: event.target.value } })}><option value="per_event">Each check</option><option value="once">Keep first choice</option></select></label>}
      <label>How many?<input type="number" min={1} value={choose.topN} onChange={(event) => dispatch({ type: "apply_semantic_patch", operation: { kind: "update_component_config", componentId: choose.selectionComponentId, field: "count", value: Number(event.target.value) } })} /></label>
      {qualificationTarget && <button className="secondary-button" disabled={busy} onClick={() => void structural.apply({ kind: "add_qualification_condition", rank_component_id: qualificationTarget }, semanticSelection("qualification", `${qualificationTarget}_qualification`, { fieldPath: "config.threshold", groupId: group.id }))}>+ Add qualification</button>}
      {fallbackTarget && <FallbackTransformationControl busy={busy} error={structural.error} onApply={(asset) => structural.apply({ kind: "add_fallback_selection", weight_component_id: fallbackTarget, fallback_asset: asset }, semanticSelection("fallback", `${fallbackTarget}_fallback`, { groupId: group.id }))} />}
    </>;
  } else if (role === "qualification" && choose?.filterComponentId && group) {
    const removable = structural.capabilities?.qualification_remove_targets.includes(choose.filterComponentId);
    content = <>
      <h2>Qualification</h2>
      <p className="fixed-setting">Return is greater than</p>
      <label>Threshold<span className="percent-field"><input aria-label="Return threshold percent" type="number" step="0.1" value={Number(choose.threshold) * 100} onChange={(event) => dispatch({ type: "apply_semantic_patch", operation: { kind: "update_component_config", componentId: choose.filterComponentId!, field: "threshold", value: String(Number(event.target.value) / 100) } })} />%</span></label>
      {choose.lookbackComponentId && <LookbackControl id="qualification-lookback" componentId={choose.lookbackComponentId} value={choose.lookbackBars!} />}
      {removable && <button className="text-button danger" disabled={busy} onClick={() => void structural.apply({ kind: "remove_qualification_condition", condition_component_id: choose.filterComponentId! }, semanticSelection("selection", choose.selectionComponentId, { groupId: group.id }))}>Remove qualification</button>}
    </>;
  } else if (role === "fallback" && choose?.fallbackComponentId && group) {
    const removable = structural.capabilities?.fallback_remove_targets.includes(choose.fallbackComponentId);
    content = <>
      <h2>Fallback</h2>
      <label>When selection is incomplete<select value={choose.fallbackAssetSetRef} onChange={(event) => dispatch({ type: "apply_semantic_patch", operation: { kind: "update_component_config", componentId: choose.fallbackComponentId!, field: "fallback_asset_set_ref", value: event.target.value } })}>{choose.fallbackOptions.map((option) => <option key={option.id} value={option.id}>Use {option.asset}</option>)}</select></label>
      {removable && <button className="text-button danger" disabled={busy} onClick={() => void structural.apply({ kind: "remove_fallback_selection", fallback_component_id: choose.fallbackComponentId! }, semanticSelection("selection", choose.selectionComponentId, { groupId: group.id }))}>Remove fallback</button>}
    </>;
  } else if (role === "schedule" && selection.componentId) {
    content = <><h2>Rebalance schedule</h2><ScheduleControl label="When should it check?" componentId={selection.componentId} value={projection.rebalance ?? "Monthly"} /></>;
  } else {
    content = <><h2>Strategy rule</h2><p>This semantic component remains selected across Strategy representations.</p></>;
  }

  return <aside className="semantic-inspector" aria-label="Semantic Inspector">
    <header><span className="eyebrow">Inspector</span><button aria-label="Close Inspector" onClick={close}>×</button></header>
    <div className="semantic-inspector-content">{content}{structural.error && <p className="structural-error" role="alert">{structural.error.message}</p>}{evidence}</div>
  </aside>;
}
