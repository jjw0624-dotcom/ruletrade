import { useState, type ReactNode } from "react";

import type { CanonicalStrategyV2, ProgramStatementV2, V2AuthoringOperation } from "../domain/canonicalV2";
import { describeConditionV2, describeValueV2 } from "../domain/v2Semantics";
import { BlockyView } from "../views/BlockyView";
import { SelectionComposer } from "./SelectionComposer";
import { StrategyBuilderWorkspace, type ProgramBuilderView } from "./StrategyBuilderWorkspace";
import { V2ConditionComposer, V2ConditionDraftComposer, V2ProgramValueComposer } from "./V2SemanticComposer";
import { WorkspaceLeftPanel, type ProductAddAction, type ProductStructureNode } from "./WorkspaceLeftPanel";

type SelectionStrategy = CanonicalStrategyV2 & { selection: NonNullable<CanonicalStrategyV2["selection"]> };

export function CompatibilitySelectionBuilderAdapter({ canonical, dirty, status, message, result, onHome, apply, save, run, undo, redo, canUndo, canRedo, working }: {
  canonical: SelectionStrategy;
  dirty: boolean;
  status: "saved" | "updating" | "invalid" | "unfinished";
  message: string;
  result: ReactNode;
  onHome: () => void;
  apply: (operation: V2AuthoringOperation) => void;
  save: () => void;
  run: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  working: (unfinished: boolean) => void;
}) {
  const [view, setView] = useState<ProgramBuilderView>("overview");
  const [selectedId, setSelectedId] = useState("selection");
  const selection = canonical.selection;
  const group = canonical.definitions.groups.find((item) => item.id === selection.universe_id);
  const assetSet = canonical.definitions.asset_sets.find((item) => item.id === (group?.asset_set_ref ?? selection.universe_id));
  const selectStatement: ProgramStatementV2 = { kind: "select", semantic_id: "selection", output_id: "selected-assets", clock_id: "daily-close", selection };
  const productNode = (id: string, concept: ProductStructureNode["concept"], label: string, detail?: string, children: ProductStructureNode[] = []): ProductStructureNode => ({
    id, concept, label, detail, children,
    address: { canonical: "v2", concept, semanticId: id },
  });
  const structure = productNode("portfolio", "portfolio", "Portfolio", undefined, [
    productNode("investment", "investment", group?.name ?? "Investment", undefined, [
      productNode("assets", "assets", "Assets", assetSet?.assets.join(", ") ?? "Static universe"),
      ...(selection.eligibility ? [productNode("qualification", "qualification", "Qualification", describeConditionV2(selection.eligibility))] : []),
      productNode("selection", "selection", `Choose ${selection.count} assets`, `${selection.direction === "descending" ? "highest" : "lowest"} ${describeValueV2(selection.ranking)}`),
      ...(selection.fallback_asset ? [productNode("fallback", "fallback", "Fallback", `Otherwise → ${selection.fallback_asset}`)] : []),
      productNode("rebalance", "rebalance", "Rebalance", "Daily close"),
    ]),
  ]);
  const tools: ProductAddAction[] = [
    { id: "if", category: "Routing", label: "IF / OTHERWISE", description: "Available for Program-native strategies.", disabled: true, onAdd: () => undefined },
    { id: "choose", category: "Routing", label: "Choose assets", description: "This investment already chooses assets.", disabled: true, onAdd: () => undefined },
    { id: "qualification", category: "Routing", label: "Qualification", description: "Edit Qualification in Structure.", disabled: false, onAdd: () => setSelectedId("qualification") },
    { id: "allocate", category: "Allocation", label: "Allocation", description: "Equal allocation is defined by this compatibility strategy.", disabled: true, onAdd: () => undefined },
    { id: "schedule", category: "Timing", label: "Schedule", description: "Daily close schedule is configured.", disabled: true, onAdd: () => undefined },
    { id: "fallback", category: "Behavior", label: "Fallback", description: "Edit Fallback in Structure.", disabled: false, onAdd: () => setSelectedId("fallback") },
  ];
  const selectionInspector = <div className="semantic-inspector-content"><SelectionComposer
    direction={selection.direction} count={selection.count} shortagePolicy={selection.shortage_policy}
    universeEditor={<select aria-label="Selection universe" value={selection.universe_id} onChange={(event) => apply({ kind: "set_selection_universe", universe_id: event.target.value })}>{canonical.definitions.groups.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}{canonical.definitions.asset_sets.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select>}
    universeMembersEditor={<p>{assetSet?.assets.join(" · ") ?? "No assets"}</p>}
    eligibilitySummary={selection.eligibility ? describeConditionV2(selection.eligibility) : "All candidates qualify"}
    eligibilityEditor={selection.eligibility ? <V2ConditionComposer condition={selection.eligibility} strategy={canonical} role="eligibility" onWorking={working} onChange={(condition) => apply({ kind: "set_eligibility_condition", condition })} /> : undefined}
    orderSummary={describeValueV2(selection.ranking)}
    orderEditor={<V2ProgramValueComposer value={selection.ranking} strategy={canonical} role="ranking" onWorking={working} onChange={(value) => apply({ kind: "set_ranking_value", value })} />}
    fallbackSummary={selection.fallback_asset ?? "None"}
    fallbackEditor={<input aria-label="Fallback asset" defaultValue={selection.fallback_asset ?? ""} placeholder="None" onBlur={(event) => apply({ kind: "set_selection_fallback", fallback_asset: event.target.value.trim().toUpperCase() || null })} />}
    onChange={(next) => {
      if (next.direction !== selection.direction) apply({ kind: "set_ranking_direction", direction: next.direction });
      else if (next.count !== selection.count) apply({ kind: "set_selection_count", count: next.count });
      else if (next.shortagePolicy !== selection.shortage_policy) apply({ kind: "set_shortage_policy", shortage_policy: next.shortagePolicy });
    }}
  /></div>;
  const inspector = selectedId === "qualification"
    ? <div className="semantic-inspector-content"><h2>Qualification</h2>{selection.eligibility
      ? <V2ConditionComposer condition={selection.eligibility} strategy={canonical} role="eligibility" onWorking={working} onChange={(condition) => apply({ kind: "set_eligibility_condition", condition })} />
      : <V2ConditionDraftComposer semanticId="selection-eligibility" strategy={canonical} role="eligibility" onWorking={working} onComplete={(condition) => apply({ kind: "set_eligibility_condition", condition })} />}</div>
    : selectedId === "fallback" ? <div className="semantic-inspector-content"><h2>Fallback</h2><input aria-label="Fallback asset" defaultValue={selection.fallback_asset ?? ""} placeholder="None" onBlur={(event) => apply({ kind: "set_selection_fallback", fallback_asset: event.target.value.trim().toUpperCase() || null })} /></div>
      : selectedId === "assets" ? <div className="semantic-inspector-content"><h2>Assets</h2>{assetSet ? <label>Symbols<input aria-label="Investment assets" defaultValue={assetSet.assets.join(", ")} onBlur={(event) => { const assets = event.target.value.split(/[\s,]+/).map((item) => item.trim().toUpperCase()).filter(Boolean); if (assets.length) apply({ kind: "set_program_asset_set", asset_set_id: assetSet.id, assets }); }} /></label> : <p>No assets</p>}</div>
        : selectedId === "rebalance" ? <div className="semantic-inspector-content"><h2>Rebalance</h2><p>Daily at market close</p></div>
          : selectionInspector;
  const representations: Record<ProgramBuilderView, ReactNode> = {
    overview: <section className="representation-layer v2-summary"><span className="eyebrow">Strategy summary</span><h1>{canonical.metadata.name}</h1><p>Choose {selection.count} from {assetSet?.assets.length ?? 0} configured assets.</p></section>,
    guided: <section className="representation-layer guide-representation"><header className="representation-intro"><span className="eyebrow">Guide</span><h1>How this strategy works</h1></header><button className="guide-object" type="button" onClick={() => setSelectedId("selection")}>Choose assets</button></section>,
    flow: <section className="representation-layer v2-flow"><div className="flow-capital-node">Portfolio capital</div><button className="flow-routing-node" type="button" onClick={() => setSelectedId("selection")}>Choose {selection.count} assets</button><div className="flow-action-node">Target / Rebalance</div></section>,
    blocky: <section className="representation-layer blocky-layer"><BlockyView semanticProgram={{ statements: [selectStatement], selectedId: selectedId === "selection" ? "selection" : null, onSelect: (id) => id && setSelectedId(id) }} /></section>,
    rules: <section className="representation-layer v2-rules"><h2>Rules</h2><p>Consider {assetSet?.assets.join(", ") ?? selection.universe_id}.</p><p>{selection.eligibility ? `Keep candidates where ${describeConditionV2(selection.eligibility)}.` : "All candidates qualify."}</p><p>Rank by {describeValueV2(selection.ranking)} and choose {selection.count}.</p></section>,
    code: <section className="representation-layer code-representation"><h1>Canonical strategy</h1><pre className="code-metadata">{JSON.stringify(canonical, null, 2)}</pre></section>,
    ai: <section className="representation-layer ai-handoff-representation"><h1>Bring your own AI</h1><textarea aria-label="Context to copy for AI" readOnly rows={14} value={JSON.stringify({ format: "ruletrade.strategy-context/v1", strategy: canonical }, null, 2)} /></section>,
  };
  return <StrategyBuilderWorkspace program={{
    activeView: view, onViewChange: setView,
    leftPanel: <WorkspaceLeftPanel semanticProgram={{ tools, structure, selectedId, onSelect: setSelectedId }} />,
    representations, inspector, feedback: <>{message}{result}</>, draftMessage: status === "unfinished" ? message : null,
    onUndo: undo, onRedo: redo, canUndo, canRedo,
  }} name={canonical.metadata.name} dirty={dirty} saving={status === "updating"} persisted onHome={onHome} onSave={save} onTest={run} testDisabled={status !== "saved"} testTitle={message} />;
}
