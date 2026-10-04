import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { ConditionExpression } from "../domain/canonical";
import type { ConceptualFlowProjection, ConceptualGroup } from "../domain/conceptualFlow";
import { semanticSelection } from "../domain/semanticSelection";
import { describeUniverse, describeValueExpression } from "../domain/valueSemantics";
import type { StructuralAuthoringController } from "../hooks/useStructuralAuthoring";
import { useStrategyEditor } from "../store/editorStore";
import { AssetMembershipEditor, AuthoringNumberInput, CooldownControl, LookbackControl, ScheduleControl, SleeveAllocationEditor } from "./AuthoringControls";
import {
  FallbackTransformationControl,
} from "./ShapeTransformationControls";
import { GroupRenameControl } from "./StructuralAuthoringControls";
import { ConditionComposer } from "./ConditionComposer";
import { SelectionComposer } from "./SelectionComposer";

function groupFor(
  projection: ConceptualFlowProjection,
  componentId: string | null,
  groupId: string | null,
): ConceptualGroup | undefined {
  return projection.groups.find((group) => group.id === groupId
    || group.sourceComponentIds.includes(componentId ?? "")
    || group.choose?.sourceComponentIds.includes(componentId ?? ""));
}

function legacyEligibility(lookback: number, threshold: number): ConditionExpression {
  return {
    kind: "comparison",
    operator: "gt",
    left: {
      kind: "indicator",
      indicator_id: "trailing_return_indicator@1",
      asset: { kind: "candidate" },
      parameters: { lookback_bars: lookback },
    },
    right: { kind: "literal", value_type: "percentage", value: threshold },
  };
}

function ConditionInspectorControl({
  componentId,
  role,
  initial,
  lookback,
  structural,
  removable,
  returnSelection,
}: {
  componentId: string;
  role: "predicate" | "eligibility";
  initial: ConditionExpression;
  lookback: number;
  structural: StructuralAuthoringController;
  removable?: boolean;
  returnSelection?: ReturnType<typeof semanticSelection>;
}) {
  const { state } = useStrategyEditor();
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [componentId, initial]);
  const apply = () => void structural.apply(
    { kind: "update_condition_expression", component_id: componentId, role, condition: draft },
    semanticSelection(role === "predicate" ? "rule" : "qualification", componentId, { fieldPath: "condition" }),
  );
  return <div className="predicate-inspector">
    <ConditionComposer
      role={role}
      expression={draft}
      strategy={state.canonical}
      capabilities={structural.capabilities?.value_capabilities}
      defaultLookback={lookback}
      disabled={structural.status === "applying"}
      onChange={setDraft}
    />
    <button type="button" className="secondary-button" disabled={structural.status === "applying"} onClick={apply}>Apply condition</button>
    {removable && <button type="button" className="text-button danger" disabled={structural.status === "applying"} onClick={() => void structural.apply(
      role === "predicate"
        ? { kind: "remove_predicate", component_id: componentId }
        : { kind: "remove_qualification_condition", condition_component_id: componentId },
      returnSelection ?? semanticSelection("rule", componentId),
    )}>Remove condition</button>}
  </div>;
}

function PredicateInspectorControl({ componentId, structural }: { componentId: string; structural: StructuralAuthoringController }) {
  const { state } = useStrategyEditor();
  const component = state.canonical.graph.components.find((item) => item.id === componentId);
  if (!component?.condition) return <p className="fixed-setting">This control predicate is not editable in Predicate v1.</p>;
  const left = component.condition.kind === "comparison" && component.condition.left.kind === "indicator"
    ? component.condition.left : null;
  return <ConditionInspectorControl
    componentId={componentId}
    role="predicate"
    initial={component.condition}
    lookback={Number(left?.parameters.lookback_bars ?? 126)}
    structural={structural}
    removable
  />;
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
  const selectedDraftId = state.editor.logicDraft.selectedDraftId;
  if (!selection && !selectedDraftId) return null;
  if (!selection && selectedDraftId) {
    const draft = state.editor.logicDraft.workingProgram?.blocks.find((item) => item.workingId === selectedDraftId);
    const label = draft?.blockType === "rt_draft_if_else" ? "If / Otherwise" : "If";
    return <aside className="semantic-inspector" aria-label="Semantic Inspector">
      <header><span className="eyebrow">Inspector</span><button aria-label="Close Inspector" onClick={() => dispatch({ type: "select_logic_draft", draftId: null })}>×</button></header>
      <div className="semantic-inspector-content">
        <h2>{label}</h2>
        <p className="fixed-setting">Unfinished control structure in this Blocky working program.</p>
        {draft?.summary && <p>Predicate: {draft.summary}</p>}
        <button className="text-button danger" onClick={() => dispatch({ type: "request_remove_logic_draft", draftId: selectedDraftId })}>Discard unfinished control</button>
      </div>
    </aside>;
  }
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
    content = <>
      <h2>{projection.title}</h2>
      <p>Money can go to {projection.groups.map((item) => item.label).join(" and ")}.</p>
      <p className="fixed-setting">Select a semantic object for local properties. Guided recipes live in Guide; primitive construction lives in Add.</p>
    </>;
  } else if (role === "split" && projection.split) {
    content = <><h2>Portfolio split</h2><SleeveAllocationEditor authoring={structural} groups={projection.split.groups} /></>;
  } else if (role === "group" && group) {
    content = <>
      {group.sleeveComponentId
        ? <GroupRenameControl componentId={group.sleeveComponentId} name={group.label} capabilities={structural.capabilities} busy={busy} error={structural.error} onRename={(name) => structural.apply({ kind: "rename_group", group_component_id: group.sleeveComponentId!, name }, semanticSelection("group", group.sleeveComponentId!, { groupId: group.id }))} />
        : <h2>{group.label}</h2>}
      <p>{group.allocation ? `${group.allocation} of the portfolio` : "The current investment path"}</p>
    </>;
  } else if (role === "universe" && group?.assetSetId) {
    const semanticUniverse = group.universeComponentId
      ? describeUniverse(state.canonical, group.universeComponentId) : null;
    content = <><h2>{group.label} assets</h2>{semanticUniverse && <p className="fixed-setting">{semanticUniverse}</p>}<AssetMembershipEditor authoring={structural} question="What can it invest in?" assetSetId={group.assetSetId} assets={group.assets} /></>;
  } else if (role === "selection" && choose && group) {
    const qualificationTarget = choose.rankComponentId
      && structural.capabilities?.qualification_add_targets.includes(choose.rankComponentId)
      ? choose.rankComponentId : null;
    const fallbackTarget = group.allocationComponentId
      && structural.capabilities?.fallback_add_targets.includes(group.allocationComponentId)
      ? group.allocationComponentId : null;
    const countCapability = structural.capabilities?.selection_count_targets.find((item) => item.component_id === choose.selectionComponentId);
    const resampleCapability = structural.capabilities?.selection_resample_targets.find((item) => item.component_id === choose.selectionComponentId);
    const rankComponent = choose.rankComponentId
      ? state.canonical.graph.components.find((item) => item.id === choose.rankComponentId) : undefined;
    const selectionComponent = state.canonical.graph.components.find((item) => item.id === choose.selectionComponentId);
    const universeCapability = structural.capabilities?.universe_targets?.find((item) => item.component_id === group.universeComponentId);
    const eligibilityComponent = choose.filterComponentId
      ? state.canonical.graph.components.find((item) => item.id === choose.filterComponentId) : undefined;
    const rankingValue = rankComponent?.value_expression ?? (choose.lookbackBars ? {
      kind: "indicator" as const,
      indicator_id: "trailing_return_indicator@1",
      asset: { kind: "candidate" as const },
      parameters: { lookback_bars: choose.lookbackBars },
    } : undefined);
    content = <>
      <h2>{choose.label}</h2>
      {group.assetSetId && <AssetMembershipEditor authoring={structural} question="Candidate universe" assetSetId={group.assetSetId} assets={group.assets} />}
      {choose.lookbackComponentId && <LookbackControl authoring={structural} id="inspector-lookback" componentId={choose.lookbackComponentId} value={choose.lookbackBars!} />}
      {choose.selectionMode === "ranked" && rankComponent && selectionComponent && countCapability
        ? <SelectionComposer
            direction={(rankComponent.config.direction ?? "descending") as "descending" | "ascending"}
            count={Number(selectionComponent.config.count ?? choose.topN ?? 1)}
            shortagePolicy={(selectionComponent.config.shortage_policy ?? "require_full") as "require_full" | "choose_all"}
            valueExpression={rankingValue}
            strategy={state.canonical}
            capabilities={structural.capabilities?.value_capabilities}
            universeComponentId={group.universeComponentId}
            universeId={universeCapability?.value}
            universeChoices={universeCapability?.choices}
            eligibilitySummary={eligibilityComponent?.condition ? describeValueExpression(eligibilityComponent.condition.kind === "comparison" ? eligibilityComponent.condition.left : rankingValue!) : "All candidates qualify"}
            disabled={busy}
            onUniverseChange={universeCapability ? (universeId) => void structural.apply({ kind: "update_universe_reference", component_id: universeCapability.component_id, universe_id: universeId }, semanticSelection("selection", selectionComponent.id, { groupId: group.id })) : undefined}
            onChange={(value) => void structural.apply({
              kind: "update_selection_semantics",
              rank_component_id: rankComponent.id,
              selection_component_id: selectionComponent.id,
              direction: value.direction,
              count: value.count,
              shortage_policy: value.shortagePolicy,
              value_expression: value.valueExpression ?? rankComponent.value_expression ?? null,
            }, semanticSelection("selection", selectionComponent.id, { groupId: group.id }))}
          />
        : resampleCapability && <label>Choose again<select value={resampleCapability.value} disabled={busy} onChange={(event) => void structural.apply({ kind: "update_selection_resample", component_id: choose.selectionComponentId, resample: event.target.value as "once" | "per_event" })}>{resampleCapability.choices.map((choice) => <option key={choice} value={choice}>{choice === "per_event" ? "Each check" : "Keep first choice"}</option>)}</select></label>}
      {rankComponent?.value_expression && <p className="fixed-setting">Order by: {describeValueExpression(rankComponent.value_expression)}</p>}
      {choose.selectionMode !== "ranked" && countCapability && <label>How many?<AuthoringNumberInput value={choose.topN!} minimum={countCapability.minimum} maximum={countCapability.maximum ?? undefined} disabled={busy} onCommit={(count) => void structural.apply({ kind: "update_selection_count", component_id: choose.selectionComponentId, count })} /></label>}
      {choose.filterComponentId && <button className="secondary-button" onClick={() => dispatch({ type: "select_semantic", selection: semanticSelection("qualification", choose.filterComponentId!, { fieldPath: "condition", groupId: group.id }) })}>Eligibility: {eligibilityComponent?.condition
        ? (eligibilityComponent.condition.kind === "comparison"
          ? describeValueExpression(eligibilityComponent.condition.left)
          : "ALL value conditions")
        : `return > ${Number(choose.threshold) * 100}%`}</button>}
      {choose.fallbackComponentId && <button className="secondary-button" onClick={() => dispatch({ type: "select_semantic", selection: semanticSelection("fallback", choose.fallbackComponentId!, { groupId: group.id }) })}>Selection fallback: {choose.fallbackOptions.find((option) => option.id === choose.fallbackAssetSetRef)?.asset ?? "configured asset"}</button>}
      {choose.cooldownComponentId && choose.cooldownDuration && <CooldownControl authoring={structural} componentId={choose.cooldownComponentId} value={choose.cooldownDuration} />}
      {qualificationTarget && <button className="secondary-button" disabled={busy} onClick={() => void structural.apply({ kind: "add_qualification_condition", rank_component_id: qualificationTarget }, semanticSelection("qualification", `${qualificationTarget}_qualification`, { fieldPath: "config.threshold", groupId: group.id }))}>+ Add qualification</button>}
      {fallbackTarget && <FallbackTransformationControl busy={busy} error={structural.error} onApply={(asset) => structural.apply({ kind: "add_fallback_selection", weight_component_id: fallbackTarget, fallback_asset: asset }, semanticSelection("fallback", `${fallbackTarget}_fallback`, { groupId: group.id }))} />}
    </>;
  } else if (role === "qualification" && choose?.filterComponentId && group) {
    const removable = structural.capabilities?.qualification_remove_targets.includes(choose.filterComponentId);
    const filterComponent = state.canonical.graph.components.find((item) => item.id === choose.filterComponentId);
    const initial = filterComponent?.condition ?? legacyEligibility(
      choose.lookbackBars ?? 126,
      Number(filterComponent?.config.threshold ?? choose.threshold ?? 0),
    );
    content = <>
      <h2>Qualification</h2>
      <ConditionInspectorControl
        componentId={choose.filterComponentId}
        role="eligibility"
        initial={initial}
        lookback={choose.lookbackBars ?? 126}
        structural={structural}
        removable={removable}
        returnSelection={semanticSelection("selection", choose.selectionComponentId, { groupId: group.id })}
      />
    </>;
  } else if (role === "fallback" && choose?.fallbackComponentId && group) {
    const removable = structural.capabilities?.fallback_remove_targets.includes(choose.fallbackComponentId);
    const editable = structural.capabilities?.fallback_asset_set_targets.find((item) => item.component_id === choose.fallbackComponentId);
    content = <>
      <h2>Fallback</h2>
      {editable && <label>When selection is incomplete<select value={editable.asset_set_id} disabled={busy} onChange={(event) => void structural.apply({ kind: "update_fallback_asset_set", component_id: choose.fallbackComponentId!, asset_set_id: event.target.value })}>{choose.fallbackOptions.filter((option) => editable.choices.includes(option.id)).map((option) => <option key={option.id} value={option.id}>Use {option.asset}</option>)}</select></label>}
      {removable && <button className="text-button danger" disabled={busy} onClick={() => void structural.apply({ kind: "remove_fallback_selection", fallback_component_id: choose.fallbackComponentId! }, semanticSelection("selection", choose.selectionComponentId, { groupId: group.id }))}>Remove fallback</button>}
    </>;
  } else if (role === "schedule" && selection.componentId) {
    content = <><h2>Rebalance schedule</h2><ScheduleControl authoring={structural} label="When should it check?" componentId={selection.componentId} /></>;
  } else if (role === "cooldown" && selection.componentId && choose?.cooldownDuration) {
    content = <><h2>Cooldown</h2><CooldownControl authoring={structural} componentId={selection.componentId} value={choose.cooldownDuration} />
      {structural.capabilities?.cooldown_remove_targets.includes(selection.componentId) && <button className="text-button danger" disabled={busy} onClick={() => void structural.apply({ kind: "remove_cooldown_from_selection", cooldown_component_id: selection.componentId! }, semanticSelection("selection", choose.selectionComponentId, { groupId: group?.id }))}>Remove Cooldown</button>}</>;
  } else if (role === "rule" && selection.componentId && state.canonical.graph.components.some((item) => item.id === selection.componentId && item.primitive === "rule@1")) {
    content = <PredicateInspectorControl componentId={selection.componentId} structural={structural} />;
  } else {
    content = <><h2>Strategy rule</h2><p>This semantic component remains selected across Strategy representations.</p></>;
  }

  return <aside className="semantic-inspector" aria-label="Semantic Inspector">
    <header><span className="eyebrow">Inspector</span><button aria-label="Close Inspector" onClick={close}>×</button></header>
    <div className="semantic-inspector-content">{content}{structural.error && <p className="structural-error" role="alert">{structural.error.message}</p>}{evidence}</div>
  </aside>;
}
