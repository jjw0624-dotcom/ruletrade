import { useMemo, useState } from "react";
import type { CanonicalStrategyV2, ComparisonV2, ConditionV2, DailyValueNode } from "../domain/canonicalV2";
import { describeConditionV2, describeDailyValue } from "../domain/v2Semantics";

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
  const subjectKind = observe?.subject_kind ?? (role === "eligibility" || role === "ranking" ? "candidate" : "asset");
  const subjectId = subjectKind === "candidate" ? strategy.selection.binding.id : observe?.subject_id ?? assets[0] ?? "";
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
        {(role === "eligibility" || role === "ranking") && <button type="button" aria-pressed={subjectKind === "candidate"} onClick={() => emit(operation, withSubject(subject, "candidate", strategy.selection.binding.id))}>Current candidate</button>}
        <button type="button" aria-pressed={subjectKind === "asset"} onClick={() => emit(operation, withSubject(subject, "asset", assets[0] ?? ""))}>Specific asset</button>
        <button type="button" aria-pressed={subjectKind === "group_members"} onClick={() => emit(operation, withSubject(subject, "group_members", strategy.definitions.groups[0]?.id ?? ""))}>Static Group members</button>
      </div></fieldset>
      {subjectKind === "asset" && <label>Asset<select value={subjectId} onChange={(event) => emit(operation, withSubject(subject, "asset", event.target.value))}>{assets.map((asset) => <option key={asset}>{asset}</option>)}</select></label>}
      {subjectKind === "group_members" && <label>Group<select value={subjectId} onChange={(event) => emit(operation, withSubject(subject, "group_members", event.target.value))}>{strategy.definitions.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}
      <label>Value<select value={operation} onChange={(event) => emit(event.target.value as Operation)}>
        <option value="observe">Current adjusted close</option>
        <option value="trailing_return">Trailing return</option>
        <option value="sma">SMA</option>
        <option value="ema">EMA</option>
        <option value="rsi_wilder_lean_compat">RSI</option>
        <option value="realized_volatility">Realized volatility</option>
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

function replaceChild(group: ConditionV2, index: number, child: ConditionV2): ConditionV2 {
  if (group.kind !== "all" && group.kind !== "any") return group;
  return { ...group, children: group.children.map((item, position) => position === index ? child : item) };
}

export function V2ConditionComposer({ condition, strategy, role, onChange, onWorking }: {
  condition: ConditionV2;
  strategy: CanonicalStrategyV2;
  role: "predicate" | "eligibility";
  onChange: (condition: ConditionV2) => void;
  onWorking?: (unfinished: boolean) => void;
}) {
  const [active, setActive] = useState<string | null>(null);
  const comparison = (item: ComparisonV2) => <div className="condition-comparison-row" key={item.semantic_id}>
    <button type="button" className="semantic-value-row" aria-expanded={active === `${item.semantic_id}:left`} onClick={() => setActive(active === `${item.semantic_id}:left` ? null : `${item.semantic_id}:left`)}>{describeDailyValue(item.left)}</button>
    <select aria-label="Comparison operator" value={item.operator} onChange={(event) => onChange({ ...item, operator: event.target.value as ComparisonV2["operator"] })}><option value="gt">&gt;</option><option value="gte">≥</option><option value="lt">&lt;</option><option value="lte">≤</option><option value="eq">=</option><option value="neq">≠</option></select>
    <button type="button" className="semantic-value-row" aria-expanded={active === `${item.semantic_id}:right`} onClick={() => setActive(active === `${item.semantic_id}:right` ? null : `${item.semantic_id}:right`)}>{describeDailyValue(item.right)}</button>
    {active === `${item.semantic_id}:left` && <V2ValueComposer value={item.left} strategy={strategy} role={role} onWorking={onWorking} onChange={(left) => onChange({ ...item, left })} />}
    {active === `${item.semantic_id}:right` && <V2ValueComposer value={item.right} strategy={strategy} role={role} literal={item.right.kind === "literal"} onWorking={onWorking} onChange={(right) => onChange({ ...item, right })} />}
  </div>;
  const tree = (item: ConditionV2): JSX.Element => {
    if (item.kind === "comparison") return comparison(item);
    if (item.kind === "not") return <section className="condition-group" key={item.semantic_id}><strong>NOT</strong>{tree(item.child)}</section>;
    return <section className="condition-group" key={item.semantic_id}><header><strong>{item.kind === "all" ? "ALL of these" : "ANY of these"}</strong></header>
      {item.children.map((child, index) => <div key={child.semantic_id}>{child.kind === "comparison"
        ? comparison({ ...child, semantic_id: child.semantic_id })
        : tree(child)}
        <button type="button" className="text-button danger" disabled={item.children.length === 1} onClick={() => onChange({ ...item, children: item.children.filter((_, position) => position !== index) })}>Remove</button>
      </div>)}
    </section>;
  };
  return <div className="v2-condition-composer" aria-label={`${role} Condition editor`}>
    <p className="fixed-setting">{describeConditionV2(condition)}</p>
    {tree(condition)}
    <p className="value-capability-note">Nested ALL / ANY supports four levels, twelve clauses per group, and forty total nodes.</p>
  </div>;
}
