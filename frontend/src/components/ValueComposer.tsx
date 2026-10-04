import type { CanonicalStrategyV1, ValueExpression } from "../domain/canonical";
import { describeValueExpression, valueExpressionType } from "../domain/valueSemantics";
import type { StrategyValueCapability } from "../structuralAuthoringApi";

type Measure = "trailing_return" | "current_price" | "rolling_price" | "literal";

function unwrapScale(expression: ValueExpression): { base: ValueExpression; factor: number | null } {
  if (expression.kind === "arithmetic" && expression.operator === "multiply" && expression.right.kind === "literal" && expression.right.value_type === "decimal") {
    return { base: expression.left, factor: Number(expression.right.value) };
  }
  return { base: expression, factor: null };
}

function subjectOf(expression: ValueExpression): ValueExpression {
  const { base } = unwrapScale(expression);
  if (base.kind === "indicator") return base.asset;
  if (base.kind === "current" && base.series.kind === "market_series") return base.series.subject;
  if (base.kind === "rolling_aggregate" && base.series.kind === "market_series") return base.series.subject;
  return { kind: "literal", value_type: "asset", value: "SPY" };
}

function measureOf(expression: ValueExpression): Measure {
  const { base } = unwrapScale(expression);
  if (base.kind === "literal" && base.value_type !== "asset") return "literal";
  if (base.kind === "current") return "current_price";
  if (base.kind === "rolling_aggregate") return "rolling_price";
  return "trailing_return";
}

function executable(capabilities: StrategyValueCapability[] | undefined, id: string) {
  return capabilities?.some((item) => item.id === id && item.capability_level === "executable") ?? true;
}

export function ValueComposer({ expression, strategy, capabilities, allowCandidate, allowLiteral = false, disabled, onChange }: {
  expression: ValueExpression;
  strategy: CanonicalStrategyV1;
  capabilities?: StrategyValueCapability[];
  allowCandidate: boolean;
  allowLiteral?: boolean;
  disabled?: boolean;
  onChange: (value: ValueExpression) => void;
}) {
  const unwrapped = unwrapScale(expression);
  const subject = subjectOf(expression);
  const measure = measureOf(expression);
  const subjectKind = subject.kind === "candidate" ? "candidate" : "asset";
  const asset = subject.kind === "literal" ? String(subject.value) : "SPY";

  const emit = (nextMeasure: Measure, nextSubject = subject, factor = unwrapped.factor) => {
    let value: ValueExpression;
    if (nextMeasure === "literal") {
      value = expression.kind === "literal" ? expression : { kind: "literal", value_type: valueExpressionType(unwrapped.base), value: 0 };
    } else if (nextMeasure === "current_price") {
      value = { kind: "current", series: { kind: "market_series", field: "price", subject: nextSubject } };
    } else if (nextMeasure === "rolling_price") {
      const current = unwrapped.base.kind === "rolling_aggregate" ? unwrapped.base : null;
      value = { kind: "rolling_aggregate", operator: current?.operator ?? "mean", window_observations: current?.window_observations ?? 20, series: { kind: "market_series", field: "price", subject: nextSubject } };
    } else {
      const current = unwrapped.base.kind === "indicator" ? unwrapped.base : null;
      value = { kind: "indicator", indicator_id: "trailing_return_indicator@1", asset: nextSubject, parameters: { lookback_bars: Number(current?.parameters.lookback_bars ?? 126) } };
    }
    onChange(factor === null || nextMeasure === "literal" ? value : { kind: "arithmetic", operator: "multiply", left: value, right: { kind: "literal", value_type: "decimal", value: factor } });
  };

  const updateBase = (base: ValueExpression) => onChange(unwrapped.factor === null ? base : { kind: "arithmetic", operator: "multiply", left: base, right: { kind: "literal", value_type: "decimal", value: unwrapped.factor } });
  const assetOptions = Array.from(new Set(strategy.definitions.asset_sets.flatMap((item) => item.assets)));
  return <div className="value-composer">
    <strong className="value-summary">{describeValueExpression(expression)}</strong>
    <div className="value-composer-fields">
      {measure !== "literal" && <label>Subject<select disabled={disabled} value={subjectKind} onChange={(event) => emit(measure, event.target.value === "candidate" ? { kind: "candidate" } : { kind: "literal", value_type: "asset", value: assetOptions[0] ?? "SPY" })}>
        <option value="asset">Asset</option>{allowCandidate && <option value="candidate">Candidate</option>}
      </select></label>}
      {measure !== "literal" && subjectKind === "asset" && <label>Asset<input disabled={disabled} list="strategy-assets" value={asset} onChange={(event) => emit(measure, { kind: "literal", value_type: "asset", value: event.target.value.toUpperCase() })} /><datalist id="strategy-assets">{assetOptions.map((item) => <option key={item} value={item} />)}</datalist></label>}
      <label>Value<select disabled={disabled} value={measure} onChange={(event) => emit(event.target.value as Measure)}>
        {executable(capabilities, "market.trailing_return") && <option value="trailing_return">Trailing return</option>}
        {executable(capabilities, "market.price.current") && <option value="current_price">Current adjusted price</option>}
        {executable(capabilities, "aggregate.rolling") && <option value="rolling_price">Rolling adjusted price</option>}
        {allowLiteral && <option value="literal">Constant</option>}
      </select></label>
      {unwrapped.base.kind === "indicator" && <label>Lookback observations<input disabled={disabled} type="number" min="1" max="1000" value={Number(unwrapped.base.parameters.lookback_bars ?? 126)} onChange={(event) => updateBase({ ...unwrapped.base, parameters: { ...unwrapped.base.parameters, lookback_bars: Number(event.target.value) } })} /></label>}
      {unwrapped.base.kind === "rolling_aggregate" && <><label>Aggregate<select disabled={disabled} value={unwrapped.base.operator} onChange={(event) => updateBase({ ...unwrapped.base, operator: event.target.value as "mean" | "median" | "min" | "max" })}><option value="mean">Mean</option><option value="median">Median</option><option value="min">Minimum</option><option value="max">Maximum</option></select></label><label>Window observations<input disabled={disabled} type="number" min="1" max="1000" value={unwrapped.base.window_observations} onChange={(event) => updateBase({ ...unwrapped.base, window_observations: Number(event.target.value) })} /></label></>}
      {measure === "literal" && expression.kind === "literal" && <label>Constant<input disabled={disabled} type="number" step="any" value={Number(expression.value)} onChange={(event) => onChange({ ...expression, value: Number(event.target.value) })} /></label>}
      {measure !== "literal" && executable(capabilities, "arithmetic.scale") && <label>Scale<input disabled={disabled} type="number" step="0.1" value={unwrapped.factor ?? 1} onChange={(event) => emit(measure, subject, Number(event.target.value) === 1 ? null : Number(event.target.value))} /></label>}
    </div>
  </div>;
}
