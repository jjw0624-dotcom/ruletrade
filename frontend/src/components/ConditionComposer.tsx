import { useEffect, useId, useState } from "react";

import type { CanonicalStrategyV1, ConditionExpression, ValueExpression } from "../domain/canonical";
import { describeConditionExpression, describeValueExpression, valueExpressionType } from "../domain/valueSemantics";
import type { StrategyValueCapability } from "../structuralAuthoringApi";
import { ValueComposer, type ValueWorkingState } from "./ValueComposer";

type Operator = "gt" | "gte" | "lt" | "lte";
type Comparison = Extract<ConditionExpression, { kind: "comparison" }>;
type DraftRow = {
  id: string;
  left: ValueExpression | null;
  right: ValueExpression | null;
  operator: Operator;
  leftReady: boolean;
  rightReady: boolean;
};
type EditingValue = { index: number; side: "left" | "right" } | null;

export interface ConditionComposerProps {
  role: "predicate" | "eligibility";
  expression: ConditionExpression | null;
  strategy?: CanonicalStrategyV1;
  capabilities?: StrategyValueCapability[];
  disabled?: boolean;
  initiallyOpen?: boolean;
  initialEditingSide?: "left" | "right";
  onChange: (expression: ConditionExpression) => void;
  onWorkingState?: (state: ValueWorkingState) => void;
}

const fallbackStrategy: CanonicalStrategyV1 = {
  api_version: "ruletrade.dev/strategy/v1", metadata: { name: "Value", description: "", tags: [] }, random_seed: 0,
  definitions: { asset_sets: [{ id: "assets", assets: ["SPY"] }], parameters: [], state: [] },
  graph: { components: [], connections: [] }, entrypoints: [],
};

function comparisons(expression: ConditionExpression | null): Comparison[] {
  if (!expression) return [];
  if (expression.kind === "comparison") return [expression];
  return expression.kind === "boolean" && expression.operator === "and"
    ? expression.operands.filter((item): item is Comparison => item.kind === "comparison")
    : [];
}

export function ConditionComposer({
  role, expression, strategy = fallbackStrategy, capabilities, disabled,
  initiallyOpen = false, initialEditingSide, onChange, onWorkingState,
}: ConditionComposerProps) {
  const prefix = useId();
  const makeRows = (source: ConditionExpression | null): DraftRow[] => {
    const items = comparisons(source);
    return items.length
      ? items.map((item, index) => ({ id: `${prefix}-${index}`, left: item.left, right: item.right, operator: item.operator as Operator, leftReady: true, rightReady: true }))
      : [{ id: `${prefix}-new`, left: null, right: null, operator: "gt", leftReady: false, rightReady: false }];
  };
  const [rows, setRows] = useState<DraftRow[]>(() => makeRows(expression));
  const [open, setOpen] = useState(initiallyOpen || !expression);
  const [editing, setEditing] = useState<EditingValue>(initialEditingSide ? { index: 0, side: initialEditingSide } : null);
  useEffect(() => setRows(makeRows(expression)), [expression]);

  if (expression && comparisons(expression).length === 0) {
    return <section className="condition-composer"><p>This condition is preserved but is outside the executable ALL subset.</p></section>;
  }

  const emit = (next: DraftRow[]) => {
    setRows(next);
    const complete = next.length > 0 && next.every((item) => item.left && item.right && item.leftReady && item.rightReady);
    onWorkingState?.(complete ? "complete" : "incomplete");
    if (!complete) return;
    const values: Comparison[] = next.map((item) => ({ kind: "comparison", operator: item.operator, left: item.left!, right: item.right! }));
    onChange(values.length === 1 ? values[0] : { kind: "boolean", operator: "and", operands: values });
  };
  const update = (index: number, patch: Partial<DraftRow>) => emit(rows.map((item, current) => current === index ? { ...item, ...patch } : item));
  const summary = expression ? describeConditionExpression(expression) : "Set condition";
  const active = editing ? rows[editing.index] : undefined;

  if (editing && active) {
    const value = active[editing.side];
    return <section className="condition-composer condition-value-depth" data-editor-depth="value">
      <ValueComposer
        expression={value}
        strategy={strategy}
        capabilities={capabilities}
        allowCandidate={role === "eligibility"}
        allowLiteral={editing.side === "right"}
        disabled={disabled}
        editorOnly
        onBack={() => setEditing(null)}
        onWorkingState={(state) => update(editing.index, editing.side === "left" ? { leftReady: state === "complete" } : { rightReady: state === "complete" })}
        onChange={(nextValue) => {
          if (editing.side === "left") {
            const right = active.right?.kind === "literal" ? { ...active.right, value_type: valueExpressionType(nextValue) } : active.right;
            update(editing.index, { left: nextValue, right, leftReady: true });
          } else update(editing.index, { right: nextValue, rightReady: true });
        }}
      />
    </section>;
  }

  return <section className={`condition-composer${open ? " open" : ""}`} data-editor-depth="condition">
    <header className="semantic-section-header">
      <div><span className="eyebrow">{role === "predicate" ? "Condition" : "Eligibility"}</span><strong>{summary}</strong></div>
      <button type="button" className="text-button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>{open ? "Done" : "Edit"}</button>
    </header>
    {open && <div className="condition-rows">
      <p className="condition-all-label">ALL of these</p>
      {rows.map((item, index) => <article key={item.id} className="comparison-row" aria-label={`Condition ${index + 1}`}>
        <span className="comparison-number">{index + 1}</span>
        <button type="button" className="semantic-value-row comparison-value" aria-label={`Edit condition ${index + 1} left value`} onClick={() => setEditing({ index, side: "left" })}>
          <span>{item.left ? describeValueExpression(item.left) : "Set left value"}</span><small>Edit</small>
        </button>
        <label className="comparison-operator"><span className="sr-only">Operator</span><select aria-label={`Condition ${index + 1} operator`} value={item.operator} disabled={disabled}
          onChange={(event) => update(index, { operator: event.target.value as Operator })}><option value="gt">&gt;</option><option value="gte">≥</option><option value="lt">&lt;</option><option value="lte">≤</option></select></label>
        <button type="button" className="semantic-value-row comparison-value" aria-label={`Edit condition ${index + 1} right value`} onClick={() => setEditing({ index, side: "right" })}>
          <span>{item.right ? describeValueExpression(item.right) : "Set right value"}</span><small>Edit</small>
        </button>
        {rows.length > 1 && <button type="button" className="comparison-remove" aria-label={`Remove condition ${index + 1}`} onClick={() => {
          setEditing(null);
          emit(rows.filter((_, current) => current !== index));
        }}>×</button>}
      </article>)}
      {rows.length < 5 && <button type="button" className="secondary-button add-condition" onClick={() => {
        setEditing(null);
        emit([...rows, { id: `${prefix}-${Date.now()}`, left: null, right: null, operator: "gt", leftReady: false, rightReady: false }]);
      }}>+ Add condition</button>}
      <p className="fixed-setting">ALL supports up to five comparisons. ANY and nested conditions remain unavailable.</p>
    </div>}
  </section>;
}
