import type { CanonicalStrategyV1, ConditionExpression, ValueExpression } from "../domain/canonical";
import { valueExpressionType } from "../domain/valueSemantics";
import type { StrategyValueCapability } from "../structuralAuthoringApi";
import { ValueComposer } from "./ValueComposer";

type Operator = "gt" | "gte" | "lt" | "lte";

export interface ConditionComposerProps {
  role: "predicate" | "eligibility";
  expression: ConditionExpression;
  strategy?: CanonicalStrategyV1;
  capabilities?: StrategyValueCapability[];
  disabled?: boolean;
  defaultLookback?: number;
  onChange: (expression: ConditionExpression) => void;
}

const fallbackStrategy: CanonicalStrategyV1 = {
  api_version: "ruletrade.dev/strategy/v1", metadata: { name: "Value", description: "", tags: [] }, random_seed: 0,
  definitions: { asset_sets: [{ id: "assets", assets: ["SPY"] }], parameters: [], state: [] },
  graph: { components: [], connections: [] }, entrypoints: [],
};

function defaultClause(role: "predicate" | "eligibility", lookback: number): ConditionExpression {
  const subject: ValueExpression = role === "eligibility" ? { kind: "candidate" } : { kind: "literal", value_type: "asset", value: "SPY" };
  return { kind: "comparison", operator: "gt", left: { kind: "indicator", indicator_id: "trailing_return_indicator@1", asset: subject, parameters: { lookback_bars: lookback } }, right: { kind: "literal", value_type: "percentage", value: 0 } };
}

function clauses(expression: ConditionExpression): ConditionExpression[] {
  return expression.kind === "boolean" && expression.operator === "and" ? expression.operands : [expression];
}

export function ConditionComposer({ role, expression, strategy = fallbackStrategy, capabilities, disabled, defaultLookback = 126, onChange }: ConditionComposerProps) {
  const items = clauses(expression);
  const commit = (next: ConditionExpression[]) => onChange(next.length === 1 ? next[0] : { kind: "boolean", operator: "and", operands: next });
  const update = (index: number, next: ConditionExpression) => commit(items.map((item, current) => current === index ? next : item));
  return <fieldset disabled={disabled} className="condition-composer">
    <legend>{role === "predicate" ? "Condition (ALL)" : "Candidate eligibility (ALL)"}</legend>
    {items.map((item, index) => {
      if (item.kind !== "comparison") return <p key={index}>This condition is preserved canonically but is outside the executable ALL subset.</p>;
      return <article key={index} className="condition-clause">
        <span className="eyebrow">Left value</span>
        <ValueComposer expression={item.left} strategy={strategy} capabilities={capabilities} allowCandidate={role === "eligibility"} disabled={disabled} onChange={(left) => {
          const right = item.right.kind === "literal" ? { ...item.right, value_type: valueExpressionType(left) } : item.right;
          update(index, { ...item, left, right });
        }} />
        <label>Operator<select aria-label="Comparison operator" value={item.operator} onChange={(event) => update(index, { ...item, operator: event.target.value as Operator })}><option value="gt">greater than</option><option value="gte">at least</option><option value="lt">less than</option><option value="lte">at most</option></select></label>
        <span className="eyebrow">Right value</span>
        <ValueComposer expression={item.right} strategy={strategy} capabilities={capabilities} allowCandidate={role === "eligibility"} allowLiteral disabled={disabled} onChange={(right) => update(index, { ...item, right })} />
        {items.length > 1 && <button type="button" className="text-button danger" onClick={() => commit(items.filter((_, current) => current !== index))}>Remove comparison</button>}
      </article>;
    })}
    {items.length < 5 && <button type="button" className="secondary-button" onClick={() => commit([...items, defaultClause(role, defaultLookback)])}>+ Add ALL comparison</button>}
    <p className="fixed-setting">Up to five comparisons. ANY and nested boolean trees remain unavailable for Strategy execution.</p>
  </fieldset>;
}
