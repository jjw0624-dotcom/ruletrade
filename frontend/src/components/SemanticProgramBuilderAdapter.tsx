import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Connection, type Edge, type Node, type NodeProps, type Viewport } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { isDailyValue, type CanonicalStrategyV2, type ConditionV2, type ProgramStatementV2, type SelectionStatementV2, type ValueExpressionV2, type V2AuthoringOperation } from "../domain/canonicalV2";
import { describeConditionV2, describeProgramStatement, describeValueV2 } from "../domain/v2Semantics";
import type { V2ExecutionCapability } from "../v2ExecutionApi";
import { StrategyBuilderWorkspace, type ProgramBuilderView } from "./StrategyBuilderWorkspace";
import { WorkspaceLeftPanel, type BuilderLibraryObject, type ProductAddAction, type ProductStructureNode } from "./WorkspaceLeftPanel";
import { V2ConditionComposer, V2ConditionDraftComposer, V2ProgramValueComposer } from "./V2SemanticComposer";
import { ProgramBlockyProjection } from "./ProductBlockyProjection";
import { SelectionComposer } from "./SelectionComposer";
import { adaptV2ProductOperation, type BuilderProductOperation } from "../domain/builderProductOperations";
import { projectV2ProductSemantics, visibleProgramStatements, type ProductFlowEdge, type ProductFlowNode } from "../domain/productSemantics";
import { projectProgramCapitalFlow, projectProgramRules, projectProgramSummary } from "../domain/programProjections";
import { ProgramAssetUniverseEditor } from "./AssetWorkspace";
import { addCanvasBlock, duplicateCanvasBlock, emptyProgramWorkingDraft, removeCanvasBlock, setCanvasBlockActive, upsertReusableObject, withBlockDisclosure, withBlockMove, withBlockPosition, withFlowPositions, withProgramDraftConcept, type ProgramDraftConcept, type ProgramWorkingDraft } from "../domain/programWorkingDraft";
import { ENTRY_BLOCK_DEFINITIONS, entryBlockDefinition } from "../domain/entryStyleGrammar";
import { derivePerspectiveBundle, type PerspectiveCapability } from "../domain/perspectiveTranslation";
import { translateDraftIntent } from "../domain/draftIntents";
import { compileFinancialIntent, createFinancialIntentDraft, financialIntentReadiness, updateFinancialIntentDraft, type FinancialIntentDraft, type FinancialIntentRecipe, type IntentStartPath } from "../domain/intentAuthoring";
import "./SemanticProgramBuilderAdapter.css";

function flatten(items: ProgramStatementV2[]): ProgramStatementV2[] {
  return items.flatMap((item) => [item,
    ...(item.kind === "control" ? flatten([...item.then_statements, ...item.otherwise_statements]) : []),
    ...(item.kind === "on_event" ? flatten(item.statements) : []),
    ...(item.kind === "guarded_allocation" ? [item.primary, ...item.overrides.map((override) => override.action), ...(item.fallback ? [item.fallback] : [])] : []),
  ]);
}

function visibleRoots(strategy: CanonicalStrategyV2): ProgramStatementV2[] {
  return visibleProgramStatements(strategy);
}

function assetSetForSelection(strategy: CanonicalStrategyV2, selection: SelectionStatementV2) {
  const group = strategy.definitions.groups.find((item) => item.id === selection.selection.universe_id);
  return strategy.definitions.asset_sets.find((item) => item.id === (group?.asset_set_ref ?? selection.selection.universe_id));
}

export function programAllocationToolDescription(strategy: CanonicalStrategyV2): string {
  const all = flatten(visibleRoots(strategy));
  const selection = all.find((item): item is SelectionStatementV2 => item.kind === "select");
  const allocation = selection && all.find((item) => item.kind === "allocate" && item.method === "equal" && item.legs.some((leg) => leg.target.kind === "selection" && leg.target.ref === selection.output_id));
  return allocation ? "Selected assets are weighted equally within their Investment." : "Choose assets to configure selected-asset weighting.";
}

export function projectProgramProductStructure(strategy: CanonicalStrategyV2): ProductStructureNode {
  return projectV2ProductSemantics(strategy).root;
}

export function projectProgramProductFlow(strategy: CanonicalStrategyV2): ProductFlowNode[] {
  return projectProgramCapitalFlow(strategy).nodes;
}

export function projectProgramProductFlowGraph(strategy: CanonicalStrategyV2): { nodes: ProductFlowNode[]; edges: ProductFlowEdge[] } {
  return projectProgramCapitalFlow(strategy);
}

export function programFlowManifest(graph: { nodes: ProductFlowNode[]; edges: ProductFlowEdge[] }): string {
  return [
    ...graph.nodes.map((node) => `node:${node.id}|${node.role}|${node.label}`),
    ...graph.edges.map((edge) => `edge:${edge.source}->${edge.target}|${edge.role}|${edge.label ?? ""}`),
  ].join(";");
}

type ProgramFlowCanvasData = Record<string, unknown> & {
  title: string;
  detail?: string;
  role: ProductFlowNode["role"];
  hasIncoming: boolean;
  hasOutgoing: boolean;
};
export type ProgramFlowCanvasNode = Node<ProgramFlowCanvasData, "program-product">;
export type ProgramFlowCanvasEdge = Edge<{ role: ProductFlowEdge["role"] }>;

function ProgramFlowCanvasNodeView({ data }: NodeProps<ProgramFlowCanvasNode>) {
  return <div className={`program-flow-node flow-${data.role}`}>
    {data.hasIncoming && <Handle type="target" position={Position.Top} />}
    <strong>{data.title}</strong>{data.detail && <small>{data.detail}</small>}
    {data.hasOutgoing && <Handle type="source" position={Position.Bottom} />}
  </div>;
}
const programFlowNodeTypes = { "program-product": ProgramFlowCanvasNodeView };

export function projectProgramFlowCanvas(graph: { nodes: ProductFlowNode[]; edges: ProductFlowEdge[] }): { nodes: ProgramFlowCanvasNode[]; edges: ProgramFlowCanvasEdge[] } {
  const incoming = new Map<string, ProductFlowEdge[]>();
  const outgoing = new Map<string, ProductFlowEdge[]>();
  for (const edge of graph.edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  }
  const depth = new Map<string, number>();
  const visit = (id: string, active = new Set<string>()): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (active.has(id)) return 0;
    const parents = incoming.get(id) ?? [];
    const nextActive = new Set(active).add(id);
    const value = parents.length ? Math.max(...parents.map((edge) => visit(edge.source, nextActive) + 1)) : 0;
    depth.set(id, value);
    return value;
  };
  graph.nodes.forEach((node) => visit(node.id));
  const layers = new Map<number, ProductFlowNode[]>();
  for (const node of graph.nodes) {
    const layer = depth.get(node.id) ?? 0;
    layers.set(layer, [...(layers.get(layer) ?? []), node]);
  }
  const nodes = graph.nodes.map((item): ProgramFlowCanvasNode => {
    const layer = depth.get(item.id) ?? 0;
    const peers = layers.get(layer) ?? [item];
    const index = peers.findIndex((peer) => peer.id === item.id);
    const gap = peers.length > 2 ? 250 : 300;
    return {
      id: item.id, type: "program-product",
      position: { x: 480 - ((peers.length - 1) * gap) / 2 + index * gap, y: 40 + layer * 145 },
      draggable: item.role !== "timing", deletable: false, connectable: item.role !== "timing",
      data: { title: item.label, detail: item.detail, role: item.role, hasIncoming: incoming.has(item.id), hasOutgoing: outgoing.has(item.id) },
    };
  });
  const edges = graph.edges.map((item): ProgramFlowCanvasEdge => ({
    id: `${item.source}->${item.target}:${item.role}`, source: item.source, target: item.target,
    label: item.label, type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed },
    className: `program-flow-edge flow-${item.role}`, data: { role: item.role },
  }));
  return { nodes, edges };
}

export function programFlowGeometry(graph: { nodes: ProgramFlowCanvasNode[]; edges: ProgramFlowCanvasEdge[] }) {
  return {
    nodeCount: graph.nodes.length, edgeCount: graph.edges.length,
    finitePositions: graph.nodes.every((node) => Number.isFinite(node.position.x) && Number.isFinite(node.position.y)),
  };
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

function GroupDraftInspector({ draft, onChange, onCommit }: {
  draft: Extract<ProgramDraftConcept, { kind: "group" }>;
  onChange: (draft: Extract<ProgramDraftConcept, { kind: "group" }>) => void;
  onCommit: (operation: Extract<BuilderProductOperation, { kind: "addGroup" }>) => void;
}) {
  const name = draft.name.trim();
  return <div className="semantic-inspector-content group-draft"><h2>Group</h2>
    <p>Define a reusable candidate universe. A Group does not receive capital until an Investment targets it.</p>
    <label>Group name<input aria-label="Group name" value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></label>
    <ProgramAssetUniverseEditor assets={draft.assets} onCommit={(assets) => onChange({ ...draft, assets })} />
    <button type="button" className="primary-button" disabled={!name} onClick={() => onCommit({ kind: "addGroup", groupId: draft.semanticId, name, assetSetId: `${draft.semanticId}-assets`, assets: draft.assets })}>Create Group</button>
  </div>;
}

function ChooseDraftInspector({ strategy, draft, onChange, onCommit, onNeedGroup }: {
  strategy: CanonicalStrategyV2;
  draft: Extract<ProgramDraftConcept, { kind: "choose" }>;
  onChange: (draft: Extract<ProgramDraftConcept, { kind: "choose" }>) => void;
  onCommit: (operation: Extract<BuilderProductOperation, { kind: "createChoose" }>) => void;
  onNeedGroup?: () => void;
}) {
  const outputId = draft.outputId.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  const valid = Boolean(draft.groupId && outputId && draft.lookback >= 2 && draft.count >= 1);
  return <div className="semantic-inspector-content choose-draft"><h2>Choose a Subgroup</h2>
    <p>Choose controls membership only. It does not create an Investment or move capital.</p>
    <label>From Group<select aria-label="Choose Group" value={draft.groupId ?? ""} onChange={(event) => onChange({ ...draft, groupId: event.target.value || null })}><option value="" disabled>Choose a Group</option>{strategy.definitions.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
    <label>Selected Subgroup name<input aria-label="Subgroup name" value={draft.outputId} onChange={(event) => onChange({ ...draft, outputId: event.target.value })} /></label>
    <SelectionComposer direction={draft.direction === "highest" ? "descending" : "ascending"} count={draft.count} shortagePolicy={draft.shortage}
      universeEditor={<span>{strategy.definitions.groups.find((group) => group.id === draft.groupId)?.name ?? "No Group selected"}</span>}
      eligibilitySummary={draft.withQualification ? "Candidate return (126) > 0%" : "All candidates qualify"}
      orderSummary={`${draft.lookback}-observation return`}
      orderEditor={<label>Return period<input aria-label="Return period" type="number" min={2} max={2000} value={draft.lookback} onChange={(event) => onChange({ ...draft, lookback: Number(event.target.value) })} /></label>}
      onChange={(value) => onChange({ ...draft, direction: value.direction === "descending" ? "highest" : "lowest", count: value.count, shortage: value.shortagePolicy })} />
    {!strategy.definitions.groups.length && <><p className="form-error">Create a Group before committing this Choose operation. This incomplete draft will be preserved.</p>{onNeedGroup && <button type="button" className="secondary-button" onClick={onNeedGroup}>Define the source Group</button>}</>}
    <button type="button" className="primary-button" disabled={!valid} onClick={() => draft.groupId && onCommit({ kind: "createChoose", semanticId: draft.semanticId, groupId: draft.groupId, outputId, lookback: draft.lookback, direction: draft.direction, take: draft.count, shortage: draft.shortage, ...(draft.withQualification ? { qualification: { lookback: 126, operator: "gt" as const, threshold: 0 } } : {}) })}>Create Subgroup</button>
  </div>;
}

function InvestmentDraftInspector({ strategy, draft, onChange, onCommit, onNeedGroup }: {
  strategy: CanonicalStrategyV2;
  draft: Extract<ProgramDraftConcept, { kind: "investment" }>;
  onChange: (draft: Extract<ProgramDraftConcept, { kind: "investment" }>) => void;
  onCommit: (operation: Extract<BuilderProductOperation, { kind: "setInvestment" }>) => void;
  onNeedGroup?: () => void;
}) {
  const statements = flatten(visibleRoots(strategy));
  const selections = statements.filter((item): item is SelectionStatementV2 => item.kind === "select");
  const assets = [...new Set(strategy.definitions.asset_sets.flatMap((item) => item.assets))];
  const value = draft.targetKind && draft.targetRef ? `${draft.targetKind}:${draft.targetRef}` : "";
  const selected = selections.find((item) => item.output_id === draft.targetRef);
  const scoreTarget = selected?.selection.ranking.kind === "score";
  const amountKind = draft.amountKind ?? null;
  const amountValue = draft.amountValue ?? "";
  const supportedAmount = amountKind === "cash_fraction" && Number(amountValue) === 1;
  const commitReady = Boolean(draft.targetKind && draft.targetRef && supportedAmount && (draft.internalAllocation !== "proportional_score" || scoreTarget));
  return <div className="semantic-inspector-content investment-draft"><h2>Investment</h2>
    <p>Connect Portfolio capital to an Asset, Group, or selected Subgroup. Membership stays owned by Group and Choose.</p>
    <label>Capital target<select aria-label="Investment target" value={value} onChange={(event) => { const [targetKind, ...parts] = event.target.value.split(":"); onChange({ ...draft, targetKind: targetKind as "asset" | "group" | "selection", targetRef: parts.join(":") }); }}><option value="" disabled>Choose a target</option>
      {selections.map((item) => <option key={item.semantic_id} value={`selection:${item.output_id}`}>Subgroup · {item.output_id}</option>)}
      {strategy.definitions.groups.map((group) => <option key={group.id} value={`group:${group.id}`}>Group · {group.name}</option>)}
      {assets.map((asset) => <option key={asset} value={`asset:${asset}`}>Asset · {asset}</option>)}
    </select></label>
    <label>Amount type<select aria-label="Investment amount type" value={amountKind ?? ""} onChange={(event) => onChange({ ...draft, amountKind: (event.target.value || null) as typeof amountKind, amountValue: event.target.value === "cash_fraction" ? "1" : "" })}><option value="" disabled>Choose an amount</option><option value="cash_fraction">Fraction of available cash</option><option value="money">Fixed money amount</option><option value="quantity">Asset quantity</option></select></label>
    {amountKind && <label>{amountKind === "cash_fraction" ? "Cash fraction (1 = 100%)" : amountKind === "money" ? "Money amount" : "Quantity"}<input aria-label="Investment amount" type="number" min="0" step={amountKind === "cash_fraction" ? ".01" : "1"} value={amountValue} onChange={(event) => onChange({ ...draft, amountValue: event.target.value })} /></label>}
    <label>Within target<select aria-label="Investment allocation" value={draft.internalAllocation} onChange={(event) => onChange({ ...draft, internalAllocation: event.target.value as "equal" | "proportional_score" })}><option value="equal">Equal weight</option><option value="proportional_score" disabled={!scoreTarget}>Proportional to positive Score</option></select></label>
    {!assets.length && !strategy.definitions.groups.length && <><p className="form-error">Create a Group first, or leave this Investment draft incomplete until a target exists.</p>{onNeedGroup && <button type="button" className="secondary-button" onClick={onNeedGroup}>Define a target Group</button>}</>}
    {amountKind && !supportedAmount && <p className="value-capability-note">This exact amount is preserved in Working Draft. Fixed-money and quantity execution are not yet represented by SemanticProgramV2, so they are never converted into target weights.</p>}
    <button type="button" className="primary-button" disabled={!commitReady} onClick={() => draft.targetKind && draft.targetRef && onCommit({ kind: "setInvestment", semanticId: draft.semanticId, targetKind: draft.targetKind, targetRef: draft.targetRef, internalAllocation: draft.internalAllocation })}>Create Investment</button>
  </div>;
}

function EventStateDraftInspector({ strategy, semanticId, onComplete }: {
  strategy: CanonicalStrategyV2;
  semanticId: string;
  onComplete: (operation: Extract<V2AuthoringOperation, { kind: "create_program_event_state" }>) => void;
}) {
  const [asset, setAsset] = useState(strategy.definitions.asset_sets.flatMap((item) => item.assets)[0] ?? "");
  const [threshold, setThreshold] = useState(0);
  const [stateKey, setStateKey] = useState("regime");
  const [fromState, setFromState] = useState("waiting");
  const [toState, setToState] = useState("active");
  const clock = strategy.program?.clocks[0];
  const valid = Boolean(clock && asset.trim() && stateKey.trim() && fromState.trim() && toState.trim());
  const complete = () => {
    if (!strategy.program || !clock || !valid) return;
    onComplete({
      kind: "create_program_event_state", semantic_id: semanticId,
      clock_id: clock.id, asset: asset.trim().toUpperCase(), threshold,
      state_key: stateKey.trim(), from_value: fromState.trim(), to_value: toState.trim(),
    });
  };
  return <div className="semantic-inspector-content event-state-draft"><h2>Event and State</h2><p>Define the observation that changes a named strategy state. Nothing is committed until all fields are complete.</p>
    <label>Observed asset<input aria-label="Event asset" value={asset} onChange={(event) => setAsset(event.target.value)} placeholder="QQQ" /></label>
    <label>Adjusted close above<input aria-label="Event threshold" type="number" value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} /></label>
    <label>State name<input aria-label="State name" value={stateKey} onChange={(event) => setStateKey(event.target.value)} /></label>
    <label>From<input aria-label="Initial state" value={fromState} onChange={(event) => setFromState(event.target.value)} /></label>
    <label>To<input aria-label="Next state" value={toState} onChange={(event) => setToState(event.target.value)} /></label>
    <button type="button" className="primary-button" disabled={!valid} onClick={complete}>Create Event → State</button>
  </div>;
}

export function compileControlDraft(strategy: CanonicalStrategyV2, draft: Extract<ProgramDraftConcept, { kind: "control" }>, connections: ProgramWorkingDraft["blockConnections"]): V2AuthoringOperation | null {
  if (!strategy.program || !draft.condition) return null;
  const draftId = `draft:${draft.semanticId}`;
  const thenId = Object.values(connections).find((item) => item.parentId === draftId && item.inputName === "THEN")?.childId.replace(/^statement:/, "");
  const elseId = Object.values(connections).find((item) => item.parentId === draftId && item.inputName === "ELSE")?.childId.replace(/^statement:/, "");
  if (!thenId) return null;
  const roots = strategy.program.statements;
  const thenStatement = roots.find((item) => item.semantic_id === thenId);
  const elseStatement = elseId ? roots.find((item) => item.semantic_id === elseId) : undefined;
  if (!thenStatement || (elseId && !elseStatement)) return null;
  const insertion = roots.findIndex((item) => item.semantic_id === thenId || item.semantic_id === elseId);
  const retained = roots.filter((item) => item.semantic_id !== thenId && item.semantic_id !== elseId);
  const control: ProgramStatementV2 = {
    kind: "control", semantic_id: draft.semanticId, condition: draft.condition,
    then_statements: [thenStatement], otherwise_statements: elseStatement ? [elseStatement] : [],
    unknown_policy: elseStatement ? "otherwise" : "retain",
    clock_id: "clock_id" in thenStatement ? thenStatement.clock_id : strategy.program.clocks[0]?.id ?? null,
  };
  retained.splice(Math.max(0, insertion), 0, control);
  return { kind: "set_semantic_program", program: { ...strategy.program, statements: retained } };
}

function ControlDraftInspector({ strategy, draft, connections, onChange, onCommit }: {
  strategy: CanonicalStrategyV2;
  draft: Extract<ProgramDraftConcept, { kind: "control" }>;
  connections: ProgramWorkingDraft["blockConnections"];
  onChange: (draft: Extract<ProgramDraftConcept, { kind: "control" }>) => void;
  onCommit: (operation: V2AuthoringOperation) => void;
}) {
  const operation = compileControlDraft(strategy, draft, connections);
  return <div className="semantic-inspector-content"><h2>IF / OTHERWISE</h2><p>Create the predicate here, then drag executable statement blocks into DO and OTHERWISE on the canvas.</p>
    {draft.condition ? <V2ConditionComposer condition={draft.condition} strategy={strategy} role="predicate" onWorking={() => undefined} onChange={(condition) => onChange({ ...draft, condition })} />
      : <V2ConditionDraftComposer semanticId={`${draft.semanticId}-condition`} strategy={strategy} role="predicate" onWorking={() => undefined} onComplete={(condition) => onChange({ ...draft, condition })} />}
    <p className="value-capability-note">{operation ? "The visual composition is ready to commit." : "Connect at least one complete statement to DO."}</p>
    <button type="button" className="primary-button" disabled={!operation} onClick={() => operation && onCommit(operation)}>Commit IF / OTHERWISE</button>
  </div>;
}

function ProgramScheduleInspector({ timeframe, onChange }: { timeframe: "session" | "daily" | "weekly" | "monthly"; onChange: (timeframe: "daily" | "monthly") => void }) {
  return <div className="semantic-inspector-content"><h2>Rebalance</h2><p className="fixed-setting">When should this Portfolio evaluate and rebalance?</p><label>Schedule<select aria-label="Rebalance schedule" value={timeframe === "monthly" ? "monthly" : "daily"} onChange={(event) => onChange(event.target.value as "daily" | "monthly")}><option value="daily">Daily close</option><option value="monthly">Monthly close</option></select></label>{timeframe === "weekly" && <p>Weekly timing is preserved but remains read-only until production lowering is available.</p>}<p>The same schedule drives selection and allocation.</p></div>;
}

const intentTitles: Record<FinancialIntentRecipe, string> = {
  single_asset: "Invest in one asset",
  market_regime_rotation: "Market-regime ETF rotation",
  split_portfolio: "Growth + Defensive portfolio",
  weighted_score: "Weighted Score allocation",
  temporal_sequence: "Breakout, retest, confirmation",
  multi_clock_policy: "Weekly context, daily signal",
};

function FinancialIntentInspector({ draft, onChange, onCommit }: {
  draft: FinancialIntentDraft;
  onChange: (draft: FinancialIntentDraft) => void;
  onCommit: (operation: V2AuthoringOperation) => void;
}) {
  const readiness = financialIntentReadiness(draft);
  const operation = compileFinancialIntent(draft);
  const v = draft.values;
  const set = (values: Partial<FinancialIntentDraft["values"]>) => onChange(updateFinancialIntentDraft(draft, values));
  const single = draft.recipe === "single_asset";
  const multiAssets = ["market_regime_rotation", "split_portfolio", "weighted_score", "multi_clock_policy"].includes(draft.recipe);
  return <div className="semantic-inspector-content financial-intent-draft" data-intent-recipe={draft.recipe}>
    <h2>{intentTitles[draft.recipe]}</h2>
    <p className="fixed-setting">Started {draft.startPath.replace("_", " ")} · incomplete intent remains in this workspace until committed.</p>
    {single && <ProgramAssetUniverseEditor assets={v.asset ? [v.asset] : []} onCommit={(assets) => set({ asset: assets[assets.length - 1] ?? null })} />}
    {multiAssets && <ProgramAssetUniverseEditor assets={v.assets} onCommit={(assets) => set({ assets })} />}
    {single && <>
      <label>Timing<select aria-label="Intent timing" value={v.timeframe ?? ""} onChange={(event) => set({ timeframe: event.target.value as "daily" | "monthly" })}><option value="" disabled>Choose timing</option><option value="daily">Every trading day</option><option value="monthly">Every month</option></select></label>
      <label>What happens?<select aria-label="Timing meaning" value={v.timingMeaning ?? ""} onChange={(event) => set({ timingMeaning: event.target.value as "rebalance" | "contribution" })}><option value="" disabled>Choose behavior</option><option value="rebalance">Rebalance existing capital</option><option value="contribution">Add a new contribution</option></select></label>
    </>}
    {["market_regime_rotation", "split_portfolio", "weighted_score"].includes(draft.recipe) && <label>Evaluation timing<select aria-label="Intent evaluation timing" value={v.timeframe ?? ""} onChange={(event) => set({ timeframe: event.target.value as "daily" | "monthly", timingMeaning: "rebalance" })}><option value="" disabled>Choose timing</option><option value="daily">Every trading day</option><option value="monthly">Every month</option></select></label>}
    {draft.recipe === "market_regime_rotation" && <><label>Trend asset<input value={v.trendAsset ?? ""} onChange={(event) => set({ trendAsset: event.target.value.toUpperCase() })} /></label><label>Trend SMA observations<input type="number" min={2} value={v.trendLookback ?? ""} onChange={(event) => set({ trendLookback: Number(event.target.value) })} /></label><label>Ranking return observations<input type="number" min={2} value={v.rankingLookback ?? ""} onChange={(event) => set({ rankingLookback: Number(event.target.value) })} /></label><label>Select Top N<input type="number" min={1} value={v.count ?? ""} onChange={(event) => set({ count: Number(event.target.value) })} /></label><label>OTHERWISE asset<input value={v.fallbackAsset ?? ""} onChange={(event) => set({ fallbackAsset: event.target.value.toUpperCase() })} /></label><p className="fixed-setting">OTHERWISE is an explicit control branch, not Selection shortage fallback.</p></>}
    {draft.recipe === "split_portfolio" && <><label>Growth share (%)<input type="number" min={1} max={99} value={(v.growthWeight ?? 0) * 100} onChange={(event) => set({ growthWeight: Number(event.target.value) / 100 })} /></label><label>Growth return observations<input type="number" min={2} value={v.rankingLookback ?? ""} onChange={(event) => set({ rankingLookback: Number(event.target.value) })} /></label><label>Growth shortage fallback<input value={v.fallbackAsset ?? ""} onChange={(event) => set({ fallbackAsset: event.target.value.toUpperCase() })} /></label><label>Defensive asset<input value={v.defensiveAsset ?? ""} onChange={(event) => set({ defensiveAsset: event.target.value.toUpperCase() })} /></label><p className="fixed-setting">Parallel routes · Growth {Math.round((v.growthWeight ?? 0) * 100)}% / Defensive {Math.round((1 - (v.growthWeight ?? 0)) * 100)}%</p></>}
    {draft.recipe === "weighted_score" && <><label>Short return observations<input type="number" min={2} value={v.shortObservations ?? ""} onChange={(event) => set({ shortObservations: Number(event.target.value) })} /></label><label>Short weight<input type="number" min={0.01} step={0.01} value={v.shortWeight ?? ""} onChange={(event) => set({ shortWeight: Number(event.target.value) })} /></label><label>Long return observations<input type="number" min={2} value={v.longObservations ?? ""} onChange={(event) => set({ longObservations: Number(event.target.value) })} /></label><label>Long weight<input type="number" min={0.01} step={0.01} value={v.longWeight ?? ""} onChange={(event) => set({ longWeight: Number(event.target.value) })} /></label><label>Select Top N<input type="number" min={1} value={v.count ?? ""} onChange={(event) => set({ count: Number(event.target.value) })} /></label><label>Missing values<select value={v.missingPolicy ?? "require_all"} onChange={(event) => set({ missingPolicy: event.target.value as "require_all" | "renormalize_available" })}><option value="require_all">Require all Score terms</option><option value="renormalize_available">Renormalize available terms</option></select></label><p className="fixed-setting">Allocate proportionally to positive Score.</p></>}
    {draft.recipe === "temporal_sequence" && <><label>Observed asset<input value={v.asset ?? ""} onChange={(event) => set({ asset: event.target.value.toUpperCase() })} /></label><label>Breakout adjusted close<input type="number" value={v.breakoutThreshold ?? ""} onChange={(event) => set({ breakoutThreshold: Number(event.target.value) })} /></label><label>Retest window (observations)<input type="number" min={1} value={v.retestWindow ?? ""} onChange={(event) => set({ retestWindow: Number(event.target.value) })} /></label><label>Confirmation window (observations)<input type="number" min={1} value={v.confirmationWindow ?? ""} onChange={(event) => set({ confirmationWindow: Number(event.target.value) })} /></label><label>Expiry state<input value={v.expiryState ?? ""} onChange={(event) => set({ expiryState: event.target.value })} /></label><p className="fixed-setting">Breakout → remember level → bounded retest → bounded confirmation → enter or expire.</p></>}
    {draft.recipe === "multi_clock_policy" && <><label>Weekly context asset<input value={v.weeklyContextAsset ?? ""} onChange={(event) => set({ weeklyContextAsset: event.target.value.toUpperCase() })} /></label><label>Completed weekly threshold<input type="number" value={v.weeklyThreshold ?? ""} onChange={(event) => set({ weeklyThreshold: Number(event.target.value) })} /></label><label>Daily signal asset<input value={v.dailySignalAsset ?? ""} onChange={(event) => set({ dailySignalAsset: event.target.value.toUpperCase() })} /></label><label>Daily threshold<input type="number" value={v.dailyThreshold ?? ""} onChange={(event) => set({ dailyThreshold: Number(event.target.value) })} /></label><label>Unknown risk guard<select value={v.unknownRiskPolicy ?? "block"} onChange={(event) => set({ unknownRiskPolicy: event.target.value as "block" | "allow" })}><option value="block">Block exposure</option><option value="allow">Allow primary policy</option></select></label><p className="fixed-setting">Only completed weekly observations feed daily action. Risk policy has higher priority.</p></>}
    {readiness.unresolved.length > 0 && <ul>{readiness.unresolved.map((item) => <li key={item}>{item}</li>)}</ul>}
    <p className={readiness.status === "unsupported" ? "form-error" : "value-capability-note"}>{readiness.productMessage}</p>
    <button type="button" className="primary-button" disabled={!operation} onClick={() => operation && onCommit(operation)}>Commit strategy meaning</button>
  </div>;
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

function ProgramSplitInspector({ strategy, statement, onApply }: {
  strategy: CanonicalStrategyV2;
  statement: Extract<ProgramStatementV2, { kind: "allocate" }>;
  onApply: (investments: Array<{ id: string; weight: number }>) => void;
}) {
  const selections = flatten(visibleRoots(strategy)).filter((item): item is SelectionStatementV2 => item.kind === "select");
  const groupId = (leg: Extract<ProgramStatementV2, { kind: "allocate" }>["legs"][number]) => leg.target.kind === "group" ? leg.target.ref
    : leg.target.kind === "selection" ? selections.find((item) => item.output_id === leg.target.ref)?.selection.universe_id ?? null
      : null;
  const initial = () => Object.fromEntries(statement.legs.flatMap((leg) => { const id = groupId(leg); return id ? [[id, Number(leg.weight ?? 0) * 100]] : []; }));
  const [weights, setWeights] = useState<Record<string, number>>(initial);
  useEffect(() => setWeights(initial()), [statement]);
  const legs = statement.legs.flatMap((leg) => { const id = groupId(leg); return id ? [{ leg, id }] : []; });
  const total = legs.reduce((sum, item) => sum + (weights[item.id] ?? 0), 0);
  const valid = legs.length === statement.legs.length && legs.every((item) => { const value = weights[item.id] ?? -1; return Number.isFinite(value) && value >= 0 && value <= 100; }) && Math.abs(total - 100) < .000001;
  return <div className="semantic-inspector-content"><h2>Split</h2><p className="fixed-setting">Route Portfolio capital across Investments.</p>{legs.map(({ leg, id }) => <label key={leg.semantic_id}>{strategy.definitions.groups.find((group) => group.id === id)?.name || "Investment"} share (%)<input type="number" min={0} max={100} step="1" value={weights[id] ?? 0} onChange={(event) => setWeights({ ...weights, [id]: Number(event.target.value) })} /></label>)}<p>Total · {total}%</p><button type="button" className="primary-button" disabled={!valid} onClick={() => onApply(legs.map(({ id }) => ({ id, weight: weights[id] / 100 })))}>Apply Split</button>{!valid && <p>Split shares must total exactly 100%.</p>}</div>;
}

function ProgramFlowProjection({ flow, edges, blank, onSelect, positions, viewport, onPositionChange, onViewportChange, onConnect, onDisconnect }: { flow: ProductFlowNode[]; edges: ProductFlowEdge[]; blank: boolean; onSelect: (id: string | null) => void; positions: Record<string, { x: number; y: number }>; viewport: Viewport | null; onPositionChange: (id: string, position: { x: number; y: number }) => void; onViewportChange: (viewport: Viewport) => void; onConnect: (connection: Connection) => void; onDisconnect: (source: string, target: string) => void }) {
  const manifest = programFlowManifest({ nodes: flow, edges });
  const projected = projectProgramFlowCanvas({ nodes: flow, edges });
  const canvas = { ...projected, nodes: projected.nodes.map((node) => ({ ...node, position: positions[node.id] ?? node.position })) };
  const geometry = programFlowGeometry(canvas);
  const focusById = new Map(flow.map((node) => [node.id, node.focusId ?? node.id]));
  return <section className="representation-layer v2-flow v2-flow-reactflow" aria-label="Flow capital projection"
    data-projection-contract="flow"
    data-flow-manifest={manifest} data-flow-canvas-mounted="true"
    data-flow-projected-node-count={canvas.nodes.length} data-flow-supplied-node-count={canvas.nodes.length}
    data-flow-finite-positions={geometry.finitePositions} data-flow-fit-view="true"
    data-flow-reactflow-node-manifest={manifest}>
    <div className="v2-flow-reactflow-boundary" data-flow-reactflow-boundary>
      <ReactFlow<ProgramFlowCanvasNode, ProgramFlowCanvasEdge>
        nodes={canvas.nodes} edges={canvas.edges} nodeTypes={programFlowNodeTypes}
        onNodeClick={(_, node) => onSelect(focusById.get(node.id) ?? node.id)}
        onPaneClick={() => onSelect(null)} onNodeDragStop={(_, node) => onPositionChange(node.id, node.position)}
        onMoveEnd={(_, nextViewport) => onViewportChange(nextViewport)} onConnect={onConnect}
        onEdgesDelete={(deleted) => deleted.forEach((edge) => onDisconnect(edge.source, edge.target))}
        nodesDraggable nodesConnectable elementsSelectable panOnDrag selectionOnDrag={false}
        fitView={!viewport} defaultViewport={viewport ?? { x: 0, y: 0, zoom: 1 }} fitViewOptions={{ padding: .14, maxZoom: 1.25 }} minZoom={.45} maxZoom={1.6}>
        <Background gap={24} size={1} /><Controls showInteractive={false} />
      </ReactFlow>
    </div>
    {blank && <p className="v2-flow-empty">No capital route has been defined yet.</p>}
  </section>;
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
    const dependentInvestments = flatten(visibleRoots(strategy)).filter((item) => item.kind === "allocate" && item.legs.some((leg) => leg.target.kind === "selection" && leg.target.ref === statement.output_id));
    return <div className="semantic-inspector-content"><h2>Choose · selected Subgroup</h2><label>Subgroup name<input aria-label="Subgroup name" defaultValue={statement.output_id} onBlur={(event) => { const output_id = event.target.value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, ""); if (output_id && output_id !== statement.output_id) apply({ kind: "rename_program_subgroup", semantic_id: statement.semantic_id, output_id }); }} /></label><SelectionComposer
      direction={selection.direction} count={selection.count} shortagePolicy={selection.shortage_policy}
      universeEditor={<select aria-label="Selection universe" value={selection.universe_id} onChange={(event) => { const universe_id = event.target.value; set({ ...selection, universe_id, binding: { ...selection.binding, domain_id: universe_id } }); }}>{strategy.definitions.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}{strategy.definitions.asset_sets.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select>}
      eligibilitySummary={selection.eligibility ? describeConditionV2(selection.eligibility) : "All candidates qualify"}
      eligibilityEditor={selection.eligibility ? <p className="fixed-setting">Select Qualification in Structure for detailed editing.</p> : addingEligibility ? <V2ConditionDraftComposer semanticId={`${statement.semantic_id}-eligibility`} strategy={strategy} role="eligibility" onWorking={working} onComplete={(condition) => { setAddingEligibility(false); apply({ kind: "set_program_condition", semantic_id: statement.semantic_id, role: "selection_eligibility", condition }); }} /> : <button type="button" className="secondary-button" onClick={() => { setAddingEligibility(true); working(true); }}>+ Add eligibility</button>}
      orderSummary={describeValueV2(selection.ranking)}
      orderEditor={<V2ProgramValueComposer value={selection.ranking} strategy={strategy} role="ranking" onWorking={working} onChange={(value) => apply({ kind: "set_program_value", semantic_id: statement.semantic_id, role: "selection_ranking", value })} />}
      fallbackSummary={selection.fallback_asset ?? "None"}
      fallbackEditor={<input aria-label="Fallback asset" defaultValue={selection.fallback_asset ?? ""} placeholder="None" onBlur={(event) => set({ ...selection, fallback_asset: event.target.value.trim().toUpperCase() || null })} />}
      onChange={(value) => set({ ...selection, direction: value.direction, count: value.count, shortage_policy: value.shortagePolicy })}
    /><p className="value-capability-note">FROM uses {universe?.name ?? selection.universe_id}. Fallback is distinct from shortage policy and IF / OTHERWISE.</p>
      <p>{dependentInvestments.length ? `Used by ${dependentInvestments.length} Investment${dependentInvestments.length === 1 ? "" : "s"}. Disconnect capital before deleting this Subgroup.` : "This Subgroup is not currently used by an Investment."}</p>
      <button type="button" className="text-button" disabled={dependentInvestments.length > 0} onClick={() => apply({ kind: "remove_program_choose", semantic_id: statement.semantic_id })}>Delete Choose and Subgroup</button>
    </div>;
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

export function SemanticProgramBuilderAdapter({ canonical, dirty, status, message, onHome, apply, save, undo, redo, canUndo, canRedo, working, run, executionCapability, testPanel = null, onCloseTestPanel = () => undefined, initialView = "blocky", workingDraft: suppliedWorkingDraft, onWorkingDraftChange }: {
  canonical: CanonicalStrategyV2; dirty: boolean; status: "saved" | "updating" | "invalid" | "unfinished"; message: string;
  onHome: () => void; apply: (operation: V2AuthoringOperation) => void; save: () => void;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean; working: (unfinished: boolean) => void;
  run: () => void; executionCapability: V2ExecutionCapability | null;
  testPanel?: ReactNode | null;
  onCloseTestPanel?: () => void;
  initialView?: ProgramBuilderView;
  workingDraft?: ProgramWorkingDraft;
  onWorkingDraftChange?: (draft: ProgramWorkingDraft) => void;
}) {
  const [view, setView] = useState<ProgramBuilderView>(initialView);
  const roots = useMemo(() => visibleRoots(canonical), [canonical]);
  const all = useMemo(() => flatten(roots), [roots]);
  const productStatements = useMemo(() => all.filter((item) => item.kind !== "unresolved"), [all]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [localWorkingDraft, setLocalWorkingDraft] = useState(() => emptyProgramWorkingDraft(canonical.program?.semantic_id ?? canonical.metadata.name));
  const workingDraft = suppliedWorkingDraft ?? localWorkingDraft;
  const workingDraftRef = useRef(workingDraft);
  workingDraftRef.current = workingDraft;
  const updateWorkingDraft = useCallback((next: ProgramWorkingDraft) => {
    workingDraftRef.current = next;
    (onWorkingDraftChange ?? setLocalWorkingDraft)(next);
  }, [onWorkingDraftChange]);
  const [layoutUndo, setLayoutUndo] = useState<ProgramWorkingDraft[]>([]);
  const [layoutRedo, setLayoutRedo] = useState<ProgramWorkingDraft[]>([]);
  const layoutUndoRef = useRef(layoutUndo);
  const layoutRedoRef = useRef(layoutRedo);
  layoutUndoRef.current = layoutUndo;
  layoutRedoRef.current = layoutRedo;
  const updateLayoutDraft = useCallback((next: ProgramWorkingDraft) => {
    const current = workingDraftRef.current;
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    const nextUndo = [...layoutUndoRef.current, current];
    layoutUndoRef.current = nextUndo;
    layoutRedoRef.current = [];
    setLayoutUndo(nextUndo);
    setLayoutRedo([]);
    updateWorkingDraft(next);
  }, [updateWorkingDraft]);
  const draft = workingDraft.concept;
  const setDraft = useCallback((next: ProgramDraftConcept) => updateWorkingDraft(withProgramDraftConcept(workingDraftRef.current, next)), [updateWorkingDraft]);
  const setDraftAt = useCallback((next: Exclude<ProgramDraftConcept, null>, position?: { x: number; y: number }) => {
    let value = withProgramDraftConcept(workingDraftRef.current, next);
    if (position) value = withBlockPosition(value, `draft:${next.semanticId}`, position);
    updateWorkingDraft(value);
  }, [updateWorkingDraft]);
  const selectedStatementId = selectedId?.match(/^investment:([^:]+)/)?.[1] ?? selectedId;
  const selected = productStatements.find((item) => item.semantic_id === selectedStatementId) ?? null;
  const selectedSelectionId = selectedId?.match(/^(?:qualification|fallback):(.+)$/)?.[1] ?? null;
  const selectedSelection = all.find((item): item is SelectionStatementV2 => item.kind === "select" && item.semantic_id === selectedSelectionId) ?? null;
  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) { setDraft(null); onCloseTestPanel(); }
  }, [setDraft, onCloseTestPanel]);
  useEffect(() => { if (draft && all.some((item) => item.semantic_id === draft.semanticId)) { setDraft(null); working(false); } }, [all, draft, working]);
  useEffect(() => {
    if (!selectedId) return;
    const valid = selectedId === "portfolio" || selectedId === "split" || selectedId === "rebalance"
      || productStatements.some((item) => item.semantic_id === selectedId)
      || (selectedId.startsWith("group:") && canonical.definitions.groups.some((item) => item.id === selectedId.slice("group:".length)))
      || (selectedId.startsWith("investment:") && productStatements.some((item) => item.kind === "allocate" && item.semantic_id === selectedId.match(/^investment:([^:]+)/)?.[1]))
      || (selectedId.startsWith("assets:") && canonical.definitions.asset_sets.some((item) => item.id === selectedId.slice("assets:".length)))
      || (/^(?:qualification|fallback):/.test(selectedId) && Boolean(selectedSelection));
    if (!valid) setSelectedId(null);
  }, [canonical.definitions.asset_sets, canonical.definitions.groups, productStatements, selectedId, selectedSelection]);
  const clock = canonical.program?.clocks[0];
  const applyProduct = (operation: BuilderProductOperation, address: Parameters<typeof adaptV2ProductOperation>[2] = {}) => {
    const native = adaptV2ProductOperation(canonical, operation, { clockId: clock?.id, ...address });
    if (native[0]) apply(native[0]);
  };
  const selections = all.filter((item): item is SelectionStatementV2 => item.kind === "select");
  const selectedGroupId = selectedId?.startsWith("group:") ? selectedId.slice("group:".length)
    : selectedId?.startsWith("assets:") ? canonical.definitions.groups.find((group) => group.asset_set_ref === selectedId.slice("assets:".length))?.id
      : selectedSelection?.selection.universe_id
        ?? (selected?.kind === "select" ? selected.selection.universe_id : undefined);
  const unconfiguredGroup = canonical.definitions.groups.find((group) => !selections.some((item) => item.selection.universe_id === group.id));
  const group = canonical.definitions.groups.find((item) => item.id === selectedGroupId)
    ?? unconfiguredGroup
    ?? canonical.definitions.groups[0];
  const selection = selections.find((item) => item.selection.universe_id === group?.id)
    ?? selectedSelection
    ?? (selectedGroupId ? undefined : selections[0]);
  const startSelectionDraft = (withQualification = false, position?: { x: number; y: number }) => {
    if (!group) return;
    setDraftAt({ kind: "selection", semanticId: nextId(canonical, "selection"), universeId: group.id, withQualification }, position);
    setSelectedId(null); working(true); setView("blocky");
  };
  const startGroupDraft = (position?: { x: number; y: number }) => {
    const number = canonical.definitions.groups.length + 1;
    setDraftAt({ kind: "group", semanticId: `group-${number}`, name: `Group ${number}`, assets: [] }, position);
    setSelectedId(null); working(true); setView("blocky");
  };
  const startChooseDraft = (withQualification = false, position?: { x: number; y: number }) => {
    const semanticId = nextId(canonical, "choose");
    setDraftAt({ kind: "choose", semanticId, groupId: group?.id ?? null, outputId: `${semanticId}-subgroup`, lookback: 126, direction: "highest", count: 2, shortage: "require_full", withQualification }, position);
    setSelectedId(null); working(true); setView("blocky");
  };
  const startInvestmentDraft = (position?: { x: number; y: number }) => {
    setDraftAt({ kind: "investment", semanticId: nextId(canonical, "investment"), targetKind: null, targetRef: null, internalAllocation: "equal", amountKind: null, amountValue: "" }, position);
    setSelectedId(null); working(true); setView("blocky");
  };
  const startEventStateDraft = (position?: { x: number; y: number }) => { setDraftAt({ kind: "event_state", semanticId: nextId(canonical, "event-state") }, position); setSelectedId(null); working(true); setView("blocky"); };
  const startControlDraft = (position?: { x: number; y: number }) => { setDraftAt({ kind: "control", semanticId: nextId(canonical, "control"), condition: null }, position); setSelectedId(null); working(true); setView("blocky"); };
  const selectionAllocation = selection ? all.find((item) => item.kind === "allocate" && item.method === "equal" && item.legs.some((leg) => leg.target.kind === "selection" && leg.target.ref === selection.output_id)) : undefined;
  const portfolioSplit = roots.find((item): item is Extract<ProgramStatementV2, { kind: "allocate" }> => item.kind === "allocate" && item.method === "fixed" && item.legs.length > 1);
  const groupAssets = canonical.definitions.asset_sets.find((item) => item.id === group?.asset_set_ref);
  const startFinancialIntent = (recipe: FinancialIntentRecipe, startPath: IntentStartPath, position?: { x: number; y: number }) => {
    let intent = createFinancialIntentDraft(recipe, startPath, nextId(canonical, `intent-${recipe}`));
    if (recipe === "single_asset") intent = updateFinancialIntentDraft(intent, {
      asset: groupAssets?.assets.length === 1 ? groupAssets.assets[0]! : null,
      timeframe: clock?.timeframe === "monthly" ? "monthly" : clock?.timeframe === "daily" ? "daily" : null,
      timingMeaning: startPath === "timing_first" ? "rebalance" : null,
    });
    setDraftAt(intent, position); setSelectedId(null); working(true); setView(startPath === "flow_first" ? "flow" : "blocky");
  };
  const addEntryBlock = (definitionId: string, position = { x: 320, y: 80 }) => {
    const definition = entryBlockDefinition(definitionId);
    if (!definition) return;
    const used = new Set(Object.keys(workingDraftRef.current.canvasBlocks));
    let index = used.size + 1;
    let id = `draft:${definitionId}-${index}`;
    while (used.has(id)) { index += 1; id = `draft:${definitionId}-${index}`; }
    const objectKind = definitionId === "create-variable" ? "variable" : definitionId === "create-function" ? "function" : definitionId === "signal-reference" ? "signal" : null;
    const objectId = objectKind ? `${objectKind}-${index}` : null;
    let next = addCanvasBlock(workingDraftRef.current, {
      id, definitionId, label: definition.label, active: false, objectRef: objectId, createdAt: new Date().toISOString(),
    }, position);
    if (objectKind && objectId) next = upsertReusableObject(next, { id: objectId, kind: objectKind, name: `${definition.label} ${index}`, version: 1, dependencies: [], capability: "draft_only" });
    updateLayoutDraft(next); setSelectedId(id); working(true); setView("blocky");
  };
  const addInvestment = () => startInvestmentDraft();
  const semanticTools: ProductAddAction[] = [
    { id: "investment", category: "Capital", label: "Investment", description: "Connect Portfolio capital to an Asset, Group, or selected Subgroup.", availability: "draftable", disabled: Boolean(draft), onAdd: addInvestment },
    { id: "split", category: "Capital", label: "Split", description: portfolioSplit ? "This Portfolio already has a Split; edit its Investments instead." : "Split capital across two investments.", availability: portfolioSplit ? "invalid_here" : canonical.definitions.groups.length < 2 ? "needs_context" : "ready", disabled: canonical.definitions.groups.length < 2 || Boolean(portfolioSplit), onAdd: () => applyProduct({ kind: "setAllocation", method: "fixed", investments: canonical.definitions.groups.slice(0, 2).map((group) => ({ id: group.id, weight: .5 })) }) },
    { id: "group", category: "Destination", label: "Group", description: "Create a reusable candidate universe without allocating capital.", availability: "draftable", disabled: Boolean(draft), onAdd: () => startGroupDraft() },
    { id: "sleeve", category: "Destination", label: "Sleeve", description: "Legacy compatibility label. New Strategies use explicit Group, Subgroup, and Investment objects.", availability: "invalid_here", disabled: true, onAdd: () => undefined },
    { id: "assets", category: "Destination", label: "Assets", description: groupAssets ? "Edit this Group's members." : "Create a Group and define its members.", availability: groupAssets ? "ready" : "draftable", disabled: Boolean(draft), onAdd: () => groupAssets ? select(`assets:${groupAssets.id}`) : startGroupDraft() },
    { id: "if", category: "Routing", label: "IF / OTHERWISE", description: "Draft conditional capital routing here. Execution support is assessed only after the semantic branches are complete.", availability: "draftable", disabled: Boolean(draft), onAdd: () => startControlDraft() },
    { id: "qualification", category: "Routing", label: "Qualification", description: selection?.selection.universe_id === group?.id ? "Configure which Group members qualify." : group ? "Create a selected Subgroup with Qualification." : "Draft Choose now and attach a Group later.", availability: group ? "ready" : "draftable", disabled: Boolean(draft), onAdd: () => selection?.selection.universe_id === group?.id ? select(`qualification:${selection.semantic_id}`) : startChooseDraft(true) },
    { id: "choose-assets", category: "Routing", label: "Choose", description: selection?.selection.universe_id === group?.id ? "Edit this Group's selected Subgroup." : "Rank Group members and produce a named Subgroup.", availability: group ? "ready" : "draftable", disabled: Boolean(draft), onAdd: () => selection?.selection.universe_id === group?.id ? select(selection.semantic_id) : startChooseDraft() },
    { id: "allocation", category: "Allocation", label: "Allocation", description: selection ? programAllocationToolDescription(canonical) : "Start with an allocation intent; complete assets and timing before commit.", availability: "ready", disabled: false, onAdd: () => { if (selectionAllocation) select(selectionAllocation.semantic_id); else if (selection) applyProduct({ kind: "setAllocation", method: "equal" }, { selectionId: selection.semantic_id }); else startFinancialIntent("single_asset", "allocation_first"); } },
    { id: "schedule", category: "Timing", label: "Rebalance", description: roots.some((item) => item.kind === "allocate") ? "Configure the Portfolio rebalance cadence." : "Start with timing, then complete an Investment.", availability: "ready", disabled: false, onAdd: () => roots.some((item) => item.kind === "allocate") ? select("rebalance") : startFinancialIntent("single_asset", "timing_first") },
    { id: "cooldown", category: "Behavior", label: "Cooldown", description: "Cooldown meaning is preserved by the semantic model but is not authorable or production-lowerable in this profile yet.", availability: "unsupported_execution", disabled: true, onAdd: () => undefined },
    { id: "fallback", category: "Behavior", label: "Fallback", description: selection ? "Choose the asset used when too few qualify." : "Choose assets first.", availability: selection ? "ready" : "needs_context", disabled: !selection, onAdd: () => selection && select(`fallback:${selection.semantic_id}`) },
    { id: "logic-condition", category: "Logic", label: "Condition", description: selection ? "Edit a nested Qualification Condition." : "Create a Subgroup with a Qualification Condition.", availability: group ? "ready" : "draftable", disabled: Boolean(draft), onAdd: () => selection ? select(`qualification:${selection.semantic_id}`) : startChooseDraft(true) },
    { id: "logic-control", category: "Logic", label: "IF / OTHERWISE", description: "Create an unfinished condition, then connect complete statement blocks to its branches.", availability: "draftable", disabled: Boolean(draft), onAdd: () => startControlDraft() },
    { id: "data-score", category: "Data", label: "Value / Score", description: selection ? "Edit the Selection ranking Value or weighted Score." : "Create a Selection before adding its ranking Value.", availability: selection ? "ready" : "needs_context", disabled: !selection, onAdd: () => selection && select(selection.semantic_id) },
    { id: "logic-selection", category: "Selection", label: "Rank and select", description: selection ? "Edit the committed ranking and Top N Subgroup." : "Create a ranked Subgroup from a Group.", availability: group ? "ready" : "draftable", disabled: Boolean(draft), onAdd: () => selection ? select(selection.semantic_id) : startChooseDraft() },
    { id: "state-event", category: "State", label: "Event → State", description: groupAssets?.assets.length ? "Draft an Event and atomic State transition. Runtime support is assessed after commit." : "Choose Group assets first.", availability: groupAssets?.assets.length ? "draftable" : "needs_context", disabled: !groupAssets?.assets.length, onAdd: startEventStateDraft },
    { id: "logic-allocation", category: "Allocation", label: "Allocation / Policy", description: all.some((item) => item.kind === "guarded_allocation") ? "Inspect the committed policy precedence." : selectionAllocation ? "Inspect selected-asset allocation." : "Add equal allocation for the current Selection.", availability: selection ? "ready" : "needs_context", disabled: !selection, onAdd: () => { const policy = all.find((item) => item.kind === "guarded_allocation") ?? selectionAllocation; if (policy) select(policy.semantic_id); else if (selection) applyProduct({ kind: "setAllocation", method: "equal" }, { selectionId: selection.semantic_id }); } },
    { id: "logic-timing", category: "Timing", label: "Clock / Rebalance", description: "Edit the semantic evaluation clock.", availability: roots.some((item) => item.kind === "allocate") ? "ready" : "needs_context", disabled: !roots.some((item) => item.kind === "allocate"), onAdd: () => select("rebalance") },
    { id: "intent-market-regime", category: "Logic", label: "Market regime rotation", description: "Author explicit trend and OTHERWISE routes; this composition is not production-lowerable yet.", availability: "unsupported_execution", disabled: Boolean(draft), onAdd: () => startFinancialIntent("market_regime_rotation", "logic_first") },
    { id: "intent-split", category: "Capital", label: "Growth + Defensive", description: "Author a 70/30 parallel sleeve strategy; this composition is not production-lowerable yet.", availability: "unsupported_execution", disabled: Boolean(draft), onAdd: () => startFinancialIntent("split_portfolio", "flow_first") },
    { id: "intent-score", category: "Data", label: "Weighted Score", description: "Rank a universe with explicit weighted return horizons.", availability: "ready", disabled: Boolean(draft), onAdd: () => startFinancialIntent("weighted_score", "logic_first") },
    { id: "intent-temporal", category: "State", label: "Breakout sequence", description: "Draft breakout, retest, confirmation, memory and expiry together.", availability: "ready", disabled: Boolean(draft), onAdd: () => startFinancialIntent("temporal_sequence", "logic_first") },
    { id: "intent-multiclock", category: "State", label: "Weekly context + daily signal", description: "Use completed weekly context with daily action and risk precedence.", availability: "ready", disabled: Boolean(draft), onAdd: () => startFinancialIntent("multi_clock_policy", "timing_first") },
    { id: "intent-market-assets", category: "Destination", label: "Rotation universe", description: "Start market-regime rotation by choosing its explicit assets.", availability: "ready", disabled: Boolean(draft), onAdd: () => startFinancialIntent("market_regime_rotation", "asset_first") },
    { id: "intent-split-allocation", category: "Allocation", label: "Growth / Defensive 70 / 30", description: "Start from portfolio shares, then complete both capital routes.", availability: "ready", disabled: Boolean(draft), onAdd: () => startFinancialIntent("split_portfolio", "allocation_first") },
    { id: "intent-score-assets", category: "Destination", label: "Score universe", description: "Choose assets first, then define the Score and Selection.", availability: "ready", disabled: Boolean(draft), onAdd: () => startFinancialIntent("weighted_score", "asset_first") },
    { id: "intent-breakout-asset", category: "Destination", label: "Breakout asset", description: "Choose the observed asset before defining the temporal sequence.", availability: "ready", disabled: Boolean(draft), onAdd: () => startFinancialIntent("temporal_sequence", "asset_first") },
    { id: "intent-risk-first", category: "Behavior", label: "Risk policy first", description: "Define Unknown risk behavior before clocks and signals.", availability: "ready", disabled: Boolean(draft), onAdd: () => startFinancialIntent("multi_clock_policy", "logic_first") },
  ];
  const startEntryTool = (definitionId: string) => {
    if (definitionId === "invest") { startInvestmentDraft(); return; }
    if (definitionId === "create-group") { startGroupDraft(); return; }
    if (definitionId === "choose-group") { startChooseDraft(); return; }
    if (definitionId === "if-otherwise") { startControlDraft(); return; }
    if (definitionId === "weighted-score") { startFinancialIntent("weighted_score", "logic_first"); return; }
    addEntryBlock(definitionId);
  };
  const entryTools: ProductAddAction[] = ENTRY_BLOCK_DEFINITIONS.map((definition) => ({
    id: `entry:${definition.id}`,
    category: definition.category,
    label: definition.label,
    description: definition.description,
    availability: definition.execution === "verified" ? "ready" : definition.execution === "draft_only" ? "unsupported_execution" : "draftable",
    disabled: false,
    onAdd: () => startEntryTool(definition.id),
  }));
  const tools = view === "blocky" ? entryTools : semanticTools;
  const blank = canonical.definitions.groups.length === 0 && roots.length === 0 && draft === null;
  const structure = projectProgramProductStructure(canonical);
  const perspectiveCapability: PerspectiveCapability = {
    representable: true,
    referenceEvaluable: executionCapability?.reference_valid ?? null,
    backendLowerable: executionCapability?.backend_lowerable ?? false,
    dockerVerified: null,
    providerSupported: executionCapability ? executionCapability.provider_state !== "unavailable" : null,
    uiAuthorable: executionCapability?.authorable ?? true,
    runtimeAvailable: executionCapability ? executionCapability.runtime_state === "available" : null,
  };
  const perspectives = useMemo(() => derivePerspectiveBundle(canonical, perspectiveCapability), [canonical, executionCapability]);
  const libraryObjects: BuilderLibraryObject[] = [
    ...canonical.definitions.groups.map((item) => ({ id: item.id, kind: "group" as const, name: item.name, draft: false, dependencyCount: selections.filter((selection) => selection.selection.universe_id === item.id).length })),
    ...selections.map((item) => ({ id: item.output_id, kind: "subgroup" as const, name: item.output_id, draft: false, dependencyCount: all.filter((statement) => statement.kind === "allocate" && statement.legs.some((leg) => leg.target.ref === item.output_id)).length })),
    ...Object.values(workingDraft.reusableObjects).map((item) => ({ id: item.id, kind: item.kind, name: item.name, draft: true, dependencyCount: item.dependencies.length })),
  ];
  const flowGraph = perspectives.capitalFlow;
  const flow = flowGraph.nodes;
  const blocky = perspectives.decisionLogic.blocks;
  const rules = useMemo(() => projectProgramRules(canonical), [canonical]);
  const summary = useMemo(() => projectProgramSummary(canonical), [canonical]);
  const switchView = (next: ProgramBuilderView) => setView(next);
  const selectedGroup = selectedId?.startsWith("group:") ? canonical.definitions.groups.find((item) => item.id === selectedId.slice("group:".length)) : null;
  const finishDraftOperation = (operation: BuilderProductOperation) => { setDraft(null); working(false); applyProduct(operation); };
  const groupDraftFor = (resume: Extract<ProgramDraftConcept, { kind: "choose" | "investment" }>) => {
    const number = canonical.definitions.groups.length + 1;
    setDraft({ kind: "group", semanticId: `group-${number}`, name: `Group ${number}`, assets: [], resume });
  };
  const selectedCanvasBlock = selectedId ? workingDraft.canvasBlocks[selectedId] : undefined;
  const inspector = selectedCanvasBlock ? <div className="semantic-inspector-content entry-block-inspector" data-entry-block={selectedCanvasBlock.definitionId}>
    <h2>{selectedCanvasBlock.label}</h2>
    <p>{entryBlockDefinition(selectedCanvasBlock.definitionId)?.description}</p>
    <p className="value-capability-note">{entryBlockDefinition(selectedCanvasBlock.definitionId)?.execution === "verified" ? "This block has verified runtime semantics when connected into a complete active graph." : "This block is preserved in Working Draft and is not sent to execution."}</p>
    <label><input type="checkbox" checked={selectedCanvasBlock.active} onChange={(event) => updateLayoutDraft(setCanvasBlockActive(workingDraftRef.current, selectedCanvasBlock.id, event.target.checked))} /> Active graph root</label>
    <div className="entry-block-actions"><button type="button" className="secondary-button" onClick={() => {
      let index = Object.keys(workingDraftRef.current.canvasBlocks).length + 1; let id = `draft:${selectedCanvasBlock.definitionId}-${index}`;
      while (workingDraftRef.current.canvasBlocks[id]) { index += 1; id = `draft:${selectedCanvasBlock.definitionId}-${index}`; }
      updateLayoutDraft(duplicateCanvasBlock(workingDraftRef.current, selectedCanvasBlock.id, id)); setSelectedId(id);
    }}>Duplicate</button><button type="button" className="text-button" onClick={() => { updateLayoutDraft(removeCanvasBlock(workingDraftRef.current, selectedCanvasBlock.id)); setSelectedId(null); }}>Delete block</button></div>
  </div>
    : draft?.kind === "group" ? <GroupDraftInspector draft={draft} onChange={(next) => setDraft(next)} onCommit={(operation) => {
    const resume = draft.resume;
    if (resume?.kind === "choose") setDraft({ ...resume, groupId: draft.semanticId });
    else if (resume?.kind === "investment") setDraft({
      ...resume,
      targetKind: draft.assets.length === 1 ? "asset" : "group",
      targetRef: draft.assets.length === 1 ? draft.assets[0]! : draft.semanticId,
    });
    else { setDraft(null); working(false); }
    applyProduct(operation);
  }} />
    : draft?.kind === "choose" ? <ChooseDraftInspector strategy={canonical} draft={draft} onChange={(next) => setDraft(next)} onCommit={finishDraftOperation} onNeedGroup={() => groupDraftFor(draft)} />
    : draft?.kind === "investment" ? <InvestmentDraftInspector strategy={canonical} draft={draft} onChange={(next) => setDraft(next)} onCommit={finishDraftOperation} onNeedGroup={() => groupDraftFor(draft)} />
    : draft?.kind === "selection" ? <SelectionDraftInspector strategy={canonical} initialUniverseId={draft.universeId} withQualification={draft.withQualification} onComplete={(operation, investmentId) => applyProduct(operation, { investmentId, selectionId: draft.semanticId })} />
    : draft?.kind === "event_state" ? <EventStateDraftInspector strategy={canonical} semanticId={draft.semanticId} onComplete={apply} />
    : draft?.kind === "control" ? <ControlDraftInspector strategy={canonical} draft={draft} connections={workingDraft.blockConnections} onChange={(next) => setDraft(next)} onCommit={apply} />
    : draft?.kind === "financial_intent" ? <FinancialIntentInspector draft={draft} onChange={(next) => setDraft(next)} onCommit={(operation) => { setDraft(null); working(false); apply(operation); }} />
    : selectedId?.startsWith("assets:") ? <div className="semantic-inspector-content"><h2>Group Workspace</h2><p>The large Group editor is open on the canvas. Search, review provider status, reorder members, and commit the explicit Group there.</p></div>
        : selectedId?.startsWith("qualification:") && selectedSelection ? <ProgramQualificationInspector strategy={canonical} statement={selectedSelection} apply={apply} working={working} onDefault={() => applyProduct({ kind: "setQualification", lookback: 126, operator: "gt", threshold: 0 }, { selectionId: selectedSelection.semantic_id })} />
          : selectedId?.startsWith("fallback:") && selectedSelection ? <ProgramFallbackInspector statement={selectedSelection} onFallback={(asset) => applyProduct({ kind: "setFallback", asset }, { selectionId: selectedSelection.semantic_id })} />
            : selectedId?.startsWith("investment:") && selected?.kind === "allocate" && selected.legs.length > 1 ? <ProgramSplitInspector strategy={canonical} statement={selected} onApply={(investments) => applyProduct({ kind: "setAllocation", method: "fixed", investments })} />
              : selectedId?.startsWith("investment:") && selected?.kind === "allocate" ? <div className="semantic-inspector-content"><h2>Investment</h2><p className="fixed-setting">Capital target · {selected.legs.map((leg) => leg.target.ref ?? leg.target.kind).join(" · ")}</p><p>Within the target, capital is {selected.method === "proportional_score" ? "proportional to positive Score" : "equally weighted"}.</p><button type="button" className="secondary-button" onClick={() => { const leg = selected.legs[0]; setDraft({ kind: "investment", semanticId: selected.semantic_id, targetKind: leg?.target.kind === "asset" || leg?.target.kind === "group" || leg?.target.kind === "selection" ? leg.target.kind : null, targetRef: leg?.target.ref ?? null, internalAllocation: selected.method === "proportional_score" ? "proportional_score" : "equal", amountKind: "cash_fraction", amountValue: "1" }); working(true); }}>Change target or weighting</button><button type="button" className="text-button" onClick={() => applyProduct({ kind: "removeInvestment", semanticId: selected.semantic_id })}>Disconnect capital</button></div>
              : selected ? <Inspector strategy={canonical} statement={selected} apply={apply} working={working} />
              : selectedId === "rebalance" && clock ? <ProgramScheduleInspector timeframe={clock.timeframe} onChange={(timeframe) => applyProduct({ kind: "setRebalance", cadence: timeframe })} />
                : selectedGroup ? <div className="semantic-inspector-content"><h2>Group</h2><p>A reusable candidate universe. It does not imply capital exposure.</p><label>Group name<input aria-label="Group name" defaultValue={selectedGroup.name} onBlur={(event) => { const name = event.target.value.trim(); if (name && name !== selectedGroup.name) applyProduct({ kind: "renameGroup", groupId: selectedGroup.id, name }); }} /></label><button type="button" className="secondary-button" onClick={() => select(`assets:${selectedGroup.asset_set_ref}`)}>Edit Assets</button><button type="button" className="text-button" onClick={() => applyProduct({ kind: "removeGroup", groupId: selectedGroup.id })}>Delete Group</button></div>
                  : selectedId === "split" && portfolioSplit ? <ProgramSplitInspector strategy={canonical} statement={portfolioSplit} onApply={(investments) => applyProduct({ kind: "setAllocation", method: "fixed", investments })} />
                    : <div className="semantic-inspector-content"><h2>Portfolio</h2><p>Select a Group, Subgroup, or Investment in Structure, or add one from Add.</p></div>;
  const representations: Record<ProgramBuilderView, ReactNode> = {
    overview: <section className="representation-layer v2-summary" data-projection-contract="summary"><span className="eyebrow">Strategy summary</span><h1>{summary.title}</h1><p>{summary.description}</p></section>,
    blocky: <section className="representation-layer blocky-layer" data-projection-contract="blocky"><ProgramBlockyProjection nodes={blocky} selectedId={selectedId} onSelect={select}
      positions={workingDraft.blockPositions} connections={workingDraft.blockConnections} disclosure={workingDraft.blockDisclosure} draft={draft} canvasBlocks={workingDraft.canvasBlocks}
      onBlockMove={(childId, position, parentId, inputName) => {
        const current = workingDraftRef.current;
        if (current.canvasBlocks[childId]) {
          const moved = withBlockMove(current, childId, position, { childId, parentId, inputName });
          updateLayoutDraft({ ...moved, status: "incomplete" }); working(true); return;
        }
        const child = blocky.find((item) => item.id === childId);
        const childType = child?.role === "condition" ? "condition" : child?.role === "value" ? "value" : child?.role === "fallback" ? "fallback" : "statement";
        const expectedParent = child?.connection?.parentId ?? null;
        const expectedInput = child?.connection ? child.connection.kind === "next" ? "NEXT" : child.connection.inputName : null;
        const result = translateDraftIntent(canonical, { kind: "connect_block", childId, childType, parentId, inputName, projected: { childId, parentId: expectedParent, inputName: expectedInput } });
        const layoutOnly = result.status === "layout_only";
        const nextStatus = result.status === "invalid" ? "invalid" : layoutOnly ? current.status : draft ? "incomplete" : "unsupported";
        const moved = withBlockMove(current, childId, position, layoutOnly ? undefined : { childId, parentId, inputName });
        updateLayoutDraft({ ...moved, status: nextStatus, diagnostics: result.diagnostic ? [...current.diagnostics, result.diagnostic] : current.diagnostics });
        if (!layoutOnly) working(true);
      }}
      onDisclosureChange={(id, level) => updateLayoutDraft(withBlockDisclosure(workingDraftRef.current, id, level))}
      onDraftDelete={(id) => { if (id && workingDraftRef.current.canvasBlocks[id]) updateLayoutDraft(removeCanvasBlock(workingDraftRef.current, id)); else setDraft(null); if (Object.keys(workingDraftRef.current.canvasBlocks).length <= 1) working(false); }}
      onToolDrop={(toolId, position) => {
        if (toolId.startsWith("entry:")) addEntryBlock(toolId.slice("entry:".length), position);
        else if (toolId === "logic-control") startControlDraft(position);
        else if (["logic-selection", "choose-assets"].includes(toolId)) startChooseDraft(false, position);
        else if (["logic-condition", "qualification"].includes(toolId)) startChooseDraft(true, position);
        else if (toolId === "state-event") startEventStateDraft(position);
        else if (toolId.startsWith("intent-")) tools.find((item) => item.id === toolId)?.onAdd();
        else tools.find((item) => item.id === toolId)?.onAdd();
      }} />{selectedId?.startsWith("assets:") && <section className="program-group-workspace" aria-label="Group Workspace"><header><div><span className="eyebrow">Group Workspace</span><h2>Edit Group assets</h2></div><button type="button" aria-label="Close Group Workspace" onClick={() => select(null)}>×</button></header><ProgramAssetUniverseEditor assets={canonical.definitions.asset_sets.find((item) => item.id === selectedId.slice("assets:".length))?.assets ?? []} onCommit={(assets) => applyProduct({ kind: "setAssets", assets }, { assetSetId: selectedId.slice("assets:".length) })} /></section>}</section>,
    flow: <ProgramFlowProjection flow={flow} edges={flowGraph.edges} blank={flowGraph.edges.length === 0} onSelect={select}
      positions={workingDraft.flowPositions} viewport={workingDraft.flowViewport}
      onPositionChange={(id, position) => updateLayoutDraft(withFlowPositions(workingDraftRef.current, { [id]: position }))}
      onViewportChange={(viewport) => updateWorkingDraft({ ...workingDraftRef.current, flowViewport: viewport })}
      onConnect={(connection) => {
        if (!connection.source || !connection.target) return;
        const result = translateDraftIntent(canonical, { kind: "connect_flow", sourceId: connection.source, targetId: connection.target, projectedEdges: flowGraph.edges });
        if (result.semanticEffect === "commit_operation" && result.operation) { apply(result.operation); return; }
        const current = workingDraftRef.current;
        updateWorkingDraft({ ...current, status: result.status === "invalid" ? "invalid" : "unsupported", diagnostics: result.diagnostic ? [...current.diagnostics, result.diagnostic] : current.diagnostics }); working(true);
      }}
      onDisconnect={(sourceId, targetId) => {
        const result = translateDraftIntent(canonical, { kind: "disconnect_flow", sourceId, targetId });
        const current = workingDraftRef.current;
        updateWorkingDraft({ ...current, status: "unsupported", diagnostics: result.diagnostic ? [...current.diagnostics, result.diagnostic] : current.diagnostics }); working(true);
      }} />,
    rules: <section className="representation-layer v2-rules" aria-label="Rules projection" data-projection-contract="rules"><h2>Rules</h2>{blank ? <p>No strategy logic has been added yet.</p> : rules.map((line) => <button type="button" className="program-rule-line" key={line.id} style={{ paddingLeft: `${12 + line.depth * 18}px` }} data-semantic-address={line.address.semanticId} aria-pressed={selectedId === line.address.focusId} onClick={() => select(line.address.focusId)}>{line.text}</button>)}</section>,
    guided: <section className="representation-layer guide-representation" aria-label="Guided strategy editor"><header className="representation-intro"><span className="eyebrow">Guide</span><h1>How this strategy works</h1><p>Start with assets, timing, capital flow, logic, or allocation. Complete intent converges on one semantic strategy.</p></header>{blank ? <section className="guide-recipes" aria-label="Guided Strategy recipes"><button className="secondary-button" type="button" onClick={() => startFinancialIntent("single_asset", "asset_first")}>Choose QQQ first</button><button className="secondary-button" type="button" onClick={() => startFinancialIntent("single_asset", "timing_first")}>Start every month</button><button className="secondary-button" type="button" onClick={addInvestment}>One investment</button><button className="secondary-button" type="button" onClick={() => startFinancialIntent("split_portfolio", "flow_first")}>Split a portfolio</button></section> : <div className="guide-sequence">{all.filter((item) => ["select", "control", "allocate"].includes(item.kind)).map((item) => <button className="guide-object" type="button" key={item.semantic_id} aria-pressed={selectedId === item.semantic_id} onClick={() => select(item.semantic_id)}><span>Strategy step</span><strong>{describeProgramStatement(item)}</strong></button>)}</div>}</section>,
    code: <section className="representation-layer code-representation" aria-label="Code representation"><header className="representation-intro"><span className="eyebrow">Code</span><h1>Canonical strategy</h1><p>Read-only developer representation. Editing remains in the shared Inspector.</p></header><pre className="code-metadata">{JSON.stringify(canonical, null, 2)}</pre></section>,
    ai: <section className="representation-layer ai-handoff-representation" aria-label="AI representation"><header className="representation-intro"><span className="eyebrow">AI handoff</span><h1>Bring your own AI</h1><p>Copy the committed semantic strategy for external analysis. Canonical changes still require validated authoring intents.</p></header><textarea aria-label="Context to copy for AI" readOnly rows={14} value={JSON.stringify({ format: "ruletrade.strategy-context/v1", strategy: canonical }, null, 2)} /></section>,
  };
  const authoringFeedback = status === "saved" ? null : message;
  const workspaceDraftMessage = draft ? "Finish or discard the current semantic draft."
    : workingDraft.status === "invalid" ? "That visual connection would create an invalid strategy. Reconnect it or discard the draft."
      : workingDraft.status === "unsupported" ? "That relationship is meaningful but is not supported by the current semantic operation profile."
        : status === "unfinished" ? message : null;
  const discardWorkspaceDraft = draft || ["invalid", "unsupported"].includes(workingDraft.status) ? () => {
    updateWorkingDraft({ ...workingDraft, concept: null, status: "clean", selectedDraftId: null, blockConnections: {}, diagnostics: [] }); working(false);
  } : undefined;
  const undoWorkspace = () => {
    const previous = layoutUndoRef.current.at(-1);
    if (!previous) { undo(); return; }
    const nextUndo = layoutUndoRef.current.slice(0, -1);
    const nextRedo = [...layoutRedoRef.current, workingDraftRef.current];
    layoutUndoRef.current = nextUndo;
    layoutRedoRef.current = nextRedo;
    setLayoutUndo(nextUndo);
    setLayoutRedo(nextRedo);
    updateWorkingDraft(previous);
  };
  const redoWorkspace = () => {
    const next = layoutRedoRef.current.at(-1);
    if (!next) { redo(); return; }
    const nextRedo = layoutRedoRef.current.slice(0, -1);
    const nextUndo = [...layoutUndoRef.current, workingDraftRef.current];
    layoutRedoRef.current = nextRedo;
    layoutUndoRef.current = nextUndo;
    setLayoutRedo(nextRedo);
    setLayoutUndo(nextUndo);
    updateWorkingDraft(next);
  };
  return <StrategyBuilderWorkspace program={{ activeView: view, onViewChange: switchView, leftPanel: <WorkspaceLeftPanel semanticProgram={{ tools, structure, selectedId, onSelect: (id) => select(id), perspective: view, objects: libraryObjects, onCreateGroup: startGroupDraft }} />, representations, inspector, inspectorOpen: Boolean(selectedId || draft), onCloseInspector: () => { if (!draft) select(null); }, draftMessage: workspaceDraftMessage, feedback: authoringFeedback, onUndo: undoWorkspace, onRedo: redoWorkspace, canUndo: layoutUndo.length > 0 || canUndo, canRedo: layoutRedo.length > 0 || canRedo, onDiscardDraft: discardWorkspaceDraft, detailPanel: testPanel ? { title: "Quick Test results", content: testPanel, onClose: onCloseTestPanel } : null }} name={canonical.metadata.name} dirty={dirty} saving={status === "updating"} persisted onHome={onHome} onSave={save} onTest={run} onOpenAssets={() => { const selected = all.find((item) => item.kind === "select") as SelectionStatementV2 | undefined; if (selected) { const assets = assetSetForSelection(canonical, selected); setView("blocky"); select(`assets:${assets?.id ?? selected.selection.universe_id}`); } }} testDisabled={!executionCapability?.production_executable || status !== "saved" || workingDraft.status !== "clean"} testTitle={workspaceDraftMessage ?? executionCapability?.product_message ?? "Checking whether this strategy is ready to test."} />;
}
