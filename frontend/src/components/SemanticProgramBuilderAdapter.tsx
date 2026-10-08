import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { isDailyValue, type CanonicalStrategyV2, type ConditionV2, type ProgramStatementV2, type SelectionStatementV2, type ValueExpressionV2, type V2AuthoringOperation } from "../domain/canonicalV2";
import { describeConditionV2, describeProgramStatement, describeValueV2 } from "../domain/v2Semantics";
import { v2AuthoringApi, type V2AuthoringCapability } from "../v2AuthoringApi";
import { StrategyBuilderWorkspace, type ProgramBuilderView } from "./StrategyBuilderWorkspace";
import { WorkspaceLeftPanel, type ProductAddAction, type ProductStructureNode } from "./WorkspaceLeftPanel";
import { V2ConditionComposer, V2ConditionDraftComposer, V2ProgramValueComposer } from "./V2SemanticComposer";
import { BlockyView } from "../views/BlockyView";
import { SelectionComposer } from "./SelectionComposer";
import { adaptV2ProductOperation, type BuilderProductOperation } from "../domain/builderProductOperations";
import "./SemanticProgramBuilderAdapter.css";

type DraftConcept = { kind: "selection" | "control"; semanticId: string } | null;

function flatten(items: ProgramStatementV2[]): ProgramStatementV2[] {
  return items.flatMap((item) => [item,
    ...(item.kind === "control" ? flatten([...item.then_statements, ...item.otherwise_statements]) : []),
    ...(item.kind === "on_event" ? flatten(item.statements) : []),
  ]);
}

function isBootstrapRetain(statement: ProgramStatementV2): boolean {
  return statement.semantic_id === "initial-retain-allocation" && statement.kind === "allocate"
    && statement.legs.length === 1 && statement.legs[0]?.target.kind === "retain";
}

function visibleRoots(strategy: CanonicalStrategyV2): ProgramStatementV2[] {
  return (strategy.program?.statements ?? []).filter((statement) => !isBootstrapRetain(statement));
}

function assetSetForSelection(strategy: CanonicalStrategyV2, selection: SelectionStatementV2) {
  const group = strategy.definitions.groups.find((item) => item.id === selection.selection.universe_id);
  return strategy.definitions.asset_sets.find((item) => item.id === (group?.asset_set_ref ?? selection.selection.universe_id));
}

export function projectProgramProductStructure(strategy: CanonicalStrategyV2): ProductStructureNode {
  const roots = visibleRoots(strategy);
  const selections = flatten(roots).filter((item): item is SelectionStatementV2 => item.kind === "select");
  const investments = strategy.definitions.groups.map((group) => {
    const statement = selections.find((item) => item.selection.universe_id === group.id);
    const selection = statement?.selection;
    const assets = strategy.definitions.asset_sets.find((item) => item.id === group.asset_set_ref);
    const children: ProductStructureNode[] = [
      { id: `assets:${assets?.id ?? group.asset_set_ref}`, label: "Assets", detail: assets?.assets.join(", ") ?? "Choose assets", children: [] },
      ...(selection?.eligibility && statement ? [{ id: `qualification:${statement.semantic_id}`, label: "Qualification", detail: describeConditionV2(selection.eligibility), children: [] }] : []),
      ...(selection && statement ? [{ id: statement.semantic_id, label: `Choose ${selection.count} assets`, detail: `${selection.direction === "descending" ? "highest" : "lowest"} ${describeValueV2(selection.ranking)}`, children: [] }] : []),
      ...(selection?.fallback_asset && statement ? [{ id: `fallback:${statement.semantic_id}`, label: "Fallback", detail: `Otherwise → ${selection.fallback_asset}`, children: [] }] : []),
    ];
    return { id: `investment:${group.id}`, label: group.name || "Investment", detail: "100%", children };
  });
  const controls = roots.filter((item) => item.kind === "control").map((item) => ({ id: item.semantic_id, label: "IF / OTHERWISE", detail: describeConditionV2(item.condition), children: [] }));
  const timeframe = strategy.program?.clocks[0]?.timeframe ?? "daily";
  const split = roots.find((item) => item.kind === "allocate" && item.method === "fixed" && item.legs.filter((leg) => leg.target.kind === "group").length > 1);
  const capital = split ? [{ id: "split", label: "Split", detail: split.legs.map((leg) => `${Number(leg.weight ?? 0) * 100}%`).join(" / "), children: investments }] : investments;
  return { id: "portfolio", label: "Portfolio", children: [...capital, ...controls, ...(investments.length ? [{ id: "rebalance", label: "Rebalance", detail: `${timeframe[0]!.toUpperCase()}${timeframe.slice(1)} close`, children: [] }] : [])] };
}

export interface ProductFlowNode { id: string; label: string; detail?: string; role: "portfolio" | "capital" | "routing" | "behavior" | "timing" }

export function projectProgramProductFlow(strategy: CanonicalStrategyV2): ProductFlowNode[] {
  const structure = projectProgramProductStructure(strategy);
  const result: ProductFlowNode[] = [{ id: structure.id, label: structure.label, role: "portfolio" }];
  const visit = (node: ProductStructureNode) => {
    const role: ProductFlowNode["role"] = node.label === "Rebalance" ? "timing" : node.label === "Fallback" ? "behavior" : ["Qualification", "IF / OTHERWISE"].includes(node.label) || node.label.startsWith("Choose ") ? "routing" : "capital";
    result.push({ id: node.id, label: node.label, detail: node.detail, role });
    node.children.forEach(visit);
  };
  structure.children.forEach(visit);
  return result;
}

function replaceStatement(items: ProgramStatementV2[], semanticId: string, replacement: ProgramStatementV2): ProgramStatementV2[] {
  return items.map((item) => {
    if (item.semantic_id === semanticId) return replacement;
    if (item.kind === "control") return { ...item, then_statements: replaceStatement(item.then_statements, semanticId, replacement), otherwise_statements: replaceStatement(item.otherwise_statements, semanticId, replacement) };
    if (item.kind === "on_event") return { ...item, statements: replaceStatement(item.statements, semanticId, replacement) };
    return item;
  });
}

function nextId(strategy: CanonicalStrategyV2, prefix: string): string {
  const used = new Set(flatten(strategy.program?.statements ?? []).map((item) => item.semantic_id));
  let n = used.size + 1;
  while (used.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

function retainAllocation(strategy: CanonicalStrategyV2, prefix = "retain-policy"): Extract<ProgramStatementV2, { kind: "allocate" }> {
  const id = nextId(strategy, prefix);
  return { kind: "allocate", semantic_id: id, method: "equal", legs: [{ semantic_id: `${id}-leg`, target: { semantic_id: `${id}-target`, kind: "retain", ref: null }, weight: null }], clock_id: "daily-close", minimum_weight: null, maximum_weight: null, cash_remainder_asset: null };
}

function SelectionDraftInspector({ strategy, onComplete, initialUniverseId }: {
  strategy: CanonicalStrategyV2;
  onComplete: (operation: Extract<BuilderProductOperation, { kind: "setSelection" }>, universeId: string) => void; initialUniverseId?: string;
}) {
  const [universeId, setUniverseId] = useState(initialUniverseId ?? "");
  const [lookback, setLookback] = useState(126);
  const [count, setCount] = useState(2);
  const [direction, setDirection] = useState<"ascending" | "descending">("descending");
  const [shortage, setShortage] = useState<"choose_all" | "require_full">("choose_all");
  return <div className="semantic-inspector-content selection-draft"><h2>Choose assets</h2><p>Use the same Selection recipe: universe, ranking, direction, TAKE, and shortage behavior.</p><SelectionComposer
    direction={direction} count={count} shortagePolicy={shortage}
    universeEditor={<select aria-label="Universe" value={universeId} onChange={(event) => setUniverseId(event.target.value)}><option value="" disabled>Choose an Investment</option>{strategy.definitions.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>}
    eligibilitySummary="All candidates qualify"
    orderSummary={`${lookback}-observation return`}
    orderEditor={<label>Return period<input aria-label="Return period" type="number" min={2} max={1000} value={lookback} onChange={(event) => setLookback(Number(event.target.value))} /></label>}
    onChange={(value) => { setDirection(value.direction); setCount(value.count); setShortage(value.shortagePolicy); }}
  /><button type="button" className="primary-button" disabled={!universeId || lookback < 2 || count < 1} onClick={() => onComplete({ kind: "setSelection", lookback, direction: direction === "descending" ? "highest" : "lowest", take: count, shortage }, universeId)}>Create selection</button></div>;
}

function ProgramScheduleInspector({ timeframe, onChange }: { timeframe: "session" | "daily" | "weekly" | "monthly"; onChange: (timeframe: "daily" | "weekly" | "monthly") => void }) {
  return <div className="semantic-inspector-content"><h2>Rebalance</h2><p className="fixed-setting">When should this Portfolio evaluate and rebalance?</p><label>Schedule<select aria-label="Rebalance schedule" value={timeframe === "session" ? "daily" : timeframe} onChange={(event) => onChange(event.target.value as "daily" | "weekly" | "monthly")}><option value="daily">Daily close</option><option value="weekly">Weekly close</option><option value="monthly">Monthly close</option></select></label><p>The same schedule drives selection and allocation.</p></div>;
}

function ProgramAssetsInspector({ strategy, assetSetId, onAssets }: { strategy: CanonicalStrategyV2; assetSetId: string; onAssets: (assets: string[]) => void }) {
  const assetSet = strategy.definitions.asset_sets.find((item) => item.id === assetSetId);
  if (!assetSet) return <div className="semantic-inspector-content"><h2>Assets</h2><p>This investment's asset list is unavailable.</p></div>;
  return <div className="semantic-inspector-content"><h2>Assets</h2><p className="fixed-setting">What can this investment own?</p><label>Symbols<input aria-label="Investment assets" defaultValue={assetSet.assets.join(", ")} onBlur={(event) => { const assets = event.target.value.split(/[\s,]+/).map((item) => item.trim().toUpperCase()).filter(Boolean); if (assets.length) onAssets(assets); }} /></label><p>Separate symbols with commas.</p></div>;
}

function ProgramQualificationInspector({ strategy, statement, apply, working, onDefault }: { strategy: CanonicalStrategyV2; statement: SelectionStatementV2; apply: (operation: V2AuthoringOperation) => void; working: (unfinished: boolean) => void; onDefault: () => void }) {
  const condition = statement.selection.eligibility;
  return <div className="semantic-inspector-content"><h2>Qualification</h2><p className="fixed-setting">Which candidate assets qualify?</p>{condition
    ? <V2ConditionComposer condition={condition} strategy={strategy} role="eligibility" onWorking={working} onChange={(next) => apply({ kind: "set_program_condition", semantic_id: statement.semantic_id, role: "selection_eligibility", condition: next })} />
    : <><p>Start with the standard Qualification, then use the same field to build nested ALL / ANY conditions.</p><button type="button" className="primary-button" onClick={onDefault}>Candidate return (126) &gt; 0%</button></>}</div>;
}

function ProgramFallbackInspector({ statement, onFallback }: { statement: SelectionStatementV2; onFallback: (asset: string | null) => void }) {
  return <div className="semantic-inspector-content"><h2>Fallback</h2><label>When selection is incomplete<input aria-label="Fallback asset" defaultValue={statement.selection.fallback_asset ?? ""} placeholder="None" onBlur={(event) => onFallback(event.target.value.trim().toUpperCase() || null)} /></label><p className="fixed-setting">Selection fallback is distinct from IF / OTHERWISE.</p></div>;
}

function readdressCondition(condition: ConditionV2, prefix: string): ConditionV2 {
  if (condition.kind === "comparison") return { ...condition, semantic_id: `${prefix}-condition`, left: readdressValue(condition.left, `${prefix}-left`), right: readdressValue(condition.right, `${prefix}-right`) };
  if (condition.kind === "not") return { ...condition, semantic_id: `${prefix}-not`, child: readdressCondition(condition.child, `${prefix}-child`) };
  if (condition.kind === "state_equals" || condition.kind === "event_window") return { ...condition, semantic_id: `${prefix}-${condition.kind}` };
  return { ...condition, semantic_id: `${prefix}-${condition.kind}`, children: condition.children.map((child, index) => readdressCondition(child, `${prefix}-${index + 1}`)) };
}

function readdressValue(value: ValueExpressionV2, prefix: string): ValueExpressionV2 {
  if (isDailyValue(value)) return { ...value, semantic_id: prefix, operands: value.operands.map((operand, index) => readdressValue(operand, `${prefix}-operand-${index + 1}`) as typeof operand) };
  if (value.kind === "cross_sectional") return { ...value, semantic_id: prefix, source: readdressValue(value.source, `${prefix}-source`) as typeof value.source };
  if (value.kind === "cross_sectional_aggregate") return { ...value, semantic_id: prefix, source: readdressValue(value.source, `${prefix}-source`) as typeof value.source };
  if (value.kind === "score") return { ...value, semantic_id: prefix,
    terms: value.terms.map((term, index) => ({ ...term, semantic_id: `${prefix}-term-${index + 1}`, value: readdressValue(term.value, `${prefix}-term-${index + 1}-value`) as typeof term.value })),
    condition_terms: value.condition_terms.map((term, index) => ({ ...term, semantic_id: `${prefix}-points-${index + 1}`, condition: readdressCondition(term.condition, `${prefix}-points-${index + 1}`) })),
  };
  return { ...value, semantic_id: prefix };
}

function EventInspector({ strategy, statement, apply, working }: {
  strategy: CanonicalStrategyV2;
  statement: Extract<ProgramStatementV2, { kind: "on_event" }>;
  apply: (operation: V2AuthoringOperation) => void;
  working: (unfinished: boolean) => void;
}) {
  const [pendingTrigger, setPendingTrigger] = useState<typeof statement.event.trigger | null>(null);
  const [stateDraft, setStateDraft] = useState<{ key: string; from: string; to: string } | null>(null);
  const set = (event: typeof statement.event) => apply({ kind: "set_program_event", semantic_id: statement.semantic_id, event });
  const remembered = statement.statements.find((item) => item.kind === "remember_value");
  const chooseTrigger = (trigger: typeof statement.event.trigger) => {
    if (trigger === "scheduled") { setPendingTrigger(null); working(false); set({ ...statement.event, trigger, condition: null }); }
    else if (statement.event.condition) set({ ...statement.event, trigger });
    else { setPendingTrigger(trigger); working(true); }
  };
  const rememberTriggerValue = () => {
    if (statement.event.condition?.kind !== "comparison") return;
    const id = nextId(strategy, "remember-event-value");
    apply({ kind: "insert_program_statement", parent_semantic_id: statement.semantic_id, branch: "event", index: null, statement: { kind: "remember_value", semantic_id: id, memory_id: "event-level", clock_id: statement.event.clock_id, value: readdressValue(statement.event.condition.left, `${id}-value`) } });
  };
  const finishState = () => {
    if (!stateDraft || !stateDraft.key.trim() || !stateDraft.to.trim() || !statement.event.condition) return;
    const id = nextId(strategy, "state-change");
    apply({ kind: "insert_program_statement", parent_semantic_id: statement.semantic_id, branch: "event", index: null, statement: { kind: "transition", semantic_id: id, transition: { semantic_id: `${id}-definition`, state_key: stateDraft.key.trim(), from_value: stateDraft.from.trim() || null, to_value: stateDraft.to.trim(), when: readdressCondition(statement.event.condition, id), clock_id: statement.event.clock_id } } });
    setStateDraft(null); working(false);
  };
  return <div className="semantic-inspector-content"><h2>When an event occurs</h2>
    <label>Clock<select value={statement.event.clock_id} onChange={(event) => set({ ...statement.event, clock_id: event.target.value })}>{strategy.program?.clocks.map((clock) => <option key={clock.id} value={clock.id}>{clock.timeframe} close</option>)}</select></label>
    <label>Trigger<select value={pendingTrigger ?? statement.event.trigger} onChange={(event) => chooseTrigger(event.target.value as typeof statement.event.trigger)}><option value="scheduled">On schedule</option><option value="rising_edge">Became true</option><option value="falling_edge">Became false</option><option value="crosses_above">Crosses above</option><option value="crosses_below">Crosses below</option><option value="while_true">While true</option></select></label>
    {pendingTrigger && <section><h3>TRIGGER CONDITION</h3><V2ConditionDraftComposer semanticId={`${statement.semantic_id}-event-condition`} strategy={strategy} role="predicate" onWorking={working} onComplete={(condition) => { setPendingTrigger(null); set({ ...statement.event, trigger: pendingTrigger, condition }); }} /></section>}
    {statement.event.condition && <section><h3>CONDITION</h3><V2ConditionComposer condition={statement.event.condition} strategy={strategy} role="predicate" onWorking={working} onChange={(condition) => apply({ kind: "set_program_condition", semantic_id: statement.semantic_id, role: "event", condition })} /></section>}
    <label>Occurrence<select value={statement.event.occurrence} onChange={(event) => { const occurrence = event.target.value as typeof statement.event.occurrence; set({ ...statement.event, occurrence, ordinal: occurrence === "ordinal" ? statement.event.ordinal ?? 1 : null }); }}><option value="every">Every occurrence</option><option value="first">First occurrence</option><option value="ordinal">Specific occurrence</option></select></label>
    <section><h3>AFTER THIS EVENT</h3>{remembered?.kind === "remember_value" ? <><p>Remember this Value for later use.</p><V2ProgramValueComposer value={remembered.value} strategy={strategy} role="predicate" onWorking={working} onChange={(value) => apply({ kind: "set_program_value", semantic_id: remembered.semantic_id, role: "remembered_value", value })} /></> : <button type="button" className="text-button" disabled={statement.event.condition?.kind !== "comparison"} onClick={rememberTriggerValue}>Remember trigger Value for later</button>}
      {!stateDraft ? <button type="button" className="text-button" disabled={!statement.event.condition} onClick={() => { setStateDraft({ key: "", from: "", to: "" }); working(true); }}>Add state change</button> : <div className="state-transition-draft"><label>State name<input value={stateDraft.key} onChange={(event) => setStateDraft({ ...stateDraft, key: event.target.value })} /></label><label>From<input value={stateDraft.from} placeholder="Any state" onChange={(event) => setStateDraft({ ...stateDraft, from: event.target.value })} /></label><label>To<input value={stateDraft.to} onChange={(event) => setStateDraft({ ...stateDraft, to: event.target.value })} onBlur={finishState} /></label></div>}
    </section>
  </div>;
}

function Inspector({ strategy, statement, apply, working }: { strategy: CanonicalStrategyV2; statement: ProgramStatementV2; apply: (operation: V2AuthoringOperation) => void; working: (unfinished: boolean) => void }) {
  const [addingEligibility, setAddingEligibility] = useState(false);
  const [addingGuard, setAddingGuard] = useState(false);
  const [addingOverride, setAddingOverride] = useState(false);
  if (statement.kind === "select") {
    const selection = statement.selection;
    const set = (next: typeof selection) => apply({ kind: "set_program_selection", semantic_id: statement.semantic_id, selection: next });
    const universe = strategy.definitions.groups.find((item) => item.id === selection.universe_id);
    return <div className="semantic-inspector-content"><SelectionComposer
      direction={selection.direction} count={selection.count} shortagePolicy={selection.shortage_policy}
      universeEditor={<select aria-label="Selection universe" value={selection.universe_id} onChange={(event) => { const universe_id = event.target.value; set({ ...selection, universe_id, binding: { ...selection.binding, domain_id: universe_id } }); }}>{strategy.definitions.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}{strategy.definitions.asset_sets.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select>}
      eligibilitySummary={selection.eligibility ? describeConditionV2(selection.eligibility) : "All candidates qualify"}
      eligibilityEditor={selection.eligibility ? <p className="fixed-setting">Select Qualification in Structure for detailed editing.</p> : addingEligibility ? <V2ConditionDraftComposer semanticId={`${statement.semantic_id}-eligibility`} strategy={strategy} role="eligibility" onWorking={working} onComplete={(condition) => { setAddingEligibility(false); apply({ kind: "set_program_condition", semantic_id: statement.semantic_id, role: "selection_eligibility", condition }); }} /> : <button type="button" className="secondary-button" onClick={() => { setAddingEligibility(true); working(true); }}>+ Add eligibility</button>}
      orderSummary={describeValueV2(selection.ranking)}
      orderEditor={<V2ProgramValueComposer value={selection.ranking} strategy={strategy} role="ranking" onWorking={working} onChange={(value) => apply({ kind: "set_program_value", semantic_id: statement.semantic_id, role: "selection_ranking", value })} />}
      fallbackSummary={selection.fallback_asset ?? "None"}
      fallbackEditor={<input aria-label="Fallback asset" defaultValue={selection.fallback_asset ?? ""} placeholder="None" onBlur={(event) => set({ ...selection, fallback_asset: event.target.value.trim().toUpperCase() || null })} />}
      onChange={(value) => set({ ...selection, direction: value.direction, count: value.count, shortage_policy: value.shortagePolicy })}
    /><p className="value-capability-note">FROM uses {universe?.name ?? selection.universe_id}. Fallback is distinct from shortage policy and IF / OTHERWISE.</p></div>;
  }
  if (statement.kind === "control") return <div className="semantic-inspector-content"><h2>Condition routing</h2><V2ConditionComposer condition={statement.condition} strategy={strategy} role="predicate" onWorking={working} onChange={(condition) => apply({ kind: "set_program_condition", semantic_id: statement.semantic_id, role: "control", condition })} /></div>;
  if (statement.kind === "on_event") return <EventInspector strategy={strategy} statement={statement} apply={apply} working={working} />;
  if (statement.kind === "transition") { const set = (transition: typeof statement.transition) => apply({ kind: "set_program_transition", semantic_id: statement.semantic_id, transition }); return <div className="semantic-inspector-content"><h2>Change strategy state</h2><label>State name<input defaultValue={statement.transition.state_key} onBlur={(event) => set({ ...statement.transition, state_key: event.target.value.trim() })} /></label><label>From<input defaultValue={statement.transition.from_value ?? ""} placeholder="Any state" onBlur={(event) => set({ ...statement.transition, from_value: event.target.value.trim() || null })} /></label><label>To<input defaultValue={statement.transition.to_value} onBlur={(event) => set({ ...statement.transition, to_value: event.target.value.trim() })} /></label><V2ConditionComposer condition={statement.transition.when} strategy={strategy} role="predicate" onWorking={working} onChange={(condition) => apply({ kind: "set_program_condition", semantic_id: statement.semantic_id, role: "transition", condition })} /></div>; }
  if (statement.kind === "remember_value") return <div className="semantic-inspector-content"><h2>Remember a Value for later use</h2><V2ProgramValueComposer value={statement.value} strategy={strategy} role="predicate" onWorking={working} onChange={(value) => apply({ kind: "set_program_value", semantic_id: statement.semantic_id, role: "remembered_value", value })} /></div>;
  if (statement.kind === "allocate") {
    const selection = flatten(strategy.program?.statements ?? []).find((item): item is SelectionStatementV2 => item.kind === "select");
    const update = (allocation: typeof statement) => apply({ kind: "set_program_allocation", semantic_id: statement.semantic_id, role: "statement", allocation });
    const changeMethod = (method: typeof statement.method) => {
      if ((method === "proportional_score" || method === "inverse_volatility") && selection) update({ ...statement, method, legs: [{ semantic_id: `${statement.semantic_id}-selection-leg`, target: { semantic_id: `${statement.semantic_id}-selection-target`, kind: "selection", ref: selection.output_id }, weight: null }] });
      else update({ ...statement, method, legs: statement.legs.map((leg, index) => ({ ...leg, weight: method === "fixed" ? (index === 0 ? 1 : 0) : null })), minimum_weight: null, maximum_weight: null, cash_remainder_asset: null });
    };
    return <div className="semantic-inspector-content"><h2>Allocate capital</h2><label>Method<select value={statement.method} onChange={(event) => changeMethod(event.target.value as typeof statement.method)}><option value="equal">Equal weight</option><option value="fixed">Fixed weight</option><option value="proportional_score" disabled={!selection}>Proportional to score</option><option value="inverse_volatility" disabled={!selection}>Inverse volatility</option></select></label><p>{statement.legs.map((leg) => leg.target.kind === "retain" ? "Retain current holdings" : leg.target.ref ?? leg.target.kind).join(" · ")}</p>{(statement.method === "proportional_score" || statement.method === "inverse_volatility") && <><label>Minimum weight<input type="number" min={0} max={1} step="0.01" defaultValue={statement.minimum_weight ?? ""} onBlur={(event) => update({ ...statement, minimum_weight: event.target.value === "" ? null : Number(event.target.value) })} /></label><label>Maximum weight<input type="number" min={0} max={1} step="0.01" defaultValue={statement.maximum_weight ?? ""} onBlur={(event) => update({ ...statement, maximum_weight: event.target.value === "" ? null : Number(event.target.value) })} /></label><label>Cash remainder<input defaultValue={statement.cash_remainder_asset ?? ""} onBlur={(event) => update({ ...statement, cash_remainder_asset: event.target.value.trim().toUpperCase() || null })} /></label></>}</div>;
  }
  if (statement.kind === "guarded_allocation") {
    const replacePolicy = (replacement: typeof statement) => strategy.program && apply({ kind: "set_semantic_program", program: { ...strategy.program, statements: replaceStatement(strategy.program.statements, statement.semantic_id, replacement) } });
    return <div className="semantic-inspector-content"><h2>Allocation behavior</h2><p>Guard → priority override → primary → fallback → retain</p><section><h3>GUARD</h3>{statement.guard ? <V2ConditionComposer condition={statement.guard} strategy={strategy} role="predicate" onWorking={working} onChange={(condition) => apply({ kind: "set_program_condition", semantic_id: statement.semantic_id, role: "guard", condition })} /> : addingGuard ? <V2ConditionDraftComposer semanticId={`${statement.semantic_id}-guard`} strategy={strategy} role="predicate" onWorking={working} onComplete={(condition) => { setAddingGuard(false); replacePolicy({ ...statement, guard: condition }); }} /> : <button type="button" className="text-button" onClick={() => { setAddingGuard(true); working(true); }}>Add guard</button>}</section>{statement.overrides.map((override) => <section key={override.semantic_id}><h3>OVERRIDE · PRIORITY {override.priority}</h3><V2ConditionComposer condition={override.when} strategy={strategy} role="predicate" onWorking={working} onChange={(condition) => apply({ kind: "set_program_condition", semantic_id: statement.semantic_id, role: "override", override_semantic_id: override.semantic_id, condition })} /></section>)}{addingOverride ? <section><h3>NEW NO-TRADE OVERRIDE</h3><V2ConditionDraftComposer semanticId={`${statement.semantic_id}-override-condition`} strategy={strategy} role="predicate" onWorking={working} onComplete={(condition) => { const retained = retainAllocation(strategy, `${statement.semantic_id}-override-retain`); setAddingOverride(false); replacePolicy({ ...statement, overrides: [...statement.overrides, { semantic_id: `${statement.semantic_id}-override-${statement.overrides.length + 1}`, priority: 100 + statement.overrides.length, when: condition, action: retained }] }); }} /></section> : <button type="button" className="text-button" onClick={() => { setAddingOverride(true); working(true); }}>Add no-trade override</button>}<section><h3>FALLBACK</h3><p>{statement.fallback ? statement.fallback.legs.map((leg) => leg.target.kind === "retain" ? "Retain current holdings" : leg.target.ref ?? leg.target.kind).join(" · ") : "Retain current holdings"}</p></section></div>;
  }
  if (statement.kind === "unresolved") return <div className="semantic-inspector-content"><h2>Needs a precise definition</h2><blockquote>{statement.source_text}</blockquote><p className="form-error">{statement.reason}</p></div>;
  return <div className="semantic-inspector-content"><h2>{describeProgramStatement(statement)}</h2></div>;
}

export function SemanticProgramBuilderAdapter({ canonical, dirty, status, message, onHome, apply, save, undo, redo, canUndo, canRedo, working }: {
  canonical: CanonicalStrategyV2; dirty: boolean; status: "saved" | "updating" | "invalid" | "unfinished"; message: string;
  onHome: () => void; apply: (operation: V2AuthoringOperation) => void; save: () => void;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean; working: (unfinished: boolean) => void;
}) {
  const [view, setView] = useState<ProgramBuilderView>("blocky");
  const roots = useMemo(() => visibleRoots(canonical), [canonical]);
  const all = useMemo(() => flatten(roots), [roots]);
  const productStatements = useMemo(() => all.filter((item) => ["select", "allocate", "control", "guarded_allocation"].includes(item.kind)), [all]);
  const productRoots = useMemo(() => roots.filter((item) => ["select", "allocate", "control", "guarded_allocation"].includes(item.kind)), [roots]);
  const [selectedId, setSelectedId] = useState<string | null>(productStatements[0]?.semantic_id ?? null);
  const [draft, setDraft] = useState<DraftConcept>(null);
  const [capabilities, setCapabilities] = useState<V2AuthoringCapability[]>([]);
  const selected = productStatements.find((item) => item.semantic_id === selectedId) ?? null;
  const selectedSelectionId = selectedId?.match(/^(?:qualification|fallback):(.+)$/)?.[1] ?? null;
  const selectedSelection = all.find((item): item is SelectionStatementV2 => item.kind === "select" && item.semantic_id === selectedSelectionId) ?? null;
  const select = useCallback((id: string | null) => { setSelectedId(id); if (id) setDraft(null); }, []);
  useEffect(() => { let current = true; void v2AuthoringApi.capabilities().then((items) => { if (current) setCapabilities(items); }).catch(() => undefined); return () => { current = false; }; }, []);
  useEffect(() => { if (draft && all.some((item) => item.semantic_id === draft.semanticId)) { setDraft(null); working(false); } }, [all, draft, working]);
  const programCapability = capabilities.find((item) => item.operation_id === "program.event@1");
  const clock = canonical.program?.clocks[0];
  const applyProduct = (operation: BuilderProductOperation, address: Parameters<typeof adaptV2ProductOperation>[2] = {}) => {
    const native = adaptV2ProductOperation(canonical, operation, { clockId: clock?.id, ...address });
    if (native[0]) apply(native[0]);
  };
  const replaceRoots = (next: ProgramStatementV2[]) => canonical.program && apply({ kind: "set_semantic_program", program: { ...canonical.program, statements: next } });
  const addRoot = (statement: ProgramStatementV2) => replaceRoots([...roots, statement]);
  const startDraft = (kind: NonNullable<DraftConcept>["kind"], prefix: string) => { setDraft({ kind, semanticId: nextId(canonical, prefix) }); setSelectedId(null); working(true); setView("blocky"); };
  const selection = all.find((item): item is SelectionStatementV2 => item.kind === "select");
  const allocation = roots.find((item) => item.kind === "allocate" && !isBootstrapRetain(item));
  const portfolioSplit = roots.find((item) => item.kind === "allocate" && item.method === "fixed" && item.legs.filter((leg) => leg.target.kind === "group").length > 1);
  const investment = canonical.definitions.groups[0];
  const investmentAssets = canonical.definitions.asset_sets.find((item) => item.id === investment?.asset_set_ref);
  const nextInvestmentNumber = canonical.definitions.groups.length + 1;
  const tools: ProductAddAction[] = [
    { id: "investment", category: "Capital", label: "Investment", description: canonical.definitions.groups.length >= 2 ? "This Portfolio already has two Investments." : "Add a capital path backed by Assets.", disabled: canonical.definitions.groups.length >= 2, onAdd: () => applyProduct({ kind: "addInvestment", investmentId: `investment-${nextInvestmentNumber}`, name: canonical.definitions.groups.length ? `Investment ${nextInvestmentNumber}` : "Investment", assetSetId: `investment-${nextInvestmentNumber}-assets`, assets: ["SPY"] }) },
    { id: "split", category: "Capital", label: "Split", description: portfolioSplit ? "This Portfolio already has a Split." : "Split capital equally across two Investments.", disabled: canonical.definitions.groups.length < 2 || Boolean(portfolioSplit), onAdd: () => applyProduct({ kind: "setAllocation", method: "fixed", investments: canonical.definitions.groups.slice(0, 2).map((group) => ({ id: group.id, weight: .5 })) }) },
    { id: "sleeve", category: "Destination", label: "Sleeve", description: "A named branch within a split Portfolio.", disabled: true, onAdd: () => undefined },
    { id: "assets", category: "Destination", label: "Assets", description: investmentAssets ? "Edit the Investment's asset list." : "Add an Investment first.", disabled: !investmentAssets, onAdd: () => investmentAssets && select(`assets:${investmentAssets.id}`) },
    { id: "if", category: "Routing", label: "IF / OTHERWISE", description: "Add a condition that routes the strategy.", disabled: false, onAdd: () => startDraft("control", "condition-route") },
    { id: "qualification", category: "Routing", label: "Qualification", description: selection ? "Configure which candidate assets qualify." : "Choose assets first.", disabled: !selection, onAdd: () => selection && select(`qualification:${selection.semantic_id}`) },
    { id: "choose-assets", category: "Routing", label: "Choose assets", description: selection ? "This Investment already chooses assets." : "Rank candidates and choose the strongest assets.", disabled: !investment || Boolean(selection), onAdd: () => startDraft("selection", "selection") },
    { id: "allocation", category: "Allocation", label: "Allocation", description: allocation ? "Equal allocation is configured." : "Selection creates equal allocation.", disabled: true, onAdd: () => undefined },
    { id: "schedule", category: "Timing", label: "Schedule", description: investment ? "Configure the Portfolio rebalance cadence." : "Add an Investment first.", disabled: !investment, onAdd: () => select("rebalance") },
    { id: "cooldown", category: "Behavior", label: "Cooldown", description: "Not available for this Program profile.", disabled: true, onAdd: () => undefined },
    { id: "fallback", category: "Behavior", label: "Fallback", description: selection ? "Choose the asset used when too few qualify." : "Choose assets first.", disabled: !selection, onAdd: () => selection && select(`fallback:${selection.semantic_id}`) },
  ];
  const blank = canonical.definitions.groups.length === 0 && draft === null;
  const structure = projectProgramProductStructure(canonical);
  const flow = projectProgramProductFlow(canonical);
  const selectedInvestment = selectedId?.startsWith("investment:") ? canonical.definitions.groups.find((group) => group.id === selectedId.slice("investment:".length)) : null;
  const inspector = draft?.kind === "selection" ? <SelectionDraftInspector strategy={canonical} initialUniverseId={investment?.id} onComplete={(operation, investmentId) => applyProduct(operation, { investmentId, selectionId: draft.semanticId })} />
    : draft?.kind === "control" ? <div className="semantic-inspector-content"><h2>Add a condition route</h2><V2ConditionDraftComposer semanticId={`${draft.semanticId}-condition`} strategy={canonical} role="predicate" onWorking={working} onComplete={(condition: ConditionV2) => addRoot({ kind: "control", semantic_id: draft.semanticId, condition, then_statements: [retainAllocation(canonical, `${draft.semanticId}-retain`)], otherwise_statements: [], unknown_policy: "retain", clock_id: "daily-close" })} /></div>
      : selectedId?.startsWith("assets:") ? <ProgramAssetsInspector strategy={canonical} assetSetId={selectedId.slice("assets:".length)} onAssets={(assets) => applyProduct({ kind: "setAssets", assets }, { assetSetId: selectedId.slice("assets:".length) })} />
        : selectedId?.startsWith("qualification:") && selectedSelection ? <ProgramQualificationInspector strategy={canonical} statement={selectedSelection} apply={apply} working={working} onDefault={() => applyProduct({ kind: "setQualification", lookback: 126, operator: "gt", threshold: 0 }, { selectionId: selectedSelection.semantic_id })} />
          : selectedId?.startsWith("fallback:") && selectedSelection ? <ProgramFallbackInspector statement={selectedSelection} onFallback={(asset) => applyProduct({ kind: "setFallback", asset }, { selectionId: selectedSelection.semantic_id })} />
            : selected ? <Inspector strategy={canonical} statement={selected} apply={apply} working={working} />
              : selectedId === "rebalance" && clock ? <ProgramScheduleInspector timeframe={clock.timeframe} onChange={(timeframe) => applyProduct({ kind: "setRebalance", cadence: timeframe })} />
                : selectedInvestment ? <div className="semantic-inspector-content"><h2>{selectedInvestment.name || "Investment"}</h2><p className="fixed-setting">Capital path · {portfolioSplit ? "part of Portfolio Split" : "100% of Portfolio"}</p><button type="button" className="secondary-button" onClick={() => select(`assets:${selectedInvestment.asset_set_ref}`)}>Edit Assets</button></div>
                  : selectedId === "split" ? <div className="semantic-inspector-content"><h2>Split</h2><p className="fixed-setting">Allocate Portfolio capital across Investments.</p><p>{portfolioSplit?.legs.map((leg) => `${canonical.definitions.groups.find((group) => group.id === leg.target.ref)?.name ?? "Investment"}: ${Number(leg.weight ?? 0) * 100}%`).join(" · ")}</p></div>
                    : <div className="semantic-inspector-content"><h2>Portfolio</h2><p>Select an investment object in Structure or add one from Add.</p></div>;
  const representations: Record<ProgramBuilderView, ReactNode> = {
    overview: <section className="representation-layer v2-summary"><span className="eyebrow">Strategy summary</span><h1>{canonical.metadata.name}</h1><p>{blank ? "A portfolio ready for its first investment." : `${structure.children.length} portfolio steps using explicit financial rules.`}</p></section>,
    blocky: <section className="representation-layer blocky-layer"><BlockyView semanticProgram={{ statements: productRoots, contextLabel: investment ? `Portfolio > ${investment.name || "Investment"}` : "Portfolio", scheduleLabel: investment && clock ? `${clock.timeframe} close` : undefined, selectedId, onSelect: select }} /></section>,
    flow: <section className="representation-layer v2-flow" aria-label="Flow capital projection">{flow.map((node) => <button type="button" key={node.id} className={node.role === "routing" || node.role === "behavior" ? "flow-routing-node" : node.role === "timing" ? "flow-action-node" : "flow-capital-node"} onClick={() => select(node.id)}><strong>{node.label}</strong>{node.detail && <small>{node.detail}</small>}</button>)}{blank && <p>No capital route has been defined.</p>}</section>,
    rules: <section className="representation-layer v2-rules" aria-label="Rules projection"><h2>Rules</h2>{blank ? <p>No strategy logic has been added yet.</p> : productStatements.map((item) => <p key={item.semantic_id}>{describeProgramStatement(item)}.</p>)}</section>,
    guided: <section className="representation-layer guide-representation" aria-label="Guided strategy editor"><header className="representation-intro"><span className="eyebrow">Guide</span><h1>How this strategy works</h1><p>Use the same recipes available throughout RuleTrade.</p></header>{blank ? <section className="guide-recipes" aria-label="Guided Strategy recipes"><button className="secondary-button" type="button" onClick={() => startDraft("selection", "selection")}>Choose assets</button></section> : <div className="guide-sequence">{all.filter((item) => ["select", "control", "allocate"].includes(item.kind)).map((item) => <button className="guide-object" type="button" key={item.semantic_id} aria-pressed={selectedId === item.semantic_id} onClick={() => select(item.semantic_id)}><span>Strategy step</span><strong>{describeProgramStatement(item)}</strong></button>)}</div>}</section>,
    code: <section className="representation-layer code-representation" aria-label="Code representation"><header className="representation-intro"><span className="eyebrow">Code</span><h1>Canonical strategy</h1><p>Read-only developer representation. Editing remains in the shared Inspector.</p></header><pre className="code-metadata">{JSON.stringify(canonical, null, 2)}</pre></section>,
    ai: <section className="representation-layer ai-handoff-representation" aria-label="AI representation"><header className="representation-intro"><span className="eyebrow">AI handoff</span><h1>Bring your own AI</h1><p>Copy the committed semantic strategy for external analysis. Canonical changes still require validated authoring intents.</p></header><textarea aria-label="Context to copy for AI" readOnly rows={14} value={JSON.stringify({ format: "ruletrade.strategy-context/v1", strategy: canonical }, null, 2)} /></section>,
  };
  const capabilityHint = status === "invalid" ? message : programCapability?.backend_lowerable === false ? "You can finish building this strategy, but some advanced rules cannot be backtested yet." : message;
  return <StrategyBuilderWorkspace program={{ activeView: view, onViewChange: setView, leftPanel: <WorkspaceLeftPanel semanticProgram={{ tools, structure, selectedId, onSelect: (id) => select(id) }} />, representations, inspector, draftMessage: draft ? "Finish or discard the current semantic draft." : status === "unfinished" ? message : null, feedback: capabilityHint, onUndo: undo, onRedo: redo, canUndo, canRedo, onDiscardDraft: draft ? () => { setDraft(null); working(false); } : undefined }} name={canonical.metadata.name} dirty={dirty} saving={status === "updating"} persisted onHome={onHome} onSave={save} onTest={() => undefined} onOpenAssets={() => { const selected = all.find((item) => item.kind === "select") as SelectionStatementV2 | undefined; if (selected) { const assets = assetSetForSelection(canonical, selected); select(`assets:${assets?.id ?? selected.selection.universe_id}`); } }} testDisabled testTitle={programCapability?.reason ?? "Some advanced rules cannot be backtested yet."} />;
}
