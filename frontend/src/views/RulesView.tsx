import { useEffect, useRef, type ReactNode } from "react";
import type { StructuralAuthoringController } from "../hooks/useStructuralAuthoring";
import { projectConceptualFlow } from "../domain/conceptualFlow";
import { isBlankWorkspaceTarget, sameSemanticSelection, semanticSelection, type SemanticSelection } from "../domain/semanticSelection";
import { useStrategyEditor } from "../store/editorStore";
import { AssetMembershipEditor, AuthoringNumberInput, ScheduleControl, SleeveAllocationEditor } from "../components/AuthoringControls";
import { ChooseTransformationControl, CooldownConstructionControl, FallbackTransformationControl } from "../components/ShapeTransformationControls";

function Rule({ selection, children }: { selection: SemanticSelection; children: ReactNode }) {
  const { state, dispatch } = useStrategyEditor();
  const selected = sameSemanticSelection(selection, state.editor.selection) || (state.editor.selection?.role === "rule"
    && state.editor.selection.componentId === selection.componentId
    && (!state.editor.selection.fieldPath || state.editor.selection.fieldPath === selection.fieldPath));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (selected && state.editor.activeView === "rules") { ref.current?.scrollIntoView({ block: "nearest" }); ref.current?.querySelector<HTMLButtonElement>(".rule-select")?.focus({ preventScroll: true }); } }, [selected, state.editor.activeView]);
  return <div ref={ref} className={`human-rule${selected ? " selected" : ""}`} data-component-id={selection.componentId ?? undefined} data-field-path={selection.fieldPath ?? undefined}>
    <button className="rule-select" aria-pressed={selected} onClick={() => dispatch({ type: "select_semantic", selection })}>Inspect rule</button>{children}
  </div>;
}

export function RulesView({ structural }: { structural: StructuralAuthoringController }) {
  const { state, dispatch } = useStrategyEditor();
  const projection = projectConceptualFlow(state.canonical, state.registry);
  if (projection.unsupportedReason) return <div className="rules-representation"><h1>Rules</h1><p role="status">This Strategy cannot yet be stated as supported rules: {projection.unsupportedReason}</p></div>;
  const busy = structural.status === "applying";
  const caps = structural.capabilities;
  return <div className="rules-representation" onClick={(event) => { if (isBlankWorkspaceTarget(event.target)) dispatch({ type: "select_semantic", selection: null }); }}><header className="representation-intro"><span className="eyebrow">Rules</span><h1>In plain language</h1><p>Each editable value belongs to the selected Strategy component. Changes are checked by the backend.</p></header>
    {projection.groups.map((group) => {
      const choose = group.choose, groupId = group.id;
      const chooseTarget = !choose && group.allocationComponentId && caps?.choose_pipeline_targets.includes(group.allocationComponentId) ? group.allocationComponentId : null;
      const rank = choose?.rankComponentId;
      const canAddCondition = Boolean(rank && caps?.qualification_add_targets.includes(rank));
      const fallbackTarget = group.allocationComponentId && caps?.fallback_add_targets.includes(group.allocationComponentId) ? group.allocationComponentId : null;
      const cooldownTarget = choose?.selectionComponentId && caps?.cooldown_add_targets.includes(choose.selectionComponentId) ? choose.selectionComponentId : null;
      const thresholdId = choose?.filterComponentId;
      const thresholdEditable = thresholdId && caps?.qualification_threshold_targets.some((target) => target.component_id === thresholdId);
      const countEditable = choose && caps?.selection_count_targets.find((target) => target.component_id === choose.selectionComponentId);
      const lookbackEditable = choose?.lookbackComponentId && caps?.lookback_targets.some((target) => target.component_id === choose.lookbackComponentId);
      return <section className="rules-group" key={group.id}><h2>{group.label}{group.allocation ? ` · ${group.allocation}` : ""}</h2>
        {group.universeComponentId && <Rule selection={semanticSelection("universe", group.universeComponentId, { groupId })}><p>Consider {group.assets.join(", ")}.</p>{group.assetSetId && <AssetMembershipEditor authoring={structural} assetSetId={group.assetSetId} assets={group.assets} question="Assets in this rule" />}</Rule>}
        {chooseTarget && <div className="rule-add"><p>This investment path currently holds its assets directly.</p><ChooseTransformationControl busy={busy} error={structural.error} onApply={(lookback, count) => structural.apply({ kind: "transform_to_choose_assets", weight_component_id: chooseTarget, lookback_observations: lookback, count }, semanticSelection("selection", `${chooseTarget}_top_n`, { groupId }))} /></div>}
        {choose && <>
          {choose.lookbackComponentId && <Rule selection={semanticSelection("rule", choose.lookbackComponentId, { fieldPath: "config.lookback_bars", groupId })}><p>Measure each asset's trailing return over {lookbackEditable ? <AuthoringNumberInput ariaLabel="Return lookback observations" value={choose.lookbackBars!} minimum={1} disabled={busy} onCommit={(lookback_bars) => void structural.apply({ kind: "update_lookback", component_id: choose.lookbackComponentId!, lookback_bars })} /> : choose.lookbackBars} completed observations.</p></Rule>}
          {thresholdId ? <Rule selection={semanticSelection("qualification", thresholdId, { fieldPath: "config.threshold", groupId })}><p>Only keep assets whose return is above {thresholdEditable ? <AuthoringNumberInput ariaLabel="Qualification threshold percent" value={Number(choose.threshold) * 100} step={0.1} disabled={busy} onCommit={(value) => void structural.apply({ kind: "update_qualification_threshold", component_id: thresholdId, threshold: String(value / 100) })} /> : Number(choose.threshold) * 100}%.</p>{caps?.qualification_remove_targets.includes(thresholdId) && <button className="text-button danger" disabled={busy} onClick={() => void structural.apply({ kind: "remove_qualification_condition", condition_component_id: thresholdId }, semanticSelection("selection", choose.selectionComponentId, { groupId }))}>Remove condition</button>}</Rule>
            : canAddCondition && <div className="rule-add"><p>No qualification condition applies.</p><button className="secondary-button" disabled={busy} onClick={() => void structural.apply({ kind: "add_qualification_condition", rank_component_id: rank! }, semanticSelection("qualification", `${rank}_qualification`, { fieldPath: "config.threshold", groupId }))}>Add condition</button></div>}
          <Rule selection={semanticSelection("selection", choose.selectionComponentId, { fieldPath: "config.count", groupId })}><p>{choose.selectionMode === "random" ? "Randomly choose" : "Rank strongest first and choose"} {countEditable ? <AuthoringNumberInput ariaLabel="Number of assets chosen" value={choose.topN!} minimum={countEditable.minimum} maximum={countEditable.maximum ?? undefined} disabled={busy} onCommit={(count) => void structural.apply({ kind: "update_selection_count", component_id: choose.selectionComponentId, count })} /> : choose.topN} assets, then split this group's allocation equally.</p></Rule>
          {choose.cooldownComponentId && <Rule selection={semanticSelection("cooldown", choose.cooldownComponentId, { fieldPath: "config.duration", groupId })}><p>After an asset is sold, wait {caps?.cooldown_duration_targets.some((item) => item.component_id === choose.cooldownComponentId) ? <AuthoringNumberInput ariaLabel="Cooldown trading days" value={choose.cooldownDuration!} minimum={1} disabled={busy} onCommit={(duration) => void structural.apply({ kind: "update_cooldown_duration", component_id: choose.cooldownComponentId!, duration })} /> : choose.cooldownDuration} completed trading days before buying it again.</p>{caps?.cooldown_remove_targets.includes(choose.cooldownComponentId) && <button className="text-button danger" disabled={busy} onClick={() => void structural.apply({ kind: "remove_cooldown_from_selection", cooldown_component_id: choose.cooldownComponentId! }, semanticSelection("selection", choose.selectionComponentId, { groupId }))}>Remove waiting period</button>}</Rule>}
          {choose.fallbackComponentId && <Rule selection={semanticSelection("fallback", choose.fallbackComponentId, { groupId })}><p>If the selection is incomplete, {choose.otherwise}.</p>{caps?.fallback_remove_targets.includes(choose.fallbackComponentId) && <button className="text-button danger" disabled={busy} onClick={() => void structural.apply({ kind: "remove_fallback_selection", fallback_component_id: choose.fallbackComponentId! }, semanticSelection("selection", choose.selectionComponentId, { groupId }))}>Remove fallback</button>}</Rule>}
          {fallbackTarget && <FallbackTransformationControl busy={busy} error={structural.error} onApply={(asset) => structural.apply({ kind: "add_fallback_selection", weight_component_id: fallbackTarget, fallback_asset: asset }, semanticSelection("fallback", `${fallbackTarget}_fallback`, { groupId }))} />}
          {cooldownTarget && <CooldownConstructionControl busy={busy} error={structural.error} onApply={(duration) => structural.apply({ kind: "add_cooldown_to_selection", selection_component_id: cooldownTarget, duration }, semanticSelection("cooldown", `${cooldownTarget}_cooldown`, { fieldPath: "config.duration", groupId }))} />}
        </>}
        {group.scheduleComponentId && <Rule selection={semanticSelection("schedule", group.scheduleComponentId, { groupId })}><p>Check this investment path: {group.timing}.</p><ScheduleControl authoring={structural} label="Checking schedule" componentId={group.scheduleComponentId} /></Rule>}
      </section>;
    })}
    {projection.split && <section className="rules-group"><h2>Allocation</h2><Rule selection={semanticSelection("split", projection.portfolioComponentId ?? null)}><p>Divide the portfolio between the named groups.</p><SleeveAllocationEditor authoring={structural} groups={projection.split.groups} /></Rule></section>}
    {projection.rebalanceScheduleComponentId && <Rule selection={semanticSelection("schedule", projection.rebalanceScheduleComponentId)}><p>Rebalance the portfolio: {projection.rebalance}.</p><ScheduleControl authoring={structural} label="Portfolio rebalance" componentId={projection.rebalanceScheduleComponentId} /></Rule>}
    {structural.error && <p role="alert" className="structural-error">{structural.error.message}</p>}
  </div>;
}
