import type { ConditionExpression, ValueExpression } from "../domain/canonical";

type Operator = "gt" | "gte" | "lt" | "lte";

export interface ConditionComposerProps {
  role: "predicate" | "eligibility";
  expression: ConditionExpression;
  disabled?: boolean;
  onChange: (expression: ConditionExpression) => void;
}

function clause(asset: ValueExpression, lookback = 126, operator: Operator = "gt", threshold = 0): ConditionExpression {
  return {
    kind: "comparison",
    operator,
    left: { kind: "indicator", indicator_id: "trailing_return_indicator@1", asset, parameters: { lookback_bars: lookback } },
    right: { kind: "literal", value_type: "percentage", value: threshold },
  };
}

function clauses(expression: ConditionExpression): ConditionExpression[] {
  return expression.kind === "boolean" && expression.operator === "and" ? expression.operands : [expression];
}

export function ConditionComposer({ role, expression, disabled, onChange }: ConditionComposerProps) {
  const items = clauses(expression);
  const update = (index: number, next: ConditionExpression) => {
    const result = items.map((item, current) => current === index ? next : item);
    onChange(result.length === 1 ? result[0] : { kind: "boolean", operator: "and", operands: result });
  };
  return <fieldset disabled={disabled} className="condition-composer">
    <legend>{role === "predicate" ? "Market condition" : "Candidate eligibility (ALL)"}</legend>
    {items.map((item, index) => {
      if (item.kind !== "comparison" || item.left.kind !== "indicator" || item.right.kind !== "literal") {
        return <p key={index}>This expression is represented canonically but is not editable in v1.</p>;
      }
      const left = item.left;
      const right = item.right;
      const parameters = left.parameters;
      return <div key={index} className="condition-clause">
        <span>{role === "predicate" ? "Asset" : "Candidate"} trailing return</span>
        <input aria-label="Lookback days" type="number" min="1" value={Number(parameters.lookback_bars ?? 126)}
          onChange={(event) => update(index, { ...item, left: { ...left, parameters: { ...parameters, lookback_bars: Number(event.target.value) } } })} />
        <select aria-label="Comparison operator" value={item.operator}
          onChange={(event) => update(index, { ...item, operator: event.target.value as Operator })}>
          <option value="gt">greater than</option><option value="gte">at least</option>
          <option value="lt">less than</option><option value="lte">at most</option>
        </select>
        <input aria-label="Threshold percent" type="number" step="0.1" value={Number(right.value) * 100}
          onChange={(event) => update(index, { ...item, right: { ...right, value: Number(event.target.value) / 100 } })} />
        {items.length > 1 && <button type="button" onClick={() => {
          const result = items.filter((_, current) => current !== index);
          onChange(result.length === 1 ? result[0] : { kind: "boolean", operator: "and", operands: result });
        }}>Remove</button>}
      </div>;
    })}
    <button type="button" onClick={() => {
      const asset: ValueExpression = role === "eligibility" ? { kind: "candidate" } : { kind: "literal", value_type: "asset", value: "SPY" };
      onChange({ kind: "boolean", operator: "and", operands: [...items, clause(asset)] });
    }}>Add ALL clause</button>
  </fieldset>;
}
