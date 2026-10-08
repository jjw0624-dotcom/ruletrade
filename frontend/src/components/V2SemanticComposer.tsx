import { useEffect, useMemo, useState, type ReactNode } from "react";
import { isDailyValue, type CanonicalStrategyV2, type ComparisonV2, type ConditionV2, type DailyValueNode, type ValueExpressionV2 } from "../domain/canonicalV2";
import { describeConditionV2, describeDailyValue, describeValueV2 } from "../domain/v2Semantics";

type Role = "predicate" | "eligibility" | "ranking";
type Operation = "observe" | "trailing_return" | "sma" | "ema" | "rsi_wilder_lean_compat" | "realized_volatility";

function findObserve(value: DailyValueNode): DailyValueNode | null {
  if (value.kind === "observe") return value;
  return value.operands[0] ? findObserve(value.operands[0]) : null;
}

function withSubject(base: DailyValueNode, subject: "candidate" | "asset" | "group_members", id: string): DailyValueNode {
  return {
    ...base,
    subject_kind: subject,
    binding_id: subject === "candidate" ? id : null,
    subject_id: subject === "candidate" ? null : id,
  };
}

function buildValue(current: DailyValueNode, operation: Operation, subject: DailyValueNode, observations: number): DailyValueNode {
  if (operation === "observe") return { ...subject, semantic_id: current.semantic_id };
  return {
    semantic_id: current.semantic_id,
    kind: operation,
    operands: [subject],
    observations,
    skip: 0,
    missing_policy: "require_all",
    minimum_count: 1,
    minimum_fraction: 1,
  };
}

export function V2ValueComposer({ value, strategy, role, literal, onChange, onWorking }: {
  value: DailyValueNode;
  strategy: CanonicalStrategyV2;
  role: Role;
  literal?: boolean;
  onChange: (value: DailyValueNode) => void;
  onWorking?: (unfinished: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const observe = findObserve(value);
  const operation = (value.kind === "current" ? "observe" : value.kind) as Operation;
  const [draft, setDraft] = useState(String(value.observations ?? 20));
  const assets = useMemo(() => Array.from(new Set(strategy.definitions.asset_sets.flatMap((item) => item.assets))), [strategy]);
  if (literal || value.kind === "literal") {
    return <label className="v2-literal-value"><span>Value</span><input type="number" value={String(value.value ?? "")}
      aria-label={`Edit ${describeDailyValue(value)}`}
      onChange={(event) => { setDraft(event.target.value); onWorking?.(true); }}
      onBlur={() => {
        const numeric = Number(draft);
        if (!Number.isFinite(numeric)) return;
        onChange({ ...value, value: numeric }); onWorking?.(false);
      }} /></label>;
  }
  const programSelection = strategy.program?.statements.find((item) => item.kind === "select");
  const bindingId = strategy.selection?.binding.id ?? (programSelection?.kind === "select" ? programSelection.selection.binding.id : "candidate");
  const subjectKind = observe?.subject_kind ?? (role === "eligibility" || role === "ranking" ? "candidate" : "asset");
  const subjectId = subjectKind === "candidate" ? bindingId : observe?.subject_id ?? assets[0] ?? "";
  const subject: DailyValueNode = observe ?? {
    semantic_id: `${value.semantic_id}-source`,
    kind: "observe",
    operands: [],
    subject_kind: subjectKind,
    subject_id: subjectKind === "candidate" ? null : subjectId,
    binding_id: subjectKind === "candidate" ? subjectId : null,
    field: "close",
    basis: "adjusted",
    skip: 0,
    missing_policy: "require_all",
    minimum_count: 1,
    minimum_fraction: 1,
  };
  const emit = (nextOperation: Operation, nextSubject = subject, observations = Number(draft || value.observations || 20)) => {
    if (!Number.isInteger(observations) || observations < 1 || observations > 2000) { onWorking?.(true); return; }
    onChange(buildValue(value, nextOperation, nextSubject, observations)); onWorking?.(false);
  };
  return <div className="v2-value-composer">
    <button type="button" className="semantic-value-row" aria-expanded={open} aria-label={`Edit value: ${describeDailyValue(value)}`} onClick={() => setOpen(!open)}>
      <span>{describeDailyValue(value)}</span><small>{open ? "Done" : "Edit"}</small>
    </button>
    {open && <div className="value-editor">
      <fieldset><legend>What is this value about?</legend><div className="semantic-choice-row">
        {(role === "eligibility" || role === "ranking") && <button type="button" aria-pressed={subjectKind === "candidate"} onClick={() => emit(operation, withSubject(subject, "candidate", bindingId))}>Current candidate</button>}
        <button type="button" aria-pressed={subjectKind === "asset"} onClick={() => emit(operation, withSubject(subject, "asset", assets[0] ?? ""))}>Specific asset</button>
        <button type="button" disabled title="Reference-evaluable; production Strategy lowering is not closed yet.">Static Group members</button>
      </div></fieldset>
      {subjectKind === "asset" && <label>Asset<select value={subjectId} onChange={(event) => emit(operation, withSubject(subject, "asset", event.target.value))}>{assets.map((asset) => <option key={asset}>{asset}</option>)}</select></label>}
      {subjectKind === "group_members" && <label>Group<select value={subjectId} onChange={(event) => emit(operation, withSubject(subject, "group_members", event.target.value))}>{strategy.definitions.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}
      <label>Value<select value={operation} onChange={(event) => emit(event.target.value as Operation)}>
        <option value="observe">Current adjusted close</option>
        <option value="trailing_return">Trailing return</option>
        <option value="sma">SMA</option>
        <option disabled>EMA — reference only</option>
        <option disabled>RSI — reference only</option>
        <option disabled>Realized volatility — reference only</option>
        <option disabled>Volume — unavailable with current data source</option>
        <option disabled>Raw OHLC — unavailable with current data source</option>
      </select></label>
      {operation !== "observe" && <label>Observations<input type="number" min={1} max={2000} value={draft}
        onChange={(event) => { setDraft(event.target.value); onWorking?.(true); }}
        onBlur={() => emit(operation)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>}
      <p className="value-capability-note">Only adjusted-close Values verified against the maintained runtime are authorable.</p>
    </div>}
  </div>;
}

function scoreCondition(id: string): ConditionV2 {
  const left: DailyValueNode = { semantic_id: id + "-left", kind: "literal", operands: [], value: 1, quantity: "score", unit: "points", refinement: "score", skip: 0, missing_policy: "require_all", minimum_count: 1, minimum_fraction: 1 };
  return { kind: "comparison", semantic_id: id, operator: "gt", left, right: { ...left, semantic_id: id + "-right", value: 0 } };
}

export function V2ProgramValueComposer({ value, strategy, role, onChange, onWorking }: {
  value: ValueExpressionV2; strategy: CanonicalStrategyV2; role: Role;
  onChange: (value: ValueExpressionV2) => void; onWorking?: (unfinished: boolean) => void;
}) {
  const domains = strategy.definitions.groups;
  if (isDailyValue(value)) return <div className="program-value-composer">
    <V2ValueComposer value={value} strategy={strategy} role={role} onChange={onChange} onWorking={onWorking} />
    <details className="semantic-subeditor"><summary>Add semantic operation</summary><div className="semantic-choice-row">
      <button type="button" disabled title="Reference-evaluable; production lowering is not closed.">Rank across members</button>
      <button type="button" disabled title="Reference-evaluable; production lowering is not closed.">Median across members</button>
      <button type="button" disabled title="Reference-evaluable; production lowering is not closed.">Use as score</button>
      <button type="button" disabled title="Only scalar multiplication is production-lowerable.">Add arithmetic</button>
      <button type="button" disabled title="Reference-evaluable; production lowering is not closed.">Absolute value</button>
    </div></details>
  </div>;
  if (value.kind === "cross_sectional") return <div className="program-value-composer"><p className="fixed-setting">{describeValueV2(value)}</p>
    <label>Across<select value={value.domain_id} onChange={(event) => onChange({ ...value, domain_id: event.target.value })}>{domains.map((domain) => <option key={domain.id} value={domain.id}>{domain.name}</option>)}</select></label>
    <label>Transform<select value={value.transform} onChange={(event) => { const transform = event.target.value as typeof value.transform; onChange({ ...value, transform, bins: transform === "quantile" || transform === "bucket" ? value.bins ?? 5 : null }); }}><option value="rank">Rank</option><option value="percentile">Percentile</option><option value="quantile">Quantile</option><option value="bucket">Bucket</option><option value="min_max">Min-max normalization</option><option value="zscore">Z-score</option></select></label>
    {(value.transform === "quantile" || value.transform === "bucket") && <label>Buckets<input type="number" min={2} max={100} defaultValue={value.bins ?? 5} onBlur={(event) => onChange({ ...value, bins: Number(event.target.value) })} /></label>}
    <button type="button" className="text-button" onClick={() => onChange(value.source)}>Remove cross-sectional transform</button>
  </div>;
  if (value.kind === "score") return <div className="program-value-composer"><p className="fixed-setting">{describeValueV2(value)}</p>{value.terms.map((term, index) => <section key={term.semantic_id} className="score-term"><span>{describeValueV2(term.value)}</span><label>Weight<input type="number" step="0.05" defaultValue={String(term.weight)} onBlur={(event) => onChange({ ...value, terms: value.terms.map((item, position) => position === index ? { ...item, weight: Number(event.target.value) } : item) })} /></label><button type="button" className="text-button danger" disabled={value.terms.length + value.condition_terms.length === 1} onClick={() => onChange({ ...value, terms: value.terms.filter((_, position) => position !== index) })}>Remove term</button></section>)}{value.condition_terms.map((term, index) => <section key={term.semantic_id} className="score-term"><V2ConditionComposer condition={term.condition} strategy={strategy} role={role === "ranking" ? "eligibility" : "predicate"} onWorking={onWorking} onChange={(condition) => onChange({ ...value, condition_terms: value.condition_terms.map((item, position) => position === index ? { ...item, condition } : item) })} /><label>True points<input type="number" defaultValue={String(term.true_points)} onBlur={(event) => onChange({ ...value, condition_terms: value.condition_terms.map((item, position) => position === index ? { ...item, true_points: Number(event.target.value) } : item) })} /></label></section>)}
    <label>Missing terms<select value={value.missing_policy} onChange={(event) => onChange({ ...value, missing_policy: event.target.value as typeof value.missing_policy })}><option value="require_all">Require all</option><option value="renormalize_available">Renormalize available</option></select></label>
    <label>Normalization<select value={value.normalization} onChange={(event) => onChange({ ...value, normalization: event.target.value as typeof value.normalization })}><option value="none">None</option><option value="sum_abs">Normalize absolute weights</option></select></label>
    <div className="semantic-choice-row"><button type="button" disabled={!value.terms[0]} onClick={() => { const source = value.terms[0]?.value; if (source) onChange({ ...value, terms: [...value.terms, { semantic_id: value.semantic_id + "-term-" + (value.terms.length + 1), value: { ...source, semantic_id: value.semantic_id + "-source-" + (value.terms.length + 1) }, weight: 1 }] }); }}>+ Value term</button><button type="button" onClick={() => { const id = value.semantic_id + "-points-" + (value.condition_terms.length + 1); onChange({ ...value, condition_terms: [...value.condition_terms, { semantic_id: id, condition: scoreCondition(id + "-condition"), true_points: 1, false_points: 0, unknown_points: null }] }); }}>+ Condition points</button></div>
  </div>;
  return <div className="program-value-composer"><p className="fixed-setting">{describeValueV2(value)}</p><p className="value-capability-note">This typed Value is reference-capable and preserved by semantic identity.</p></div>;
}


export function V2ConditionComposer({ condition, strategy, role, onChange, onWorking }: {
  condition: ConditionV2;
  strategy: CanonicalStrategyV2;
  role: "predicate" | "eligibility";
  onChange: (condition: ConditionV2) => void;
  onWorking?: (unfinished: boolean) => void;
}) {
  const [active, setActive] = useState<string | null>(null);
  const nested = (item: ConditionV2): ConditionV2 => ({ ...item, semantic_id: item.semantic_id + "-child" });
  const grouped = (kind: "all" | "any" | "n_of_m"): ConditionV2 => {
    const children = "children" in condition ? condition.children : [nested(condition)];
    return kind === "n_of_m" ? { kind, semantic_id: condition.semantic_id, minimum_true: Math.min(1, children.length), children } : { kind, semantic_id: condition.semantic_id, children };
  };
  const comparisonSeed = (item: ConditionV2): ComparisonV2 | null => item.kind === "comparison" ? item : item.kind === "not" ? comparisonSeed(item.child) : "children" in item ? comparisonSeed(item.children[0]) : null;
  const clonedComparison = (group: Extract<ConditionV2, { children: ConditionV2[] }>): ComparisonV2 | null => {
    const seed = comparisonSeed(group);
    if (!seed) return null;
    const id = `${group.semantic_id}-condition-${group.children.length + 1}`;
    return { ...seed, semantic_id: id, left: { ...seed.left, semantic_id: id + "-left" }, right: { ...seed.right, semantic_id: id + "-right" } };
  };
  const comparison = (item: ComparisonV2) => <div className="condition-comparison-row" key={item.semantic_id}>
    <button type="button" className="semantic-value-row" aria-expanded={active === `${item.semantic_id}:left`} onClick={() => setActive(active === `${item.semantic_id}:left` ? null : `${item.semantic_id}:left`)}>{describeValueV2(item.left)}</button>
    <select aria-label="Comparison operator" value={item.operator} onChange={(event) => onChange({ ...item, operator: event.target.value as ComparisonV2["operator"] })}><option value="gt">&gt;</option><option value="gte">≥</option><option value="lt">&lt;</option><option value="lte">≤</option><option value="eq" disabled>= — reference only</option><option value="neq" disabled>≠ — reference only</option></select>
    <button type="button" className="semantic-value-row" aria-expanded={active === `${item.semantic_id}:right`} onClick={() => setActive(active === `${item.semantic_id}:right` ? null : `${item.semantic_id}:right`)}>{describeValueV2(item.right)}</button>
    {active === `${item.semantic_id}:left` && (isDailyValue(item.left)
      ? <V2ValueComposer value={item.left} strategy={strategy} role={role} onWorking={onWorking} onChange={(left) => onChange({ ...item, left })} />
      : <V2ProgramValueComposer value={item.left} strategy={strategy} role={role} onWorking={onWorking} onChange={(left) => onChange({ ...item, left })} />)}
    {active === `${item.semantic_id}:right` && (isDailyValue(item.right)
      ? <V2ValueComposer value={item.right} strategy={strategy} role={role} literal={item.right.kind === "literal"} onWorking={onWorking} onChange={(right) => onChange({ ...item, right })} />
      : <V2ProgramValueComposer value={item.right} strategy={strategy} role={role} onWorking={onWorking} onChange={(right) => onChange({ ...item, right })} />)}
  </div>;
  const tree = (item: ConditionV2): ReactNode => {
    if (item.kind === "comparison") return comparison(item);
    if (item.kind === "not") return <section className="condition-group" key={item.semantic_id}><strong>NOT</strong>{tree(item.child)}</section>;
    if (item.kind === "state_equals" || item.kind === "event_window") return <section className="condition-group" key={item.semantic_id}><strong>{describeConditionV2(item)}</strong></section>;
    const minimumTrue = item.kind === "n_of_m" ? item.minimum_true : 1;
    return <section className="condition-group" key={item.semantic_id}><header><strong>{item.kind === "all" ? "ALL of these" : item.kind === "any" ? "ANY of these" : `At least ${minimumTrue} of these`}</strong>{item.kind === "n_of_m" && <input aria-label="Minimum true conditions" type="number" min={1} max={item.children.length} value={minimumTrue} onChange={(event) => onChange({ ...item, minimum_true: Number(event.target.value) })} />}</header>
      {item.children.map((child, index) => <div key={child.semantic_id}>{child.kind === "comparison"
        ? comparison({ ...child, semantic_id: child.semantic_id })
        : tree(child)}
        <button type="button" className="text-button danger" disabled={item.children.length === 1} onClick={() => onChange({ ...item, children: item.children.filter((_, position) => position !== index) })}>Remove</button>
      </div>)}
      <button type="button" className="text-button" onClick={() => { const next = clonedComparison(item); if (next) onChange({ ...item, children: [...item.children, next] }); }}>+ Add condition</button>
    </section>;
  };
  return <div className="v2-condition-composer" aria-label={`${role} Condition editor`}>
    <p className="fixed-setting">{describeConditionV2(condition)}</p>
    <div className="semantic-choice-row" aria-label="Condition structure">
      <button type="button" aria-pressed={condition.kind === "all"} onClick={() => onChange(condition.kind === "all" ? condition : grouped("all"))}>ALL</button>
      <button type="button" aria-pressed={condition.kind === "any"} onClick={() => onChange(condition.kind === "any" ? condition : grouped("any"))}>ANY</button>
      <button type="button" disabled title="Reference-evaluable; production lowering is not closed.">N-of-M</button>
      <button type="button" disabled title="Reference-evaluable; production lowering is not closed.">NOT</button>
    </div>
    {tree(condition)}
    <p className="value-capability-note">Nested ALL / ANY supports four levels, twelve clauses per group, and forty total nodes.</p>
  </div>;
}

type DraftSubject = "candidate" | "asset" | "group_members";

export function V2ValueDraftComposer({ semanticId, strategy, role, onComplete, onWorking }: {
  semanticId: string;
  strategy: CanonicalStrategyV2;
  role: Role;
  onComplete: (value: DailyValueNode) => void;
  onWorking?: (unfinished: boolean) => void;
}) {
  const [subject, setSubject] = useState<DraftSubject | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [operation, setOperation] = useState<Operation | null>(null);
  const [observations, setObservations] = useState("");
  const assets = useMemo(() => Array.from(new Set(strategy.definitions.asset_sets.flatMap((item) => item.assets))), [strategy]);
  const selection = strategy.program?.statements.find((item) => item.kind === "select");
  const bindingId = selection?.kind === "select" ? selection.selection.binding.id : semanticId + "-candidate";
  const needsWindow = operation !== null && operation !== "observe";
  const complete = subject !== null && operation !== null && subjectId !== ""
    && (!needsWindow || (Number.isInteger(Number(observations)) && Number(observations) > 0 && Number(observations) <= 2000));
  useEffect(() => { onWorking?.(!complete); }, [complete, onWorking]);
  const chooseSubject = (next: DraftSubject) => {
    setSubject(next);
    setSubjectId(next === "candidate" ? bindingId : next === "asset" ? assets[0] ?? "" : strategy.definitions.groups[0]?.id ?? "");
  };
  const finish = (nextOperation = operation) => {
    if (!subject || !nextOperation || subjectId === "") return;
    const needs = nextOperation !== "observe";
    const window = Number(observations);
    if (needs && (!Number.isInteger(window) || window < 1 || window > 2000)) return;
    const source: DailyValueNode = {
      semantic_id: semanticId + "-source", kind: "observe", operands: [], subject_kind: subject,
      subject_id: subject === "candidate" ? null : subjectId, binding_id: subject === "candidate" ? subjectId : null,
      field: "close", basis: "adjusted", skip: 0, missing_policy: "require_all", minimum_count: 1, minimum_fraction: 1,
    };
    onComplete(buildValue({ ...source, semantic_id: semanticId }, nextOperation, source, needs ? window : 1));
  };
  return <div className="program-value-composer value-draft"><p className="fixed-setting">Choose the complete financial Value. No placeholder Value will be committed.</p>
    <fieldset><legend>What is this value about?</legend><div className="semantic-choice-row">
      {(role === "eligibility" || role === "ranking") && <button type="button" aria-pressed={subject === "candidate"} onClick={() => chooseSubject("candidate")}>Current candidate</button>}
      <button type="button" aria-pressed={subject === "asset"} onClick={() => chooseSubject("asset")}>Specific asset</button>
    </div></fieldset>
    {subject === "asset" && <label>Asset<select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>{assets.map((asset) => <option key={asset}>{asset}</option>)}</select></label>}
    {subject && <label>Value<select value={operation ?? ""} onChange={(event) => { const next = event.target.value as Operation; setOperation(next); if (next === "observe") queueMicrotask(() => finish(next)); }}><option value="" disabled>Choose a Value</option><option value="observe">Current adjusted close</option><option value="trailing_return">Trailing return</option><option value="sma">SMA</option><option disabled>EMA — reference only</option><option disabled>RSI — reference only</option><option disabled>Realized volatility — reference only</option><option disabled>Volume — unavailable with current data source</option></select></label>}
    {needsWindow && <label>Observations<input type="number" min={1} max={2000} value={observations} onChange={(event) => setObservations(event.target.value)} onBlur={() => finish()} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); finish(); } }} /></label>}
  </div>;
}

export function V2ConditionDraftComposer({ semanticId, strategy, role, onComplete, onWorking }: {
  semanticId: string;
  strategy: CanonicalStrategyV2;
  role: "predicate" | "eligibility";
  onComplete: (condition: ConditionV2) => void;
  onWorking?: (unfinished: boolean) => void;
}) {
  const [subject, setSubject] = useState<DraftSubject | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [operation, setOperation] = useState<Operation | null>(null);
  const [observations, setObservations] = useState("");
  const [operator, setOperator] = useState<ComparisonV2["operator"]>("gt");
  const [right, setRight] = useState("");
  const assets = useMemo(() => Array.from(new Set(strategy.definitions.asset_sets.flatMap((item) => item.assets))), [strategy]);
  const candidate = strategy.program?.statements.find((item) => item.kind === "select");
  const bindingId = candidate?.kind === "select" ? candidate.selection.binding.id : "candidate";
  const needsWindow = operation !== null && operation !== "observe";
  const complete = subject !== null && operation !== null && subjectId !== ""
    && (!needsWindow || (Number.isInteger(Number(observations)) && Number(observations) > 0 && Number(observations) <= 2000))
    && right.trim() !== "" && Number.isFinite(Number(right));

  useEffect(() => { onWorking?.(!complete); }, [complete, onWorking]);

  const chooseSubject = (next: DraftSubject) => {
    setSubject(next);
    setSubjectId(next === "candidate" ? bindingId : next === "asset" ? assets[0] ?? "" : strategy.definitions.groups[0]?.id ?? "");
  };
  const finish = () => {
    if (!complete || !subject || !operation) return;
    const source: DailyValueNode = {
      semantic_id: semanticId + "-source", kind: "observe", operands: [],
      subject_kind: subject, subject_id: subject === "candidate" ? null : subjectId,
      binding_id: subject === "candidate" ? subjectId : null,
      field: "close", basis: "adjusted", skip: 0,
      missing_policy: "require_all", minimum_count: 1, minimum_fraction: 1,
    };
    const left = buildValue(source, operation, source, needsWindow ? Number(observations) : 1);
    const price = operation === "observe" || operation === "sma" || operation === "ema";
    const oscillator = operation === "rsi_wilder_lean_compat";
    const rightValue: DailyValueNode = {
      semantic_id: semanticId + "-right", kind: "literal", operands: [], value: Number(right),
      quantity: price ? "price" : oscillator ? "oscillator" : "return",
      unit: price ? "USD/share" : oscillator ? "points" : "ratio",
      refinement: price ? "adjusted_close" : oscillator ? "rsi_wilder" : "return",
      skip: 0, missing_policy: "require_all", minimum_count: 1, minimum_fraction: 1,
    };
    onComplete({ kind: "comparison", semantic_id: semanticId, operator, left, right: rightValue });
  };

  return <div className="v2-condition-composer condition-draft" aria-label={`${role} Condition editor`}>
    <p className="fixed-setting">Set a complete condition. Nothing is committed until every required value is defined.</p>
    <fieldset><legend>What is the left Value about?</legend><div className="semantic-choice-row">
      {role === "eligibility" && <button type="button" aria-pressed={subject === "candidate"} onClick={() => chooseSubject("candidate")}>Current candidate</button>}
      <button type="button" aria-pressed={subject === "asset"} onClick={() => chooseSubject("asset")}>Specific asset</button>
    </div></fieldset>
    {subject === "asset" && <label>Asset<select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>{assets.map((asset) => <option key={asset}>{asset}</option>)}</select></label>}
    {subject && <label>Value<select value={operation ?? ""} onChange={(event) => setOperation(event.target.value as Operation)}><option value="" disabled>Choose a Value</option><option value="observe">Current adjusted close</option><option value="trailing_return">Trailing return</option><option value="sma">SMA</option><option disabled>EMA — reference only</option><option disabled>RSI — reference only</option><option disabled>Realized volatility — reference only</option><option disabled>Volume — unavailable with current data source</option></select></label>}
    {needsWindow && <label>Observations<input type="number" min={1} max={2000} value={observations} onChange={(event) => setObservations(event.target.value)} /></label>}
    {operation && <div className="condition-comparison-row draft-comparison"><strong>Comparison</strong><select aria-label="Comparison operator" value={operator} onChange={(event) => setOperator(event.target.value as ComparisonV2["operator"])}><option value="gt">&gt;</option><option value="gte">≥</option><option value="lt">&lt;</option><option value="lte">≤</option></select><label>Right Value<input type="number" value={right} onChange={(event) => setRight(event.target.value)} onBlur={finish} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); finish(); } }} /></label></div>}
    <p className="value-capability-note">The complete comparison applies automatically after the right Value is finished.</p>
  </div>;
}
