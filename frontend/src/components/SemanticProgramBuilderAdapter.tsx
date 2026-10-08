import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { isDailyValue, type CanonicalStrategyV2, type ConditionV2, type ProgramStatementV2, type SelectionStatementV2, type ValueExpressionV2, type V2AuthoringOperation } from "../domain/canonicalV2";
import { describeConditionV2, describeProgramStatement, describeValueV2 } from "../domain/v2Semantics";
import type { V2ExecutionCapability } from "../v2ExecutionApi";
import { StrategyBuilderWorkspace, type ProgramBuilderView } from "./StrategyBuilderWorkspace";
import { WorkspaceLeftPanel, type ProductAddAction, type ProductStructureNode } from "./WorkspaceLeftPanel";
import { V2ConditionComposer, V2ConditionDraftComposer, V2ProgramValueComposer } from "./V2SemanticComposer";
import { ProductBlockyProjection } from "./ProductBlockyProjection";
import { SelectionComposer } from "./SelectionComposer";
import { adaptV2ProductOperation, type BuilderProductOperation } from "../domain/builderProductOperations";
import { isProgramBootstrap, projectV2ProductSemantics, visibleProgramStatements, type ProductFlowNode } from "../domain/productSemantics";
import "./SemanticProgramBuilderAdapter.css";

type DraftConcept = { kind: "selection"; semanticId: string; withQualification?: boolean } | null;

function flatten(items: ProgramStatementV2[]): ProgramStatementV2[] {
  return items.flatMap((item) => [item,
    ...(item.kind === "control" ? flatten([...item.then_statements, ...item.otherwise_statements]) : []),
    ...(item.kind === "on_event" ? flatten(item.statements) : []),
  ]);
}

function visibleRoots(strategy: CanonicalStrategyV2): ProgramStatementV2[] {
  return visibleProgramStatements(strategy);
}

function assetSetForSelection(strategy: CanonicalStrategyV2, selection: SelectionStatementV2) {
  const group = strategy.definitions.groups.find((item) => item.id === selection.selection.universe_id);
  return strategy.definitions.asset_sets.find((item) => item.id === (group?.asset_set_ref ?? selection.selection.universe_id));
}

export function projectProgramProductStructure(strategy: CanonicalStrategyV2): ProductStructureNode {
  return projectV2ProductSemantics(strategy).root;
}

export function projectProgramProductFlow(strategy: CanonicalStrategyV2): ProductFlowNode[] {
  return projectV2ProductSemantics(strategy).flow;
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

function SelectionDraftInspector({ strategy, onComplete, initialUniverseId, withQualification = false }: {
  strategy: CanonicalStrategyV2;
  onComplete: (operation: Extract<BuilderProductOperation, { kind: "setSelection" }>, universeId: string) => void; initialUniverseId?: string; withQualification?: boolean;
}) {
  const [universeId, setUniverseId] = useState(initialUniverseId ?? "");
  const [lookback, setLookback] = useState(126);
  const [count, setCount] = useState(2);
  const [direction, setDirection] = useState<"ascending" | "descending">("descending");
  const [shortage, setShortage] = useState<"choose_all" | "require_full">("require_full");
  return <div className="semantic-inspector-content selection-draft"><h2>Choose assets</h2><p>Use the same Selection recipe: universe, ranking, direction, TAKE, and shortage behavior.</p><SelectionComposer
    direction={direction} count={count} shortagePolicy={shortage}
    universeEditor={<select aria-label="Universe" value={universeId} onChange={(event) => setUniverseId(event.target.value)}><option value="" disabled>Choose an Investment</option>{strategy.definitions.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>}
    eligibilitySummary={withQualification ? "Candidate return (126) > 0%" : "All candidates qualify"}
    orderSummary={`${lookback}-observation return`}
    orderEditor={<label>Return period<input aria-label="Return period" type="number" min={2} max={1000} value={lookback} onChange={(event) => setLookback(Number(event.target.value))} /></label>}
    onChange={(value) => { setDirection(value.direction); setCount(value.count); setShortage(value.shortagePolicy); }}
  /><button type="button" className="primary-button" disabled={!universeId || lookback < 2 || count < 1} onClick={() => onComplete({ kind: "setSelection", lookback, direction: direction === "descending" ? "highest" : "lowest", take: count, shortage, ...(withQualification ? { qualification: { lookback: 126, operator: "gt" as const, threshold: 0 } } : {}) }, universeId)}>Create selection</button></div>;
}

function ProgramScheduleInspector({ timeframe, onChange }: { timeframe: "session" | "daily" | "weekly" | "monthly"; onChange: (timeframe: "daily" | "monthly") => void }) {
  return <div className="semantic-inspector-content"><h2>Rebalance</h2><p className="fixed-setting">When should this Portfolio evaluate and rebalance?</p><label>Schedule<select aria-label="Rebalance schedule" value={timeframe === "monthly" ? "monthly" : "daily"} onChange={(event) => onChange(event.target.value as "daily" | "monthly")}><option value="daily">Daily close</option><option value="monthly">Monthly close</option></select></label>{timeframe === "weekly" && <p>Weekly timing is preserved but remains read-only until production lowering is available.</p>}<p>The same schedule drives selection and allocation.</p></div>;
}

function ProgramAssetsInspector({ strategy, assetSetId, onAssets }: { strategy: CanonicalStrategyV2; assetSetId: string; onAssets: (assets: string[]) => void }) {
  const assetSet = strategy.definitions.asset_sets.find((item) => item.id === assetSetId);
  if (!assetSet) return <div className="semantic-inspector-content"><h2>Assets</h2><p>This investment's asset list is unavailable.</p></div>;
  return <div className="semantic-inspector-content"><h2>Assets</h2><p className="fixed-setting">What can this investment own?</p><label>Symbols<input aria-label="Investment assets" defaultValue={assetSet.assets.join(", ")} placeholder="QQQ, VGT, SOXX, SCHG" onBlur={(event) => { const assets = event.target.value.split(/[\s,]+/).map((item) => item.trim().toUpperCase()).filter(Boolean); onAssets(assets); }} /></label><p>Separate symbols with commas.</p></div>;
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
    return <div className="semantic-inspector-content"><h2>Allocate capital</h2><p className="fixed-setting">{statement.method === "fixed" ? "Fixed weights" : "Equal weight"}</p><p>{statement.legs.map((leg) => leg.target.kind === "retain" ? "Retain current holdings" : leg.target.ref ?? leg.target.kind).join(" · ")}</p><p className="value-capability-note">Allocation changes use the Selection and Split product controls. Score-proportional and inverse-volatility allocation remain authoring-unreachable until production lowering is available.</p></div>;
  }
  if (statement.kind === "guarded_allocation") {
    const replacePolicy = (replacement: typeof statement) => strategy.program && apply({ kind: "set_semantic_program", program: { ...strategy.program, statements: replaceStatement(strategy.program.statements, statement.semantic_id, replacement) } });
    return <div className="semantic-inspector-content"><h2>Allocation behavior</h2><p>Guard → priority override → primary → fallback → retain</p><section><h3>GUARD</h3>{statement.guard ? <V2ConditionComposer condition={statement.guard} strategy={strategy} role="predicate" onWorking={working} onChange={(condition) => apply({ kind: "set_program_condition", semantic_id: statement.semantic_id, role: "guard", condition })} /> : addingGuard ? <V2ConditionDraftComposer semanticId={`${statement.semantic_id}-guard`} strategy={strategy} role="predicate" onWorking={working} onComplete={(condition) => { setAddingGuard(false); replacePolicy({ ...statement, guard: condition }); }} /> : <button type="button" className="text-button" onClick={() => { setAddingGuard(true); working(true); }}>Add guard</button>}</section>{statement.overrides.map((override) => <section key={override.semantic_id}><h3>OVERRIDE · PRIORITY {override.priority}</h3><V2ConditionComposer condition={override.when} strategy={strategy} role="predicate" onWorking={working} onChange={(condition) => apply({ kind: "set_program_condition", semantic_id: statement.semantic_id, role: "override", override_semantic_id: override.semantic_id, condition })} /></section>)}{addingOverride ? <section><h3>NEW NO-TRADE OVERRIDE</h3><V2ConditionDraftComposer semanticId={`${statement.semantic_id}-override-condition`} strategy={strategy} role="predicate" onWorking={working} onComplete={(condition) => { const retained = retainAllocation(strategy, `${statement.semantic_id}-override-retain`); setAddingOverride(false); replacePolicy({ ...statement, overrides: [...statement.overrides, { semantic_id: `${statement.semantic_id}-override-${statement.overrides.length + 1}`, priority: 100 + statement.overrides.length, when: condition, action: retained }] }); }} /></section> : <button type="button" className="text-button" onClick={() => { setAddingOverride(true); working(true); }}>Add no-trade override</button>}<section><h3>FALLBACK</h3><p>{statement.fallback ? statement.fallback.legs.map((leg) => leg.target.kind === "retain" ? "Retain current holdings" : leg.target.ref ?? leg.target.kind).join(" · ") : "Retain current holdings"}</p></section></div>;
  }
  if (statement.kind === "unresolved") return <div className="semantic-inspector-content"><h2>Needs a precise definition</h2><blockquote>{statement.source_text}</blockquote><p className="form-error">{statement.reason}</p></div>;
  return <div className="semantic-inspector-content"><h2>{describeProgramStatement(statement)}</h2></div>;
}

export function SemanticProgramBuilderAdapter({ canonical, dirty, status, message, onHome, apply, save, undo, redo, canUndo, canRedo, working, run, executionCapability, initialView = "blocky" }: {
  canonical: CanonicalStrategyV2; dirty: boolean; status: "saved" | "updating" | "invalid" | "unfinished"; message: string;
  onHome: () => void; apply: (operation: V2AuthoringOperation) => void; save: () => void;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean; working: (unfinished: boolean) => void;
  run: () => void; executionCapability: V2ExecutionCapability | null;
  initialView?: ProgramBuilderView;
}) {
  const [view, setView] = useState<ProgramBuilderView>(initialView);
  const roots = useMemo(() => visibleRoots(canonical), [canonical]);
  const all = useMemo(() => flatten(roots), [roots]);
  const productStatements = useMemo(() => all.filter((item) => ["select", "allocate", "control", "guarded_allocation"].includes(item.kind)), [all]);
  const [selectedId, setSelectedId] = useState<string | null>(productStatements[0]?.semantic_id ?? null);
  const [draft, setDraft] = useState<DraftConcept>(null);
  const selected = productStatements.find((item) => item.semantic_id === selectedId) ?? null;
  const selectedSelectionId = selectedId?.match(/^(?:qualification|fallback):(.+)$/)?.[1] ?? null;
  const selectedSelection = all.find((item): item is SelectionStatementV2 => item.kind === "select" && item.semantic_id === selectedSelectionId) ?? null;
  const select = useCallback((id: string | null) => { setSelectedId(id); if (id) setDraft(null); }, []);
  useEffect(() => { if (draft && all.some((item) => item.semantic_id === draft.semanticId)) { setDraft(null); working(false); } }, [all, draft, working]);
  const clock = canonical.program?.clocks[0];
  const applyProduct = (operation: BuilderProductOperation, address: Parameters<typeof adaptV2ProductOperation>[2] = {}) => {
    const native = adaptV2ProductOperation(canonical, operation, { clockId: clock?.id, ...address });
    if (native[0]) apply(native[0]);
  };
  const startDraft = (kind: NonNullable<DraftConcept>["kind"], prefix: string, withQualification = false) => { setDraft({ kind, semanticId: nextId(canonical, prefix), withQualification }); setSelectedId(null); working(true); setView("blocky"); };
  const selection = all.find((item): item is SelectionStatementV2 => item.kind === "select");
  const allocation = roots.find((item) => item.kind === "allocate" && !isProgramBootstrap(item));
  const portfolioSplit = roots.find((item): item is Extract<ProgramStatementV2, { kind: "allocate" }> => item.kind === "allocate" && item.method === "fixed" && item.legs.filter((leg) => leg.target.kind === "group").length > 1);
  const investment = canonical.definitions.groups[0];
  const investmentAssets = canonical.definitions.asset_sets.find((item) => item.id === investment?.asset_set_ref);
  const nextInvestmentNumber = canonical.definitions.groups.length + 1;
  const addInvestment = () => {
    const investmentId = `investment-${nextInvestmentNumber}`;
    applyProduct({ kind: "addInvestment", investmentId, name: canonical.definitions.groups.length ? `Investment ${nextInvestmentNumber}` : "Investment", assetSetId: `${investmentId}-assets`, assets: [] });
    select(`investment:${investmentId}`);
  };
  const tools: ProductAddAction[] = [
    { id: "investment", category: "Capital", label: "Investment", description: canonical.definitions.groups.length >= 2 ? "This Portfolio already has two Investments." : "A capital path backed by assets.", availability: canonical.definitions.groups.length >= 2 ? "unavailable" : "ready", disabled: canonical.definitions.groups.length >= 2, onAdd: addInvestment },
    { id: "split", category: "Capital", label: "Split", description: portfolioSplit ? "This Portfolio already has a Split." : "Split capital across two investments.", availability: portfolioSplit ? "unavailable" : canonical.definitions.groups.length < 2 ? "needs_context" : "ready", disabled: canonical.definitions.groups.length < 2 || Boolean(portfolioSplit), onAdd: () => applyProduct({ kind: "setAllocation", method: "fixed", investments: canonical.definitions.groups.slice(0, 2).map((group) => ({ id: group.id, weight: .5 })) }) },
    { id: "sleeve", category: "Destination", label: "Sleeve", description: "A named branch within a split Portfolio.", availability: "unavailable", disabled: true, onAdd: () => undefined },
    { id: "assets", category: "Destination", label: "Assets", description: investmentAssets ? "Edit the Investment's asset list." : "Add an Investment first.", availability: investmentAssets ? "ready" : "needs_context", disabled: !investmentAssets, onAdd: () => investmentAssets && select(`assets:${investmentAssets.id}`) },
    { id: "if", category: "Routing", label: "IF / OTHERWISE", description: "Conditional routing is not yet available for production testing.", availability: "unavailable", disabled: true, onAdd: () => undefined },
    { id: "qualification", category: "Routing", label: "Qualification", description: selection ? "Configure which candidate assets qualify." : investment ? "Define Qualification with the first Selection." : "Add an Investment first.", availability: investment ? "ready" : "needs_context", disabled: !investment, onAdd: () => selection ? select(`qualification:${selection.semantic_id}`) : startDraft("selection", "selection", true) },
    { id: "choose-assets", category: "Routing", label: "Choose assets", description: selection ? "This Investment already chooses assets." : "Rank candidates and choose the strongest assets.", availability: selection ? "unavailable" : investment ? "ready" : "needs_context", disabled: !investment || Boolean(selection), onAdd: () => startDraft("selection", "selection") },
    { id: "allocation", category: "Allocation", label: "Allocation", description: allocation ? "Equal allocation is configured." : "Selection creates equal allocation.", availability: "unavailable", disabled: true, onAdd: () => undefined },
    { id: "schedule", category: "Timing", label: "Schedule", description: investment ? "Configure the Portfolio rebalance cadence." : "Add an Investment first.", availability: investment ? "ready" : "needs_context", disabled: !investment, onAdd: () => select("rebalance") },
    { id: "cooldown", category: "Behavior", label: "Cooldown", description: "Cooldown is not yet available for this Program profile.", availability: "unavailable", disabled: true, onAdd: () => undefined },
    { id: "fallback", category: "Behavior", label: "Fallback", description: selection ? "Choose the asset used when too few qualify." : "Choose assets first.", availability: selection ? "ready" : "needs_context", disabled: !selection, onAdd: () => selection && select(`fallback:${selection.semantic_id}`) },
  ];
  const blank = canonical.definitions.groups.length === 0 && draft === null;
  const structure = projectProgramProductStructure(canonical);
  const flow = projectProgramProductFlow(canonical);
  const selectedInvestment = selectedId?.startsWith("investment:") ? canonical.definitions.groups.find((group) => group.id === selectedId.slice("investment:".length)) : null;
  const inspector = draft?.kind === "selection" ? <SelectionDraftInspector strategy={canonical} initialUniverseId={investment?.id} withQualification={draft.withQualification} onComplete={(operation, investmentId) => applyProduct(operation, { investmentId, selectionId: draft.semanticId })} />
    : selectedId?.startsWith("assets:") ? <ProgramAssetsInspector strategy={canonical} assetSetId={selectedId.slice("assets:".length)} onAssets={(assets) => applyProduct({ kind: "setAssets", assets }, { assetSetId: selectedId.slice("assets:".length) })} />
        : selectedId?.startsWith("qualification:") && selectedSelection ? <ProgramQualificationInspector strategy={canonical} statement={selectedSelection} apply={apply} working={working} onDefault={() => applyProduct({ kind: "setQualification", lookback: 126, operator: "gt", threshold: 0 }, { selectionId: selectedSelection.semantic_id })} />
          : selectedId?.startsWith("fallback:") && selectedSelection ? <ProgramFallbackInspector statement={selectedSelection} onFallback={(asset) => applyProduct({ kind: "setFallback", asset }, { selectionId: selectedSelection.semantic_id })} />
            : selected ? <Inspector strategy={canonical} statement={selected} apply={apply} working={working} />
              : selectedId === "rebalance" && clock ? <ProgramScheduleInspector timeframe={clock.timeframe} onChange={(timeframe) => applyProduct({ kind: "setRebalance", cadence: timeframe })} />
                : selectedInvestment ? <div className="semantic-inspector-content"><h2>{selectedInvestment.name || "Investment"}</h2><p className="fixed-setting">Capital path · {portfolioSplit ? "part of Portfolio Split" : "100% of Portfolio"}</p><button type="button" className="secondary-button" onClick={() => select(`assets:${selectedInvestment.asset_set_ref}`)}>Edit Assets</button></div>
                  : selectedId === "split" ? <div className="semantic-inspector-content"><h2>Split</h2><p className="fixed-setting">Allocate Portfolio capital across Investments.</p><p>{portfolioSplit?.legs.map((leg) => `${canonical.definitions.groups.find((group) => group.id === leg.target.ref)?.name ?? "Investment"}: ${Number(leg.weight ?? 0) * 100}%`).join(" · ")}</p></div>
                    : <div className="semantic-inspector-content"><h2>Portfolio</h2><p>Select an investment object in Structure or add one from Add.</p></div>;
  const representations: Record<ProgramBuilderView, ReactNode> = {
    overview: <section className="representation-layer v2-summary"><span className="eyebrow">Strategy summary</span><h1>{canonical.metadata.name}</h1><p>{blank ? "A portfolio ready for its first investment." : selection ? `Choose ${selection.selection.count} assets from ${investmentAssets?.assets.join(", ") || "this investment"} by ${selection.selection.direction === "descending" ? "highest" : "lowest"} ${describeValueV2(selection.selection.ranking)}${selection.selection.fallback_asset ? `, with ${selection.selection.fallback_asset} as fallback` : ""}.` : "An investment ready for assets and selection rules."}</p></section>,
    blocky: <section className="representation-layer blocky-layer"><ProductBlockyProjection root={structure} selectedId={selectedId} onSelect={select} /></section>,
    flow: <section className="representation-layer v2-flow" aria-label="Flow capital projection">{flow.map((node) => <button type="button" key={node.id} className={node.role === "routing" || node.role === "behavior" ? "flow-routing-node" : node.role === "timing" ? "flow-action-node" : "flow-capital-node"} onClick={() => select(node.id)}><strong>{node.label}</strong>{node.detail && <small>{node.detail}</small>}</button>)}{blank && <p>No capital route has been defined yet.</p>}</section>,
    rules: <section className="representation-layer v2-rules" aria-label="Rules projection"><h2>Rules</h2>{blank ? <p>No strategy logic has been added yet.</p> : productStatements.map((item) => <p key={item.semantic_id}>{describeProgramStatement(item)}.</p>)}</section>,
    guided: <section className="representation-layer guide-representation" aria-label="Guided strategy editor"><header className="representation-intro"><span className="eyebrow">Guide</span><h1>How this strategy works</h1><p>Use the same recipes available throughout RuleTrade.</p></header>{blank ? <section className="guide-recipes" aria-label="Guided Strategy recipes"><button className="secondary-button" type="button" onClick={addInvestment}>One investment</button><button className="secondary-button" type="button" disabled>Choose assets · add an investment first</button><button className="secondary-button" type="button" disabled>Split a portfolio · add two investments first</button></section> : <div className="guide-sequence">{all.filter((item) => ["select", "control", "allocate"].includes(item.kind)).map((item) => <button className="guide-object" type="button" key={item.semantic_id} aria-pressed={selectedId === item.semantic_id} onClick={() => select(item.semantic_id)}><span>Strategy step</span><strong>{describeProgramStatement(item)}</strong></button>)}</div>}</section>,
    code: <section className="representation-layer code-representation" aria-label="Code representation"><header className="representation-intro"><span className="eyebrow">Code</span><h1>Canonical strategy</h1><p>Read-only developer representation. Editing remains in the shared Inspector.</p></header><pre className="code-metadata">{JSON.stringify(canonical, null, 2)}</pre></section>,
    ai: <section className="representation-layer ai-handoff-representation" aria-label="AI representation"><header className="representation-intro"><span className="eyebrow">AI handoff</span><h1>Bring your own AI</h1><p>Copy the committed semantic strategy for external analysis. Canonical changes still require validated authoring intents.</p></header><textarea aria-label="Context to copy for AI" readOnly rows={14} value={JSON.stringify({ format: "ruletrade.strategy-context/v1", strategy: canonical }, null, 2)} /></section>,
  };
  const authoringFeedback = status === "saved" ? null : message;
  return <StrategyBuilderWorkspace program={{ activeView: view, onViewChange: setView, leftPanel: <WorkspaceLeftPanel semanticProgram={{ tools, structure, selectedId, onSelect: (id) => select(id) }} />, representations, inspector, draftMessage: draft ? "Finish or discard the current semantic draft." : status === "unfinished" ? message : null, feedback: authoringFeedback, onUndo: undo, onRedo: redo, canUndo, canRedo, onDiscardDraft: draft ? () => { setDraft(null); working(false); } : undefined }} name={canonical.metadata.name} dirty={dirty} saving={status === "updating"} persisted onHome={onHome} onSave={save} onTest={run} onOpenAssets={() => { const selected = all.find((item) => item.kind === "select") as SelectionStatementV2 | undefined; if (selected) { const assets = assetSetForSelection(canonical, selected); select(`assets:${assets?.id ?? selected.selection.universe_id}`); } }} testDisabled={!executionCapability?.production_executable || status !== "saved"} testTitle={executionCapability?.product_message ?? "Checking whether this strategy is ready to test."} />;
}
