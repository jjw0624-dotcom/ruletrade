import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { ConditionExpression } from "../domain/canonical";
import type { ConceptualFlowProjection, ConceptualGroup } from "../domain/conceptualFlow";
import { semanticSelection } from "../domain/semanticSelection";
import { describeConditionExpression, describeUniverse } from "../domain/valueSemantics";
import type { StructuralAuthoringController } from "../hooks/useStructuralAuthoring";
import { useStrategyEditor } from "../store/editorStore";
import { AssetMembershipEditor, AuthoringNumberInput, CooldownControl, ScheduleControl, SleeveAllocationEditor } from "./AuthoringControls";
import {
  FallbackTransformationControl,
} from "./ShapeTransformationControls";
import { GroupRenameControl } from "./StructuralAuthoringControls";
import { ConditionComposer } from "./ConditionComposer";
import { SelectionComposer } from "./SelectionComposer";
import { adaptV1ProductOperation } from "../domain/builderProductOperations";

function groupFor(
  projection: ConceptualFlowProjection,
  componentId: string | null,
  groupId: string | null,
): ConceptualGroup | undefined {
  return projection.groups.find((group) => group.id === groupId
    || group.sourceComponentIds.includes(componentId ?? "")
    || group.choose?.sourceComponentIds.includes(componentId ?? ""));
}

export function conditionAutoApplyOperation(componentId: string, role: "predicate" | "eligibility", condition: ConditionExpression) {
  return { kind: "update_condition_expression" as const, component_id: componentId, role, condition };
}

function ConditionInspectorControl({
  componentId,
  role,
  initial,
  structural,
  removable,
  returnSelection,
}: {
  componentId: string;
  role: "predicate" | "eligibility";
  initial: ConditionExpression;
  structural: StructuralAuthoringController;
  removable?: boolean;
  returnSelection?: ReturnType<typeof semanticSelection>;
}) {
  const { state } = useStrategyEditor();
  const [draft, setDraft] = useState<ConditionExpression>(initial);
  useEffect(() => setDraft(initial), [componentId, initial]);
  const commit = (condition: ConditionExpression) => {
    setDraft(condition);
    void structural.apply(
      conditionAutoApplyOperation(componentId, role, condition),
      semanticSelection(role === "predicate" ? "rule" : "qualification", componentId, { fieldPath: "condition" }),
    );
  };
  return <div className="predicate-inspector">
    <ConditionComposer
      role={role}
      expression={draft}
      strategy={state.canonical}
      capabilities={structural.capabilities?.value_capabilities}
      disabled={structural.status === "checking"}
      onWorkingState={(working) => { if (working === "incomplete") structural.setSemanticEditStatus?.("unfinished"); }}
      onChange={commit}
    />
    {(structural.semanticEdit?.status ?? "idle") !== "idle" && <div className={`semantic-edit-feedback ${(structural.semanticEdit?.status ?? "idle")}`} role="status">
      {structural.semanticEdit?.message}
    </div>}
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
  return <ConditionInspectorControl
    componentId={componentId}
    role="predicate"
    initial={component.condition}
    structural={structural}
    removable
  />;
}

function CanonicalV1SemanticInspector({
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
  const selectedDraft = state.editor.logicDraft.workingProgram?.blocks.find((item) => item.workingId === selectedDraftId);
  const [draftCondition, setDraftCondition] = useState<ConditionExpression | null>(null);
  useEffect(() => setDraftCondition(selectedDraft?.condition ?? null), [selectedDraftId, selectedDraft?.condition]);
  if (!selection && !selectedDraftId) return null;
  if (!selection && selectedDraftId) {
    const label = selectedDraft?.blockType === "rt_draft_if_else" ? "If / Otherwise" : "If";
    return <aside className="semantic-inspector" aria-label="Semantic Inspector">
      <header><span className="eyebrow">Inspector</span><button aria-label="Close Inspector" onClick={() => { structural.setSemanticEditStatus?.("idle"); dispatch({ type: "select_logic_draft", draftId: null }); }}>×</button></header>
      <div className="semantic-inspector-content">
        <h2>{label}</h2>
        <p className="fixed-setting">Unfinished control structure in this Blocky working program.</p>
        {!draftCondition && <p role="status"><strong>Predicate missing</strong> · compose a complete comparison before this Control can be committed.</p>}
        <ConditionComposer role="predicate" expression={draftCondition} strategy={state.canonical} capabilities={structural.capabilities?.value_capabilities}
          disabled={structural.status === "checking"} initiallyOpen
          onWorkingState={(working) => structural.setSemanticEditStatus?.(working === "incomplete" ? "unfinished" : "idle")}
          onChange={(condition) => {
            setDraftCondition(condition);
            structural.setSemanticEditStatus?.("idle");
            dispatch({ type: "set_logic_draft_condition", draftId: selectedDraftId, condition });
          }} />
        {selectedDraft?.condition && <p className="fixed-setting">Draft Predicate: {describeConditionExpression(selectedDraft.condition)} · commits automatically when branch topology is valid.</p>}
        <button className="text-button danger" onClick={() => { structural.setSemanticEditStatus?.("idle"); dispatch({ type: "request_remove_logic_draft", draftId: selectedDraftId }); }}>Discard unfinished control</button>
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
  const close = () => { structural.setSemanticEditStatus?.("idle"); dispatch({ type: "select_semantic", selection: null }); };

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
    const rankingValue = choose.rankingValue;
    content = <>
      <h2>{choose.label}</h2>
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
            eligibilitySummary={choose.condition ?? "All candidates qualify"}
            eligibilityEditor={choose.filterComponentId
              ? <button className="secondary-button" onClick={() => dispatch({ type: "select_semantic", selection: semanticSelection("qualification", choose.filterComponentId!, { fieldPath: "condition", groupId: group.id }) })}>Edit qualification</button>
              : qualificationTarget && <button className="secondary-button" disabled={busy} onClick={() => { const native = adaptV1ProductOperation({ kind: "setQualification", lookback: choose.lookbackBars ?? 126, operator: "gt", threshold: 0 }, { rankComponentId: qualificationTarget })[0]; if (native) void structural.apply(native, semanticSelection("qualification", `${qualificationTarget}_qualification`, { fieldPath: "condition", groupId: group.id })); }}>+ Add qualification</button>}
            universeMembersEditor={group.assetSetId ? <AssetMembershipEditor authoring={structural} question="Universe members" assetSetId={group.assetSetId} assets={group.assets} /> : undefined}
            fallbackSummary={choose.fallbackComponentId ? choose.fallbackOptions.find((option) => option.id === choose.fallbackAssetSetRef)?.asset ?? "Configured asset" : "None"}
            fallbackEditor={choose.fallbackComponentId
              ? <button className="secondary-button" onClick={() => dispatch({ type: "select_semantic", selection: semanticSelection("fallback", choose.fallbackComponentId!, { groupId: group.id }) })}>Edit fallback</button>
              : fallbackTarget ? <FallbackTransformationControl busy={busy} error={structural.error} onApply={(asset) => { const native = adaptV1ProductOperation({ kind: "setFallback", asset }, { weightComponentId: fallbackTarget })[0]; return native ? structural.apply(native, semanticSelection("fallback", `${fallbackTarget}_fallback`, { groupId: group.id })) : Promise.resolve(false); }} /> : undefined}
            disabled={structural.status === "checking"}
            onWorkingState={(working) => { if (working === "incomplete") structural.setSemanticEditStatus?.("unfinished"); }}
            onUniverseChange={universeCapability ? (universeId) => void structural.apply({ kind: "update_universe_reference", component_id: universeCapability.component_id, universe_id: universeId }, semanticSelection("selection", selectionComponent.id, { groupId: group.id })) : undefined}
            onChange={(value) => {
              const expression = value.valueExpression ?? rankingValue ?? null;
              if (expression?.kind === "indicator" && expression.indicator_id === "trailing_return_indicator@1") {
                const native = adaptV1ProductOperation({ kind: "setSelection", lookback: Number(expression.parameters.lookback_bars ?? choose.lookbackBars ?? 126), direction: value.direction === "descending" ? "highest" : "lowest", take: value.count, shortage: value.shortagePolicy }, { rankComponentId: rankComponent.id, selectionComponentId: selectionComponent.id })[0];
                if (native) void structural.apply(native, semanticSelection("selection", selectionComponent.id, { groupId: group.id }));
                return;
              }
              void structural.apply({ kind: "update_selection_semantics", rank_component_id: rankComponent.id, selection_component_id: selectionComponent.id, direction: value.direction, count: value.count, shortage_policy: value.shortagePolicy, value_expression: expression }, semanticSelection("selection", selectionComponent.id, { groupId: group.id }));
            }}
          />
        : resampleCapability && <label>Choose again<select value={resampleCapability.value} disabled={busy} onChange={(event) => void structural.apply({ kind: "update_selection_resample", component_id: choose.selectionComponentId, resample: event.target.value as "once" | "per_event" })}>{resampleCapability.choices.map((choice) => <option key={choice} value={choice}>{choice === "per_event" ? "Each check" : "Keep first choice"}</option>)}</select></label>}
      {choose.selectionMode !== "ranked" && countCapability && <label>How many?<AuthoringNumberInput value={choose.topN!} minimum={countCapability.minimum} maximum={countCapability.maximum ?? undefined} disabled={busy} onCommit={(count) => void structural.apply({ kind: "update_selection_count", component_id: choose.selectionComponentId, count })} /></label>}
      {(structural.semanticEdit?.status ?? "idle") !== "idle" && <div className={`semantic-edit-feedback ${(structural.semanticEdit?.status ?? "idle")}`} role="status">{structural.semanticEdit?.message}</div>}
      {choose.cooldownComponentId && choose.cooldownDuration && <CooldownControl authoring={structural} componentId={choose.cooldownComponentId} value={choose.cooldownDuration} />}
    </>;
  } else if (role === "qualification" && choose?.filterComponentId && group) {
    const removable = structural.capabilities?.qualification_remove_targets.includes(choose.filterComponentId);
    const initial = choose.eligibilityCondition;
    if (!initial) return null;
    content = <>
      <h2>Qualification</h2>
      <ConditionInspectorControl
        componentId={choose.filterComponentId}
        role="eligibility"
        initial={initial}
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

export function SemanticInspector(props: ({
  projection: ConceptualFlowProjection;
  structural: StructuralAuthoringController;
  evidence?: ReactNode;
} | {
  semanticProgram: { content: ReactNode; onDiscardDraft?: () => void };
})) {
  if ("semanticProgram" in props) return <aside className="semantic-inspector" aria-label="Semantic Inspector">
    <header><span className="eyebrow">Inspector</span>{props.semanticProgram.onDiscardDraft && <button type="button" className="text-button danger" onClick={props.semanticProgram.onDiscardDraft}>Discard draft</button>}</header>
    {props.semanticProgram.content}
  </aside>;
  return <CanonicalV1SemanticInspector {...props} />;
}
