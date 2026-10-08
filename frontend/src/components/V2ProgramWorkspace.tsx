import { useEffect, useMemo, useState } from "react";
import type { CanonicalStrategyV2, ConditionV2, ProgramStatementV2, SelectionStatementV2, V2AuthoringOperation } from "../domain/canonicalV2";
import { describeProgramStatement, describeValueV2 } from "../domain/v2Semantics";
import { V2ConditionComposer, V2ProgramValueComposer } from "./V2SemanticComposer";
import { v2AuthoringApi, type V2AuthoringCapability } from "../v2AuthoringApi";
import "./V2ProgramWorkspace.css";

type View = "summary" | "flow" | "blocky" | "rules";

function flatten(items: ProgramStatementV2[]): ProgramStatementV2[] {
  return items.flatMap((item) => [
    item,
    ...(item.kind === "control" ? flatten([...item.then_statements, ...item.otherwise_statements]) : []),
    ...(item.kind === "on_event" ? flatten(item.statements) : []),
  ]);
}
function nextId(strategy: CanonicalStrategyV2, prefix: string): string {
  const used = new Set(flatten(strategy.program?.statements ?? []).map((item) => item.semantic_id));
  let n = used.size + 1;
  while (used.has(prefix + "-" + n)) n += 1;
  return prefix + "-" + n;
}
function selectionTemplate(strategy: CanonicalStrategyV2): SelectionStatementV2 {
  const id = nextId(strategy, "selection");
  const universe = strategy.definitions.groups[0]?.id ?? strategy.definitions.asset_sets[0]?.id ?? "assets";
  const binding = id + "-candidate";
  return {
    kind: "select", semantic_id: id, output_id: id + "-output", clock_id: "daily-close",
    selection: {
      semantic_id: id + "-definition", universe_id: universe,
      binding: { id: binding, domain_id: universe }, eligibility: null,
      ranking: {
        semantic_id: id + "-ranking", kind: "trailing_return", observations: 126,
        operands: [{ semantic_id: id + "-close", kind: "observe", operands: [], subject_kind: "candidate", binding_id: binding, subject_id: null, field: "close", basis: "adjusted", skip: 0, missing_policy: "require_all", minimum_count: 1, minimum_fraction: 1 }],
        skip: 0, missing_policy: "require_all", minimum_count: 1, minimum_fraction: 1,
      },
      direction: "descending", count: 1, shortage_policy: "choose_all", fallback_asset: null,
    },
  };
}
function literalCondition(id: string): ConditionV2 {
  return { kind: "comparison", semantic_id: id, operator: "gt", left: { semantic_id: id + "-left", kind: "literal", operands: [], value: 1, quantity: "ratio", unit: "decimal", skip: 0, missing_policy: "require_all", minimum_count: 1, minimum_fraction: 1 }, right: { semantic_id: id + "-right", kind: "literal", operands: [], value: 0, quantity: "ratio", unit: "decimal", skip: 0, missing_policy: "require_all", minimum_count: 1, minimum_fraction: 1 } };
}
function retainAllocation(strategy: CanonicalStrategyV2, prefix = "allocation"): ProgramStatementV2 {
  const id = nextId(strategy, prefix);
  return { kind: "allocate", semantic_id: id, method: "equal", legs: [{ semantic_id: id + "-leg", target: { semantic_id: id + "-target", kind: "retain", ref: null }, weight: null }], clock_id: "daily-close", minimum_weight: null, maximum_weight: null, cash_remainder_asset: null };
}
function fixedAllocation(strategy: CanonicalStrategyV2, id: string, kind: "asset" | "cash" = "asset") {
  const asset = strategy.definitions.asset_sets[0]?.assets[0] ?? "SPY";
  return { kind: "allocate" as const, semantic_id: id, method: "fixed" as const, legs: [{ semantic_id: id + "-leg", target: { semantic_id: id + "-target", kind, ref: kind === "asset" ? asset : null }, weight: 1 }], clock_id: "daily-close", minimum_weight: null, maximum_weight: null, cash_remainder_asset: null };
}

function Inspector({ strategy, statement, apply, working }: {
  strategy: CanonicalStrategyV2; statement: ProgramStatementV2;
  apply: (operation: V2AuthoringOperation) => void; working: (unfinished: boolean) => void;
}) {
  if (statement.kind === "select") {
    const selection = statement.selection;
    const set = (next: typeof selection) => apply({ kind: "set_program_selection", semantic_id: statement.semantic_id, selection: next });
    return <div className="semantic-inspector-content"><h2>Choose {selection.count}</h2>
      <section><h3>FROM</h3><select value={selection.universe_id} onChange={(event) => { const universe_id = event.target.value; set({ ...selection, universe_id, binding: { ...selection.binding, domain_id: universe_id } }); }}>{strategy.definitions.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}{strategy.definitions.asset_sets.map((set) => <option key={set.id} value={set.id}>{set.id}</option>)}</select></section>
      <section><h3>WHERE</h3>{selection.eligibility ? <V2ConditionComposer condition={selection.eligibility} strategy={strategy} role="eligibility" onWorking={working} onChange={(condition) => apply({ kind: "set_program_condition", semantic_id: statement.semantic_id, role: "selection_eligibility", condition })} /> : <p>All candidates qualify</p>}</section>
      <section><h3>ORDER / SCORE</h3><V2ProgramValueComposer value={selection.ranking} strategy={strategy} role="ranking" onWorking={working} onChange={(value) => apply({ kind: "set_program_value", semantic_id: statement.semantic_id, role: "selection_ranking", value })} /></section>
      <section><h3>DIRECTION</h3><select value={selection.direction} onChange={(event) => set({ ...selection, direction: event.target.value as typeof selection.direction })}><option value="descending">Highest first</option><option value="ascending">Lowest first</option></select></section>
      <section><h3>TAKE</h3><input type="number" min={1} max={100} defaultValue={selection.count} onBlur={(event) => set({ ...selection, count: Number(event.target.value) })} /></section>
      <section><h3>WHEN FEWER QUALIFY</h3><select value={selection.shortage_policy} onChange={(event) => set({ ...selection, shortage_policy: event.target.value as typeof selection.shortage_policy })}><option value="require_full">Require full count</option><option value="choose_all">Choose all eligible</option></select></section>
      <section><h3>SELECTION FALLBACK</h3><input aria-label="Fallback asset" defaultValue={selection.fallback_asset ?? ""} onBlur={(event) => set({ ...selection, fallback_asset: event.target.value.trim().toUpperCase() || null })} /></section>
    </div>;
  }
  if (statement.kind === "control") return <div className="semantic-inspector-content"><h2>Condition routing</h2><V2ConditionComposer condition={statement.condition} strategy={strategy} role="predicate" onWorking={working} onChange={(condition) => apply({ kind: "set_program_condition", semantic_id: statement.semantic_id, role: "control", condition })} /></div>;
  if (statement.kind === "on_event") {
    const set = (event: typeof statement.event) => apply({ kind: "set_program_event", semantic_id: statement.semantic_id, event });
    return <div className="semantic-inspector-content"><h2>Event</h2><label>Clock<select value={statement.event.clock_id} onChange={(event) => set({ ...statement.event, clock_id: event.target.value })}>{strategy.program?.clocks.map((clock) => <option key={clock.id} value={clock.id}>{clock.timeframe} close</option>)}</select></label><label>Trigger<select value={statement.event.trigger} onChange={(event) => { const trigger = event.target.value as typeof statement.event.trigger; set({ ...statement.event, trigger, condition: trigger === "scheduled" ? null : statement.event.condition ?? literalCondition(statement.event.semantic_id + "-condition") }); }}><option value="rising_edge">Rising edge</option><option value="falling_edge">Falling edge</option><option value="crosses_above">Crosses above</option><option value="crosses_below">Crosses below</option><option value="became_true">Became true</option><option value="became_false">Became false</option><option value="while_true">While true</option><option value="scheduled">Scheduled</option></select></label><label>Occurrence<select value={statement.event.occurrence} onChange={(event) => { const occurrence = event.target.value as typeof statement.event.occurrence; set({ ...statement.event, occurrence, ordinal: occurrence === "ordinal" ? statement.event.ordinal ?? 1 : null }); }}><option value="every">Every</option><option value="first">First</option><option value="ordinal">Ordinal</option></select></label>{statement.event.occurrence === "ordinal" && <label>Occurrence number<input type="number" min={1} max={10000} defaultValue={statement.event.ordinal ?? 1} onBlur={(event) => set({ ...statement.event, ordinal: Number(event.target.value) })} /></label>}{statement.event.condition && <V2ConditionComposer condition={statement.event.condition} strategy={strategy} role="predicate" onWorking={working} onChange={(condition) => apply({ kind: "set_program_condition", semantic_id: statement.semantic_id, role: "event", condition })} />}</div>;
  }
  if (statement.kind === "transition") { const set = (transition: typeof statement.transition) => apply({ kind: "set_program_transition", semantic_id: statement.semantic_id, transition }); return <div className="semantic-inspector-content"><h2>State transition</h2><label>State name<input defaultValue={statement.transition.state_key} onBlur={(event) => set({ ...statement.transition, state_key: event.target.value.trim() })} /></label><label>From<input defaultValue={statement.transition.from_value ?? ""} placeholder="Any state" onBlur={(event) => set({ ...statement.transition, from_value: event.target.value.trim() || null })} /></label><label>To<input defaultValue={statement.transition.to_value} onBlur={(event) => set({ ...statement.transition, to_value: event.target.value.trim() })} /></label><label>Clock<select value={statement.transition.clock_id ?? ""} onChange={(event) => set({ ...statement.transition, clock_id: event.target.value || null })}><option value="">Program clock</option>{strategy.program?.clocks.map((clock) => <option key={clock.id} value={clock.id}>{clock.timeframe} close</option>)}</select></label><V2ConditionComposer condition={statement.transition.when} strategy={strategy} role="predicate" onWorking={working} onChange={(condition) => apply({ kind: "set_program_condition", semantic_id: statement.semantic_id, role: "transition", condition })} /></div>; }
  if (statement.kind === "remember_value") return <div className="semantic-inspector-content"><h2>Remembered Value</h2><p>{statement.memory_id}</p><V2ProgramValueComposer value={statement.value} strategy={strategy} role="predicate" onWorking={working} onChange={(value) => apply({ kind: "set_program_value", semantic_id: statement.semantic_id, role: "remembered_value", value })} /></div>;
  if (statement.kind === "allocate") {
    const selectionOutput = flatten(strategy.program?.statements ?? []).find((item) => item.kind === "select");
    const update = (allocation: typeof statement) => apply({ kind: "set_program_allocation", semantic_id: statement.semantic_id, role: "statement", allocation });
    const changeMethod = (method: typeof statement.method) => {
      if (method === "proportional_score" || method === "inverse_volatility") {
        if (!selectionOutput || selectionOutput.kind !== "select") { working(true); return; }
        update({ ...statement, method, legs: [{ semantic_id: statement.semantic_id + "-selection-leg", target: { semantic_id: statement.semantic_id + "-selection-target", kind: "selection", ref: selectionOutput.output_id }, weight: null }] });
        return;
      }
      const firstAsset = strategy.definitions.asset_sets[0]?.assets[0] ?? "SPY";
      const legs = method === "fixed" && statement.legs.some((leg) => leg.target.kind === "retain")
        ? [{ semantic_id: statement.semantic_id + "-asset-leg", target: { semantic_id: statement.semantic_id + "-asset-target", kind: "asset" as const, ref: firstAsset }, weight: 1 }]
        : statement.legs.map((leg, index) => ({ ...leg, weight: method === "fixed" ? (index === 0 ? 1 : 0) : null }));
      update({ ...statement, method, legs, minimum_weight: null, maximum_weight: null, cash_remainder_asset: null });
    };
    return <div className="semantic-inspector-content"><h2>Allocation</h2><label>Method<select value={statement.method} onChange={(event) => changeMethod(event.target.value as typeof statement.method)}><option value="equal">Equal weight</option><option value="fixed">Fixed weight</option><option value="proportional_score">Proportional to score</option><option value="inverse_volatility">Inverse volatility</option></select></label><p>{statement.legs.map((leg) => leg.target.kind === "retain" ? "Retain current holdings" : (leg.target.ref ?? leg.target.kind)).join(" · ")}</p>{(statement.method === "proportional_score" || statement.method === "inverse_volatility") && <><label>Floor<input type="number" min={0} max={1} step="0.01" defaultValue={statement.minimum_weight ?? ""} onBlur={(event) => update({ ...statement, minimum_weight: event.target.value === "" ? null : Number(event.target.value) })} /></label><label>Cap<input type="number" min={0} max={1} step="0.01" defaultValue={statement.maximum_weight ?? ""} onBlur={(event) => update({ ...statement, maximum_weight: event.target.value === "" ? null : Number(event.target.value) })} /></label><label>Cash remainder<input defaultValue={statement.cash_remainder_asset ?? ""} onBlur={(event) => update({ ...statement, cash_remainder_asset: event.target.value.trim().toUpperCase() || null })} /></label></>}</div>;
  }
  if (statement.kind === "guarded_allocation") return <div className="semantic-inspector-content"><h2>Policy precedence</h2><p>Guard → priority override → primary → fallback → retain</p><section><h3>GUARD</h3>{statement.guard ? <V2ConditionComposer condition={statement.guard} strategy={strategy} role="predicate" onWorking={working} onChange={(condition) => apply({ kind: "set_program_condition", semantic_id: statement.semantic_id, role: "guard", condition })} /> : <p>No guard</p>}</section><section><h3>PRIMARY</h3><p>{statement.primary.method.replace("_", " ")}</p></section>{statement.overrides.map((override) => <section key={override.semantic_id}><h3>OVERRIDE · PRIORITY {override.priority}</h3><V2ConditionComposer condition={override.when} strategy={strategy} role="predicate" onWorking={working} onChange={(condition) => apply({ kind: "set_program_condition", semantic_id: statement.semantic_id, role: "override", override_semantic_id: override.semantic_id, condition })} /><p>Outcome: {override.action.legs[0]?.target.kind === "retain" ? "retain current holdings" : override.action.method}</p></section>)}<section><h3>FALLBACK</h3><p>{statement.fallback ? statement.fallback.legs.map((leg) => leg.target.kind).join(" · ") : "Retain current holdings"}</p></section></div>;
  if (statement.kind === "unresolved") { const replacement = retainAllocation(strategy, statement.semantic_id + "-formalized"); return <div className="semantic-inspector-content"><h2>Needs a precise definition</h2><blockquote>{statement.source_text}</blockquote><p className="form-error">{statement.reason}</p><button type="button" onClick={() => apply({ kind: "formalize_program_statement", semantic_id: statement.semantic_id, replacement, interpretation: "Explicitly retain current holdings until a supported Condition is configured." })}>Formalize as explicit retain policy</button><p className="value-capability-note">The original phrase remains in formalization provenance.</p></div>; }
  return <div className="semantic-inspector-content"><h2>{describeProgramStatement(statement)}</h2></div>;
}

export function V2ProgramWorkspace({ canonical, dirty, status, message, onHome, apply, save, undo, redo, canUndo, canRedo, working }: {
  canonical: CanonicalStrategyV2; dirty: boolean; status: "saved" | "updating" | "invalid" | "unfinished"; message: string;
  onHome: () => void; apply: (operation: V2AuthoringOperation) => void; save: () => void;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean; working: (unfinished: boolean) => void;
}) {
  const [view, setView] = useState<View>("blocky");
  const all = useMemo(() => flatten(canonical.program?.statements ?? []), [canonical.program]);
  const [selectedId, setSelectedId] = useState(all[0]?.semantic_id ?? null);
  const [draftPhrase, setDraftPhrase] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<V2AuthoringCapability[]>([]);
  const selected = all.find((item) => item.semantic_id === selectedId) ?? all[0] ?? null;
  const unresolved = all.filter((item) => item.kind === "unresolved");
  useEffect(() => {
    if (draftPhrase && canonical.program?.formalizations?.some((item) => item.source_phrase === draftPhrase && item.status === "formalized")) {
      setDraftPhrase(null); working(false);
    }
  }, [canonical.program?.formalizations, draftPhrase, working]);
  useEffect(() => { let current = true; void v2AuthoringApi.capabilities().then((items) => { if (current) setCapabilities(items); }).catch(() => undefined); return () => { current = false; }; }, []);
  const volumeCapability = capabilities.find((item) => item.operation_id === "daily.volume_raw_shares@1");
  const programCapability = capabilities.find((item) => item.operation_id === "program.event@1");
  const rootIndex = canonical.program?.statements.findIndex((item) => item.semantic_id === selectedId) ?? -1;
  const add = (statement: ProgramStatementV2) => apply({ kind: "insert_program_statement", statement, parent_semantic_id: null, branch: "root", index: null });
  const addControl = () => { const id = nextId(canonical, "control"); add({ kind: "control", semantic_id: id, condition: literalCondition(id + "-condition"), then_statements: [retainAllocation(canonical, id + "-retain")], otherwise_statements: [], unknown_policy: "retain", clock_id: "daily-close" }); };
  const addEvent = () => { const id = nextId(canonical, "event"); add({ kind: "on_event", semantic_id: id, event: { semantic_id: id + "-definition", clock_id: "daily-close", condition: literalCondition(id + "-condition"), trigger: "rising_edge", occurrence: "every", ordinal: null }, statements: [retainAllocation(canonical, id + "-retain")] }); };
  const addTransition = () => { const id = nextId(canonical, "transition"); add({ kind: "transition", semantic_id: id, transition: { semantic_id: id + "-definition", state_key: "regime", from_value: null, to_value: "active", when: literalCondition(id + "-condition"), clock_id: "daily-close" } }); };
  const addRemembered = () => { const id = nextId(canonical, "remember"); const asset = canonical.definitions.asset_sets[0]?.assets[0] ?? "SPY"; add({ kind: "remember_value", semantic_id: id, memory_id: id + "-value", clock_id: "daily-close", value: { semantic_id: id + "-observed", kind: "observe", operands: [], subject_kind: "asset", subject_id: asset, binding_id: null, field: "close", basis: "adjusted", skip: 0, missing_policy: "require_all", minimum_count: 1, minimum_fraction: 1 } }); };
  const addPolicy = () => { const id = nextId(canonical, "policy"); const retained = retainAllocation(canonical, id + "-override"); if (retained.kind !== "allocate") return; add({ kind: "guarded_allocation", semantic_id: id, guard: literalCondition(id + "-guard"), primary: fixedAllocation(canonical, id + "-primary"), overrides: [{ semantic_id: id + "-no-trade", priority: 100, when: literalCondition(id + "-override-condition"), action: retained }], fallback: fixedAllocation(canonical, id + "-fallback", "cash"), unknown_guard_policy: "block" }); };
  return <section className="strategy-builder-workspace v2-program-workspace" data-canonical-version="v2" data-program-native="true">
    <header className="builder-chrome"><button className="builder-brand" aria-label="Back to Home" onClick={onHome}><span className="brand-mark">R</span></button>
      <div className="representation-switcher" aria-label="Strategy representation">{(["summary", "flow", "blocky", "rules"] as View[]).map((item) => <button key={item} aria-pressed={view === item} onClick={() => setView(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div>
      <div className="builder-identity"><strong>{canonical.metadata.name}</strong><small>{dirty ? "Unsaved Program changes" : "Saved Program"}</small></div>
      <div className="builder-actions"><button type="button" onClick={undo} disabled={!canUndo}>Undo</button><button type="button" onClick={redo} disabled={!canRedo}>Redo</button><button className="secondary-button" disabled={!dirty || status !== "saved"} onClick={save}>Save</button><button className="primary-button" disabled title="Program Event, State, and policy lowering is reference-only.">Test ▶</button></div>
    </header>
    <div className="builder-messages"><div className={"semantic-edit-feedback " + status} role="status">{message}</div><p className="value-capability-note">Reference-valid Program · production execution unavailable{unresolved.length ? " · unresolved concepts must be formalized" : ""}.</p></div>
    <div className="builder-core inspector-open"><nav className="workspace-left-panel program-toolbox" aria-label="Program toolbox"><h2>Add</h2><section><h3>Assets</h3><button type="button" onClick={() => add(selectionTemplate(canonical))}>Selection</button></section><section><h3>Decision</h3><button type="button" onClick={addControl}>Condition route</button><button type="button" onClick={addEvent}>Event</button><button type="button" onClick={addTransition}>State transition</button><button type="button" onClick={addRemembered}>Remember Value</button></section><section><h3>Capital</h3><button type="button" onClick={() => add(retainAllocation(canonical))}>Retain allocation</button><button type="button" onClick={addPolicy}>Guard / Override / Fallback</button></section><section><h3>Behavior</h3><button type="button" onClick={() => { setDraftPhrase("strong breakout"); setSelectedId("draft-unresolved"); working(true); }}>Unresolved idea</button></section><section><h3>Capability</h3><small>Volume · {volumeCapability?.reason ?? "provider unavailable"}</small><small>Event/State execution · {programCapability?.semantic_status?.replace("_", "-") ?? "reference-only"}</small></section></nav>
      <main className="representation-workspace">
        {view === "blocky" && <section className="representation-layer v2-blocky" aria-label="Blocky semantic Program">{canonical.program?.statements.map((item) => <button type="button" key={item.semantic_id} className="blocky-program-card" aria-pressed={selected?.semantic_id === item.semantic_id} onClick={() => setSelectedId(item.semantic_id)}><strong>{describeProgramStatement(item)}</strong><small>{item.semantic_id}</small></button>)}{draftPhrase && <button type="button" className="blocky-program-card draft" aria-pressed={selectedId === "draft-unresolved"} onClick={() => setSelectedId("draft-unresolved")}><strong>Needs definition: {draftPhrase}</strong><small>Working draft · not Canonical</small></button>}</section>}
        {view === "flow" && <section className="representation-layer v2-flow" aria-label="Flow capital projection"><div className="flow-capital-node">Portfolio capital</div>{all.filter((item) => ["select", "allocate", "control", "guarded_allocation"].includes(item.kind)).map((item) => <button type="button" key={item.semantic_id} className={item.kind === "select" || item.kind === "control" ? "flow-routing-node" : "flow-capital-node"} onClick={() => setSelectedId(item.semantic_id)}>{describeProgramStatement(item)}</button>)}<div className="flow-action-node">Target / Rebalance</div></section>}
        {view === "rules" && <section className="representation-layer v2-rules" aria-label="Rules Program projection"><h2>Program rules</h2>{all.map((item) => <p key={item.semantic_id}>{describeProgramStatement(item)}.</p>)}</section>}
        {view === "summary" && <section className="representation-layer v2-summary"><span className="eyebrow">Semantic Program</span><h1>{canonical.metadata.name}</h1><p>{all.length} semantic statements · {unresolved.length ? unresolved.length + " need formalization" : "all meanings formalized"}.</p></section>}
      </main>
      <aside className="semantic-inspector v2-program-inspector" aria-label="Semantic Inspector"><header><span className="eyebrow">Program</span>{rootIndex >= 0 && <span className="program-order-actions"><button type="button" disabled={rootIndex === 0} onClick={() => selected && apply({ kind: "move_program_statement", semantic_id: selected.semantic_id, parent_semantic_id: null, branch: "root", index: rootIndex - 1 })}>Move up</button><button type="button" disabled={rootIndex >= (canonical.program?.statements.length ?? 1) - 1} onClick={() => selected && apply({ kind: "move_program_statement", semantic_id: selected.semantic_id, parent_semantic_id: null, branch: "root", index: rootIndex + 1 })}>Move down</button></span>}{selectedId === "draft-unresolved" && draftPhrase ? <button type="button" className="text-button danger" onClick={() => { setDraftPhrase(null); setSelectedId(all[0]?.semantic_id ?? null); working(false); }}>Discard draft</button> : selected && <button type="button" className="text-button danger" onClick={() => apply({ kind: "remove_program_statement", semantic_id: selected.semantic_id })}>Remove</button>}</header>{selectedId === "draft-unresolved" && draftPhrase ? <div className="semantic-inspector-content"><h2>This idea needs a precise definition</h2><label>Original phrase<input value={draftPhrase} onChange={(event) => setDraftPhrase(event.target.value)} /></label><p>It is not Canonical, cannot appear in Rules, and blocks Save/Test.</p><button type="button" onClick={() => { const replacement = retainAllocation(canonical, "formalized-policy"); apply({ kind: "formalize_draft_phrase", source_phrase: draftPhrase, replacement, interpretation: "Explicit retain-holdings policy configured by the user.", parent_semantic_id: null, branch: "root", index: null }); }}>Formalize as explicit retain policy</button></div> : selected ? <Inspector strategy={canonical} statement={selected} apply={apply} working={working} /> : <div className="semantic-inspector-content"><p>Select a Program statement.</p></div>}</aside>
    </div>
  </section>;
}

