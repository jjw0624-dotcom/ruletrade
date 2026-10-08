import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { isDailyValue, type CanonicalStrategyV2, type ConditionV2, type ProgramStatementV2, type SelectionStatementV2, type ValueExpressionV2, type V2AuthoringOperation } from "../domain/canonicalV2";
import { describeProgramStatement } from "../domain/v2Semantics";
import { v2AuthoringApi, type V2AuthoringCapability } from "../v2AuthoringApi";
import { StrategyBuilderWorkspace, type ProgramBuilderView } from "./StrategyBuilderWorkspace";
import { WorkspaceLeftPanel, type ProgramToolEntry } from "./WorkspaceLeftPanel";
import { V2ConditionComposer, V2ConditionDraftComposer, V2ProgramValueComposer, V2ValueDraftComposer } from "./V2SemanticComposer";
import { BlockyView } from "../views/BlockyView";
import "./SemanticProgramBuilderAdapter.css";

type DraftConcept = { kind: "selection" | "control" | "unresolved"; semanticId: string } | null;

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

function selectionAllocation(strategy: CanonicalStrategyV2, selection: SelectionStatementV2): Extract<ProgramStatementV2, { kind: "allocate" }> {
  const id = nextId(strategy, "allocation");
  return { kind: "allocate", semantic_id: id, method: "equal", legs: [{ semantic_id: `${id}-leg`, target: { semantic_id: `${id}-target`, kind: "selection", ref: selection.output_id }, weight: null }], clock_id: "daily-close", minimum_weight: null, maximum_weight: null, cash_remainder_asset: null };
}

function splitAllocation(strategy: CanonicalStrategyV2): Extract<ProgramStatementV2, { kind: "allocate" }> | null {
  const groups = strategy.definitions.groups.slice(0, 2);
  if (groups.length < 2) return null;
  const id = nextId(strategy, "portfolio-split");
  return { kind: "allocate", semantic_id: id, method: "fixed", legs: groups.map((group, index) => ({ semantic_id: `${id}-leg-${index + 1}`, target: { semantic_id: `${id}-target-${index + 1}`, kind: "group" as const, ref: group.id }, weight: .5 })), clock_id: "daily-close", minimum_weight: null, maximum_weight: null, cash_remainder_asset: null };
}

function SelectionDraftInspector({ strategy, semanticId, working, onComplete }: {
  strategy: CanonicalStrategyV2; semanticId: string; working: (unfinished: boolean) => void;
  onComplete: (selection: SelectionStatementV2) => void;
}) {
  const [universeId, setUniverseId] = useState("");
  const [ranking, setRanking] = useState<ValueExpressionV2 | null>(null);
  const [count, setCount] = useState(1);
  const [direction, setDirection] = useState<"ascending" | "descending">("descending");
  const finish = (universe = universeId, value = ranking) => {
    if (!universe || !value) return;
    const binding = `${semanticId}-candidate`;
    onComplete({ kind: "select", semantic_id: semanticId, output_id: `${semanticId}-output`, clock_id: "daily-close", selection: { semantic_id: `${semanticId}-definition`, universe_id: universe, binding: { id: binding, domain_id: universe }, eligibility: null, ranking: value, direction, count, shortage_policy: "choose_all", fallback_asset: null } });
  };
  return <div className="semantic-inspector-content selection-draft"><h2>Choose assets</h2><p>Define a universe and complete ranking Value. Nothing is committed before both are explicit.</p>
    <section><h3>FROM</h3><select aria-label="Universe" value={universeId} onChange={(event) => { const next = event.target.value; setUniverseId(next); finish(next, ranking); }}><option value="" disabled>Choose a universe</option>{strategy.definitions.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}{strategy.definitions.asset_sets.map((set) => <option key={set.id} value={set.id}>{set.id}</option>)}</select></section>
    <section><h3>ORDER BY / SCORE</h3><V2ValueDraftComposer semanticId={`${semanticId}-ranking`} strategy={strategy} role="ranking" onWorking={working} onComplete={(value) => { setRanking(value); finish(universeId, value); }} /></section>
    <section><h3>DIRECTION</h3><select value={direction} onChange={(event) => setDirection(event.target.value as typeof direction)}><option value="descending">Highest first</option><option value="ascending">Lowest first</option></select></section>
    <section><h3>TAKE</h3><input aria-label="Take count" type="number" min={1} max={100} value={count} onChange={(event) => setCount(Number(event.target.value))} /></section>
  </div>;
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
    return <div className="semantic-inspector-content"><h2>Choose {selection.count} assets</h2>
      <section><h3>FROM</h3><select value={selection.universe_id} onChange={(event) => { const universe_id = event.target.value; set({ ...selection, universe_id, binding: { ...selection.binding, domain_id: universe_id } }); }}>{strategy.definitions.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}{strategy.definitions.asset_sets.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select></section>
      <section><h3>WHERE</h3>{selection.eligibility ? <V2ConditionComposer condition={selection.eligibility} strategy={strategy} role="eligibility" onWorking={working} onChange={(condition) => apply({ kind: "set_program_condition", semantic_id: statement.semantic_id, role: "selection_eligibility", condition })} /> : addingEligibility ? <V2ConditionDraftComposer semanticId={`${statement.semantic_id}-eligibility`} strategy={strategy} role="eligibility" onWorking={working} onComplete={(condition) => { setAddingEligibility(false); apply({ kind: "set_program_condition", semantic_id: statement.semantic_id, role: "selection_eligibility", condition }); }} /> : <><p>All candidates qualify.</p><button type="button" className="text-button" onClick={() => { setAddingEligibility(true); working(true); }}>Add eligibility filter</button></>}</section>
      <section><h3>ORDER BY / SCORE</h3><V2ProgramValueComposer value={selection.ranking} strategy={strategy} role="ranking" onWorking={working} onChange={(value) => apply({ kind: "set_program_value", semantic_id: statement.semantic_id, role: "selection_ranking", value })} /></section>
      <section><h3>DIRECTION</h3><select value={selection.direction} onChange={(event) => set({ ...selection, direction: event.target.value as typeof selection.direction })}><option value="descending">Highest first</option><option value="ascending">Lowest first</option></select></section>
      <section><h3>TAKE</h3><input type="number" min={1} max={100} defaultValue={selection.count} onBlur={(event) => set({ ...selection, count: Number(event.target.value) })} /></section>
      <section><h3>WHEN FEWER QUALIFY</h3><select value={selection.shortage_policy} onChange={(event) => set({ ...selection, shortage_policy: event.target.value as typeof selection.shortage_policy })}><option value="require_full">Require full count</option><option value="choose_all">Choose all eligible</option></select></section>
      <section><h3>SELECTION FALLBACK</h3><input aria-label="Fallback asset" defaultValue={selection.fallback_asset ?? ""} placeholder="None" onBlur={(event) => set({ ...selection, fallback_asset: event.target.value.trim().toUpperCase() || null })} /><p className="value-capability-note">Fallback is distinct from shortage policy and Control OTHERWISE.</p></section>
    </div>;
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
  const [selectedId, setSelectedId] = useState<string | null>(all[0]?.semantic_id ?? null);
  const [draft, setDraft] = useState<DraftConcept>(null);
  const [draftPhrase, setDraftPhrase] = useState("strong breakout");
  const [capabilities, setCapabilities] = useState<V2AuthoringCapability[]>([]);
  const selected = all.find((item) => item.semantic_id === selectedId) ?? null;
  const unresolved = all.filter((item) => item.kind === "unresolved");
  const select = useCallback((id: string | null) => { setSelectedId(id); if (id) setDraft(null); }, []);
  useEffect(() => { let current = true; void v2AuthoringApi.capabilities().then((items) => { if (current) setCapabilities(items); }).catch(() => undefined); return () => { current = false; }; }, []);
  useEffect(() => { if (draft && all.some((item) => item.semantic_id === draft.semanticId)) { setDraft(null); working(false); } }, [all, draft, working]);
  const programCapability = capabilities.find((item) => item.operation_id === "program.event@1");
  const replaceRoots = (next: ProgramStatementV2[]) => canonical.program && apply({ kind: "set_semantic_program", program: { ...canonical.program, statements: next } });
  const addRoot = (statement: ProgramStatementV2) => replaceRoots([...roots, statement]);
  const startDraft = (kind: NonNullable<DraftConcept>["kind"], prefix: string) => { setDraft({ kind, semanticId: nextId(canonical, prefix) }); setSelectedId(null); working(true); setView("blocky"); };
  const selection = all.find((item): item is SelectionStatementV2 => item.kind === "select");
  const allocation = roots.find((item) => item.kind === "allocate" && !isBootstrapRetain(item));
  const addScheduledEvent = () => { const id = nextId(canonical, "event"); addRoot({ kind: "on_event", semantic_id: id, event: { semantic_id: `${id}-definition`, clock_id: "daily-close", condition: null, trigger: "scheduled", occurrence: "every", ordinal: null }, statements: [] }); setSelectedId(id); };
  const addPolicy = () => {
    if (!allocation || allocation.kind !== "allocate") return;
    const id = nextId(canonical, "allocation-behavior");
    const policy: ProgramStatementV2 = { kind: "guarded_allocation", semantic_id: id, guard: null, primary: allocation, overrides: [], fallback: retainAllocation(canonical, `${id}-fallback`), unknown_guard_policy: "block" };
    replaceRoots(roots.map((item) => item.semantic_id === allocation.semantic_id ? policy : item));
  };
  const tools: ProgramToolEntry[] = [
    { id: "choose-assets", category: "Assets", label: "Choose assets", description: "Create a Selection destination.", disabled: Boolean(selection), onAdd: () => startDraft("selection", "selection") },
    { id: "condition", category: "Decision", label: "Add condition", description: "Route capital with a complete Condition.", disabled: false, onAdd: () => startDraft("control", "condition-route") },
    { id: "timing", category: "Timing", label: "Add timing", description: "Run actions on an explicit schedule or Event.", disabled: false, onAdd: addScheduledEvent },
    { id: "allocate", category: "Capital", label: "Allocate capital", description: selection ? "Allocate to the selected destination." : "Choose what receives capital first.", disabled: !selection || Boolean(allocation), onAdd: () => selection && addRoot(selectionAllocation(canonical, selection)) },
    { id: "split", category: "Capital", label: "Split portfolio", description: canonical.definitions.groups.length >= 2 ? "Distribute capital across two sleeves." : "Create two compatible sleeves before splitting capital.", disabled: canonical.definitions.groups.length < 2 || Boolean(allocation), onAdd: () => { const split = splitAllocation(canonical); if (split) addRoot(split); } },
    { id: "policy", category: "Behavior", label: "Add guard / override / fallback", description: allocation ? "Add deterministic behavior to the current allocation." : "Add a capital allocation first.", disabled: !allocation, onAdd: addPolicy },
    { id: "unresolved", category: "Behavior", label: "Formalize an idea", description: "Keep an imprecise phrase local until it has explicit meaning.", disabled: false, onAdd: () => startDraft("unresolved", "formalization") },
  ];
  const blank = roots.length === 0 && draft === null;
  const inspector = draft?.kind === "selection" ? <SelectionDraftInspector strategy={canonical} semanticId={draft.semanticId} working={working} onComplete={addRoot} />
    : draft?.kind === "control" ? <div className="semantic-inspector-content"><h2>Add a condition route</h2><V2ConditionDraftComposer semanticId={`${draft.semanticId}-condition`} strategy={canonical} role="predicate" onWorking={working} onComplete={(condition: ConditionV2) => addRoot({ kind: "control", semantic_id: draft.semanticId, condition, then_statements: [retainAllocation(canonical, `${draft.semanticId}-retain`)], otherwise_statements: [], unknown_policy: "retain", clock_id: "daily-close" })} /></div>
      : draft?.kind === "unresolved" ? <div className="semantic-inspector-content"><h2>Formalize an idea</h2><label>Original phrase<input value={draftPhrase} onChange={(event) => setDraftPhrase(event.target.value)} /></label><p>This phrase remains a local draft and blocks Save/Test until you choose an explicit supported meaning.</p><button type="button" onClick={() => apply({ kind: "formalize_draft_phrase", source_phrase: draftPhrase, replacement: retainAllocation(canonical, `${draft.semanticId}-formalized`), interpretation: "Explicitly retain current holdings until a supported rule is configured.", parent_semantic_id: null, branch: "root", index: null })}>Use explicit retain-holdings policy</button></div>
        : selected ? <Inspector strategy={canonical} statement={selected} apply={apply} working={working} />
          : <div className="semantic-inspector-content"><h2>Strategy details</h2><p>Select a meaningful block to inspect its semantic details.</p></div>;
  const emptyState = <div><span className="eyebrow">Start building your strategy</span><h2>No strategy logic has been added yet</h2><p>Choose a meaningful next step. The internal retain skeleton stays out of your strategy canvas.</p><div className="program-empty-actions">{tools.filter((tool) => ["choose-assets", "condition", "split", "timing"].includes(tool.id)).map((tool) => <button type="button" key={tool.id} disabled={tool.disabled} title={tool.description} onClick={tool.onAdd}>+ {tool.label}</button>)}</div></div>;
  const representations: Record<ProgramBuilderView, ReactNode> = {
    overview: <section className="representation-layer v2-summary"><span className="eyebrow">Strategy summary</span><h1>{canonical.metadata.name}</h1><p>{blank ? "No strategy logic has been added yet." : `${roots.length} strategy concepts · ${unresolved.length ? `${unresolved.length} need a precise definition` : "all meanings are explicit"}.`}</p></section>,
    blocky: <section className="representation-layer blocky-layer"><BlockyView semanticProgram={{ statements: roots, selectedId, onSelect: select, empty: emptyState }} /></section>,
    flow: <section className="representation-layer v2-flow" aria-label="Flow capital projection"><div className="flow-capital-node">Portfolio capital</div>{all.filter((item) => ["select", "allocate", "control", "guarded_allocation"].includes(item.kind) && !isBootstrapRetain(item)).map((item) => <button type="button" key={item.semantic_id} className={item.kind === "select" || item.kind === "control" ? "flow-routing-node" : "flow-capital-node"} onClick={() => select(item.semantic_id)}>{describeProgramStatement(item)}</button>)}{!blank && <div className="flow-action-node">Target / Rebalance</div>}{blank && <p>No capital route has been defined.</p>}</section>,
    rules: <section className="representation-layer v2-rules" aria-label="Rules projection"><h2>Rules</h2>{blank ? <p>No strategy logic has been added yet.</p> : all.map((item) => <p key={item.semantic_id}>{describeProgramStatement(item)}.</p>)}</section>,
    guided: <section className="representation-layer guide-representation" aria-label="Guided strategy editor"><header className="representation-intro"><span className="eyebrow">Guide</span><h1>How this strategy works</h1><p>Select a step to inspect its meaning in the same Builder.</p></header><div className="guide-sequence">{all.map((item) => <button className="guide-object" type="button" key={item.semantic_id} aria-pressed={selectedId === item.semantic_id} onClick={() => select(item.semantic_id)}><span>Strategy step</span><strong>{describeProgramStatement(item)}</strong></button>)}</div></section>,
    code: <section className="representation-layer code-representation" aria-label="Code representation"><header className="representation-intro"><span className="eyebrow">Code</span><h1>Canonical Strategy v2</h1><p>Read-only developer representation. Editing remains in the shared Inspector.</p></header><pre className="code-metadata">{JSON.stringify(canonical, null, 2)}</pre></section>,
    ai: <section className="representation-layer ai-handoff-representation" aria-label="AI representation"><header className="representation-intro"><span className="eyebrow">AI handoff</span><h1>Bring your own AI</h1><p>Copy the committed semantic Strategy for external analysis. Canonical changes still require validated authoring intents.</p></header><textarea aria-label="Context to copy for AI" readOnly rows={14} value={JSON.stringify({ format: "ruletrade.semantic-program/v2", strategy: canonical }, null, 2)} /></section>,
  };
  const capabilityHint = status === "invalid" ? message : unresolved.length ? "Define the unresolved idea before saving or testing." : programCapability?.backend_lowerable === false ? "This Strategy can be authored and checked, but its advanced rules are not executable yet." : message;
  return <StrategyBuilderWorkspace program={{ activeView: view, onViewChange: setView, leftPanel: <WorkspaceLeftPanel semanticProgram={{ tools, statements: roots, selectedId, onSelect: (id) => select(id) }} />, representations, inspector, draftMessage: draft ? "Finish or discard the current semantic draft." : status === "unfinished" ? message : null, feedback: capabilityHint, onUndo: undo, onRedo: redo, canUndo, canRedo, onDiscardDraft: draft ? () => { setDraft(null); working(false); } : undefined }} name={canonical.metadata.name} dirty={dirty} saving={status === "updating"} persisted onHome={onHome} onSave={save} onTest={() => undefined} onOpenAssets={() => { const selected = all.find((item) => item.kind === "select"); if (selected) select(selected.semantic_id); setView("guided"); }} testDisabled testTitle={programCapability?.reason ?? "Advanced Strategy execution is not available yet."} />;
}
