import { useEffect, useMemo, useState } from "react";

import type { CanonicalStrategyV1, ValueExpression } from "../domain/canonical";
import { describeValueExpression, valueExpressionType } from "../domain/valueSemantics";
import type { StrategyValueCapability } from "../structuralAuthoringApi";

type Measure = "trailing_return" | "current_price" | "rolling_price" | "literal";
export type ValueWorkingState = "complete" | "incomplete";

function unwrapScale(expression: ValueExpression | null): { base: ValueExpression | null; factor: number | null } {
  if (expression?.kind === "arithmetic" && expression.operator === "multiply" && expression.right.kind === "literal" && expression.right.value_type === "decimal") {
    return { base: expression.left, factor: Number(expression.right.value) };
  }
  return { base: expression, factor: null };
}

function subjectOf(expression: ValueExpression | null): ValueExpression | null {
  const { base } = unwrapScale(expression);
  if (base?.kind === "indicator") return base.asset;
  if (base?.kind === "current" && base.series.kind === "market_series") return base.series.subject;
  if (base?.kind === "rolling_aggregate" && base.series.kind === "market_series") return base.series.subject;
  return null;
}

function measureOf(expression: ValueExpression | null): Measure | "" {
  const { base } = unwrapScale(expression);
  if (!base) return "";
  if (base.kind === "literal" && base.value_type !== "asset") return "literal";
  if (base.kind === "current") return "current_price";
  if (base.kind === "rolling_aggregate") return "rolling_price";
  if (base.kind === "indicator") return "trailing_return";
  return "";
}

function executable(capabilities: StrategyValueCapability[] | undefined, id: string) {
  return capabilities?.some((item) => item.id === id && item.capability_level === "executable") ?? true;
}

function NumericDraft({ label, value, step = "any", minimum, maximum, disabled, display = (item) => item, parse = (item) => item, onCommit, onWorkingState }: {
  label: string; value: number; step?: string; minimum?: number; maximum?: number; disabled?: boolean;
  display?: (value: number) => number; parse?: (value: number) => number;
  onCommit: (value: number) => void; onWorkingState?: (state: ValueWorkingState) => void;
}) {
  const [draft, setDraft] = useState(String(display(value)));
  useEffect(() => setDraft(String(display(value))), [value]);
  const commit = () => {
    const numeric = Number(draft);
    if (!Number.isFinite(numeric) || (minimum !== undefined && numeric < minimum) || (maximum !== undefined && numeric > maximum)) {
      onWorkingState?.("incomplete");
      return;
    }
    onCommit(parse(numeric));
  };
  return <label>{label}<input disabled={disabled} type="number" step={step} min={minimum} max={maximum} value={draft}
    onChange={(event) => { setDraft(event.target.value); onWorkingState?.("incomplete"); }}
    onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>;
}

export function ValueComposer({ expression, strategy, capabilities, allowCandidate, allowLiteral = false, disabled, initiallyOpen = false, editorOnly = false, onBack, onChange, onWorkingState }: {
  expression: ValueExpression | null;
  strategy: CanonicalStrategyV1;
  capabilities?: StrategyValueCapability[];
  allowCandidate: boolean;
  allowLiteral?: boolean;
  disabled?: boolean;
  initiallyOpen?: boolean;
  editorOnly?: boolean;
  onBack?: () => void;
  onChange: (value: ValueExpression) => void;
  onWorkingState?: (state: ValueWorkingState) => void;
}) {
  const [open, setOpen] = useState(editorOnly || initiallyOpen || !expression);
  const unwrapped = unwrapScale(expression);
  const subject = subjectOf(expression);
  const measure = measureOf(expression);
  const [subjectChoice, setSubjectChoice] = useState<"" | "asset" | "candidate">(
    subject?.kind === "candidate" ? "candidate" : subject ? "asset" : "",
  );
  const [assetDraft, setAssetDraft] = useState(subject?.kind === "literal" ? String(subject.value) : "");
  const [measureChoice, setMeasureChoice] = useState<Measure | "">(measure);
  const [literalDraft, setLiteralDraft] = useState(
    unwrapped.base?.kind === "literal" && unwrapped.base.value_type !== "asset" ? String(unwrapped.base.value) : "",
  );
  const [addingTransform, setAddingTransform] = useState(false);
  const [factorDraft, setFactorDraft] = useState(unwrapped.factor === null ? "" : String(unwrapped.factor));
  useEffect(() => {
    const nextSubject = subjectOf(expression);
    setSubjectChoice(nextSubject?.kind === "candidate" ? "candidate" : nextSubject ? "asset" : "");
    setAssetDraft(nextSubject?.kind === "literal" ? String(nextSubject.value) : "");
    setMeasureChoice(measureOf(expression));
    const next = unwrapScale(expression);
    setLiteralDraft(next.base?.kind === "literal" && next.base.value_type !== "asset" ? String(next.base.value) : "");
    setFactorDraft(next.factor === null ? "" : String(next.factor));
    setAddingTransform(next.factor !== null);
  }, [expression]);
  const assetOptions = useMemo(() => Array.from(new Set(strategy.definitions.asset_sets.flatMap((item) => item.assets))), [strategy]);

  const chosenSubject = (): ValueExpression | null => {
    if (subjectChoice === "candidate" && allowCandidate) return { kind: "candidate" };
    if (subjectChoice === "asset" && assetDraft.trim()) return { kind: "literal", value_type: "asset", value: assetDraft.trim().toUpperCase() };
    return null;
  };
  const wrap = (base: ValueExpression, factor = unwrapped.factor) => factor === null
    ? base
    : { kind: "arithmetic", operator: "multiply", left: base, right: { kind: "literal", value_type: "decimal", value: factor } } as ValueExpression;
  const build = (nextMeasure = measureChoice, nextSubject = chosenSubject()): ValueExpression | null => {
    if (nextMeasure === "literal") {
      const numeric = Number(literalDraft);
      return literalDraft !== "" && Number.isFinite(numeric)
        ? { kind: "literal", value_type: expression ? valueExpressionType(unwrapped.base ?? expression) : "decimal", value: numeric }
        : null;
    }
    if (!nextMeasure || !nextSubject) return null;
    if (nextMeasure === "current_price") return wrap({ kind: "current", series: { kind: "market_series", field: "price", subject: nextSubject } });
    if (nextMeasure === "rolling_price") {
      const current = unwrapped.base?.kind === "rolling_aggregate" ? unwrapped.base : null;
      return wrap({ kind: "rolling_aggregate", operator: current?.operator ?? "mean", window_observations: current?.window_observations ?? 20, series: { kind: "market_series", field: "price", subject: nextSubject } });
    }
    const current = unwrapped.base?.kind === "indicator" ? unwrapped.base : null;
    return wrap({ kind: "indicator", indicator_id: "trailing_return_indicator@1", asset: nextSubject, parameters: { lookback_bars: Number(current?.parameters.lookback_bars ?? 126) } });
  };
  const emitIfComplete = (nextMeasure = measureChoice, nextSubject = chosenSubject()) => {
    const next = build(nextMeasure, nextSubject);
    if (next) onChange(next);
    else onWorkingState?.("incomplete");
  };
  const updateBase = (base: ValueExpression) => onChange(wrap(base));
  const indicator = unwrapped.base?.kind === "indicator" ? unwrapped.base : null;
  const rolling = unwrapped.base?.kind === "rolling_aggregate" ? unwrapped.base : null;
  const literal = unwrapped.base?.kind === "literal" && unwrapped.base.value_type !== "asset" ? unwrapped.base : null;

  return <div className={`value-composer${open ? " open" : ""}${editorOnly ? " editor-only" : ""}`}>
    {editorOnly && <header className="semantic-subeditor-header"><button type="button" className="text-button" onClick={onBack}>← Condition</button><strong>Value</strong></header>}
    {!editorOnly && <button type="button" className="semantic-value-row" aria-expanded={open} aria-label={expression ? `Edit value: ${describeValueExpression(expression)}` : "Set semantic value"}
      disabled={disabled} onClick={() => setOpen((current) => !current)}>
      <span>{expression ? describeValueExpression(expression) : "Set value"}</span><small>{open ? "Done" : "Edit"}</small>
    </button>}
    {(editorOnly || open) && <div className="value-editor" aria-label="Value editor">
      {measureChoice !== "literal" && <fieldset><legend>What is this value about?</legend><div className="semantic-choice-row">
        <button type="button" aria-pressed={subjectChoice === "asset"} onClick={() => { setSubjectChoice("asset"); onWorkingState?.("incomplete"); }}>Specific asset</button>
        {allowCandidate && <button type="button" aria-pressed={subjectChoice === "candidate"} onClick={() => { setSubjectChoice("candidate"); queueMicrotask(() => emitIfComplete(measureChoice, { kind: "candidate" })); }}>Current candidate</button>}
      </div></fieldset>}
      {measureChoice !== "literal" && subjectChoice === "asset" && <label>Asset<input disabled={disabled} list="strategy-value-assets" value={assetDraft}
        onChange={(event) => { setAssetDraft(event.target.value.toUpperCase()); onWorkingState?.("incomplete"); }}
        onBlur={() => emitIfComplete()} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
        <datalist id="strategy-value-assets">{assetOptions.map((item) => <option key={item} value={item} />)}</datalist></label>}
      <label>Value<select disabled={disabled} value={measureChoice} onChange={(event) => {
        const next = event.target.value as Measure;
        setMeasureChoice(next);
        if (next === "literal") { setLiteralDraft(""); onWorkingState?.("incomplete"); }
        else queueMicrotask(() => emitIfComplete(next));
      }}><option value="">Choose a value…</option>
        {executable(capabilities, "market.trailing_return") && <option value="trailing_return">Trailing return</option>}
        {executable(capabilities, "market.price.current") && <option value="current_price">Current adjusted price</option>}
        {executable(capabilities, "aggregate.rolling") && <option value="rolling_price">Rolling adjusted price</option>}
        {allowLiteral && <option value="literal">Constant</option>}
      </select></label>
      {indicator && <NumericDraft label="Lookback observations" value={Number(indicator.parameters.lookback_bars ?? 126)} minimum={1} maximum={1000} disabled={disabled} onWorkingState={onWorkingState}
        onCommit={(lookback) => updateBase({ ...indicator, parameters: { ...indicator.parameters, lookback_bars: lookback } })} />}
      {rolling && <><label>Aggregate<select disabled={disabled} value={rolling.operator} onChange={(event) => updateBase({ ...rolling, operator: event.target.value as "mean" | "median" | "min" | "max" })}><option value="mean">Mean</option><option value="median">Median</option><option value="min">Minimum</option><option value="max">Maximum</option></select></label>
        <NumericDraft label="Window observations" value={rolling.window_observations} minimum={1} maximum={1000} disabled={disabled} onWorkingState={onWorkingState}
          onCommit={(window) => updateBase({ ...rolling, window_observations: window })} /></>}
      {measureChoice === "literal" && <NumericDraft label="Constant" value={literal ? Number(literal.value) : Number(literalDraft || 0)}
        display={(value) => literal?.value_type === "percentage" ? value * 100 : value}
        parse={(value) => literal?.value_type === "percentage" ? value / 100 : value}
        disabled={disabled} onWorkingState={onWorkingState} onCommit={(value) => {
          setLiteralDraft(String(value));
          const next: ValueExpression = { kind: "literal", value_type: literal?.value_type ?? "decimal", value };
          onChange(next);
        }} />}
      {measureChoice !== "literal" && executable(capabilities, "arithmetic.scale") && <>
        {!addingTransform && unwrapped.factor === null && <button type="button" className="text-button" onClick={() => { setAddingTransform(true); setFactorDraft(""); onWorkingState?.("incomplete"); }}>+ Add transform</button>}
        {(addingTransform || unwrapped.factor !== null) && <div className="value-transform"><NumericDraft label="Multiply by" value={Number(factorDraft || unwrapped.factor || 1)} step="0.1" minimum={0.000001} disabled={disabled} onWorkingState={onWorkingState}
          onCommit={(factor) => { const base = unwrapped.base; if (base) { setFactorDraft(String(factor)); onChange({ kind: "arithmetic", operator: "multiply", left: base, right: { kind: "literal", value_type: "decimal", value: factor } }); } }} />
          <button type="button" className="text-button danger" onClick={() => { setAddingTransform(false); setFactorDraft(""); if (unwrapped.base) onChange(unwrapped.base); }}>Remove transform</button></div>}
      </>}
      <p className="value-capability-note">Only executable Strategy values reported by the backend are available.</p>
    </div>}
  </div>;
}
