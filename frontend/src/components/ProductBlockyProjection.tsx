import { useEffect, useMemo, useRef } from "react";
import * as Blockly from "blockly";

import type { ProductNode } from "../domain/productSemantics";
import type { ProgramBlockNode } from "../domain/programProjections";
import type { ProgramDraftConcept } from "../domain/programWorkingDraft";
import type { ProgramCanvasBlock, ProgramDraftConnection, ProgramReusableObject } from "../domain/programWorkingDraft";
import { entryBlockDefinition } from "../domain/entryStyleGrammar";
import { entryBlocklyExtraState, entryBlocklyFields, entryBlocklyToolbox, entryBlocklyType, entryDefinitionIdForBlock, registerBlockyProgramBlocks, type EntryToolboxObject } from "./blockyProgramBlocks";

function blockType(node: ProductNode) {
  if (node.concept === "selection") return "rt_selection";
  if (["investment", "sleeve", "split", "allocation"].includes(node.concept)) return "rt_allocation";
  if (node.concept === "control") return "rt_control";
  return "rt_action";
}

export function productBlockLabel(node: ProductNode) {
  return node.detail ? `${node.label} · ${node.detail}` : node.label;
}

function setAddress(block: Blockly.Block, id: string) {
  let existing: Record<string, unknown> = {};
  try { existing = block.data ? JSON.parse(block.data) as Record<string, unknown> : {}; } catch { /* Replace malformed third-party data. */ }
  block.data = JSON.stringify({ ...existing, productId: id });
}

function readMetadata(block: Blockly.Block | null): { productId?: string; definitionId?: string; objectRef?: string | null } {
  if (!block?.data) return {};
  try { return JSON.parse(block.data) as { productId?: string; definitionId?: string; objectRef?: string | null }; }
  catch { return {}; }
}

function readAddress(block: Blockly.Block | null): string | null {
  if (!block?.data) return null;
  try { return (JSON.parse(block.data) as { productId?: string }).productId ?? null; }
  catch { return null; }
}

function visibleNodes(root: ProductNode): ProductNode[] {
  const nodes: ProductNode[] = [];
  const visit = (node: ProductNode) => {
    if (node.concept !== "portfolio" && node.concept !== "rebalance") nodes.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  return nodes;
}

/** Version-neutral Blocky projection of the Builder's product language. */
export function ProductBlockyProjection({ root, selectedId, onSelect }: {
  root: ProductNode;
  selectedId: string | null;
  onSelect: (productId: string | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const workspace = useRef<Blockly.WorkspaceSvg | null>(null);
  const nodes = visibleNodes(root);
  const rebalance = root.children.find((node) => node.concept === "rebalance");

  useEffect(() => {
    if (!host.current) return;
    registerBlockyProgramBlocks();
    const canvas = Blockly.inject(host.current, {
      trashcan: false, sounds: false,
      move: { scrollbars: true, drag: true, wheel: true },
      zoom: { controls: true, wheel: true, startScale: 1, minScale: .45, maxScale: 1.8, scaleSpeed: 1.12 },
    });
    workspace.current = canvas;
    const listener = (event: Blockly.Events.Abstract) => {
      if (event.type === Blockly.Events.BLOCK_DRAG && host.current) {
        const drag = event as Blockly.Events.Abstract & { isStart?: boolean };
        host.current.dataset.nativeDragActive = String(Boolean(drag.isStart));
        if (!drag.isStart) host.current.dataset.addExpanded = "false";
      }
      if (event.type !== Blockly.Events.CLICK) return;
      const click = event as Blockly.Events.Abstract & { targetType?: string; blockId?: string };
      if (click.targetType === Blockly.Events.ClickTarget.WORKSPACE) onSelect(null);
      if (click.targetType === Blockly.Events.ClickTarget.BLOCK && click.blockId) {
        const id = readAddress(canvas.getBlockById(click.blockId));
        if (id) onSelect(id);
      }
    };
    canvas.addChangeListener(listener);
    return () => { canvas.removeChangeListener(listener); canvas.dispose(); workspace.current = null; };
  }, [onSelect]);

  useEffect(() => {
    const canvas = workspace.current;
    if (!canvas) return;
    Blockly.Events.disable();
    try {
      canvas.clear();
      let previous: Blockly.BlockSvg | null = null;
      if (rebalance) {
        const trigger = canvas.newBlock("rt_trigger") as Blockly.BlockSvg;
        trigger.setFieldValue(productBlockLabel(rebalance), "LABEL"); setAddress(trigger, rebalance.id);
        trigger.setDeletable(false); trigger.setMovable(true); trigger.contextMenu = false;
        trigger.initSvg(); trigger.render(); trigger.moveBy(80, 120); previous = trigger;
      }
      nodes.forEach((node, index) => {
        const block = canvas.newBlock(blockType(node)) as Blockly.BlockSvg;
        block.setFieldValue(productBlockLabel(node), "LABEL"); setAddress(block, node.id);
        block.setDeletable(false); block.setMovable(true); block.contextMenu = false;
        block.initSvg(); block.render();
        if (previous?.nextConnection && block.previousConnection) previous.nextConnection.connect(block.previousConnection);
        else block.moveBy(80, 120 + index * 100);
        previous = block;
      });
      canvas.clearUndo(); Blockly.svgResize(canvas);
    } finally { Blockly.Events.enable(); }
  }, [root, rebalance, nodes]);

  useEffect(() => {
    if (!selectedId) return;
    workspace.current?.getAllBlocks(false).find((block) => readAddress(block) === selectedId)?.select();
  }, [selectedId, root]);

  return <div className="blocky-representation"><div className="blocky-canvas" ref={host} aria-label="Strategy product blocks" /></div>;
}

function semanticBlockType(node: ProgramBlockNode) {
  if (node.role === "context") return "rt_context";
  if (node.role === "trigger") return "rt_trigger";
  if (node.role === "group") return "rt_group";
  if (node.role === "selection") return "rt_selection";
  if (node.role === "investment") return "rt_investment";
  if (node.role === "split") return "rt_split";
  if (node.role === "allocation") return "rt_allocation";
  if (node.role === "condition") return "rt_condition";
  if (node.role === "value") return "rt_value";
  if (node.role === "fallback") return "rt_fallback";
  if (node.role === "control") return "rt_control";
  if (node.role === "event") return "rt_event";
  if (node.role === "state") return "rt_state";
  if (node.role === "memory") return "rt_memory";
  if (node.role === "policy") return "rt_policy";
  return "rt_action";
}

export const programBlockyVisibleNodes = (nodes: ProgramBlockNode[]) => nodes.filter((node) => node.role !== "context");

/** Program-native logic projection. It never consumes the Structure tree. */
export interface NativeBlockySnapshot {
  workspace: Record<string, unknown>;
  viewport: { x: number; y: number; scale: number } | null;
  canvasBlocks: Record<string, ProgramCanvasBlock>;
  positions: Record<string, { x: number; y: number }>;
  connections: Record<string, ProgramDraftConnection>;
  disclosure: Record<string, 0 | 1 | 2>;
  selectedDraftId: string | null;
  nativeObjects: ProgramReusableObject[];
}

export interface NativeBlockyHistory {
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  fieldValue: (productId: string, fieldName: string) => string | number | null;
  setFieldValue: (productId: string, fieldName: string, value: string | number) => boolean;
  dispose: (productId: string) => boolean;
  insertObjectReference: (object: EntryToolboxObject, target?: { parentId: string; inputName: string }) => string | null;
}

export function nativeBlockFieldController(canvas: Blockly.Workspace) {
  const blockAt = (productId: string) => canvas.getAllBlocks(false).find((block) => readAddress(block) === productId) ?? null;
  return {
    fieldValue: (productId: string, fieldName: string): string | number | null => blockAt(productId)?.getFieldValue(fieldName) ?? null,
    setFieldValue: (productId: string, fieldName: string, value: string | number): boolean => {
      const block = blockAt(productId);
      if (!block?.getField(fieldName)) return false;
      block.setFieldValue(String(value), fieldName);
      return true;
    },
  };
}

export function ProgramBlockyProjection({ nodes, selectedId, onSelect, positions = {}, connections = {}, disclosure = {}, draft = null, canvasBlocks = {}, objects = [], workspaceState = null, viewport = null, addSurfaceOpen = false, suspended = false, onWorkspaceChange, onWorkspaceApi, onCreateGroup, onBlockMove, onDisclosureChange }: {
  nodes: ProgramBlockNode[];
  selectedId: string | null;
  onSelect: (focusId: string | null) => void;
  positions?: Record<string, { x: number; y: number }>;
  connections?: Record<string, { childId: string; parentId: string | null; inputName: string | null }>;
  disclosure?: Record<string, 0 | 1 | 2>;
  draft?: ProgramDraftConcept;
  canvasBlocks?: Record<string, ProgramCanvasBlock>;
  objects?: EntryToolboxObject[];
  workspaceState?: Record<string, unknown> | null;
  viewport?: { x: number; y: number; scale: number } | null;
  addSurfaceOpen?: boolean;
  suspended?: boolean;
  onWorkspaceChange?: (snapshot: NativeBlockySnapshot) => void;
  onWorkspaceApi?: (api: NativeBlockyHistory | null) => void;
  onCreateGroup?: (request?: { parentId: string; inputName: string }) => void;
  onBlockMove?: (blockId: string, position: { x: number; y: number }, parentId: string | null, inputName: string | null) => void;
  onDisclosureChange?: (blockId: string, level: 0 | 1 | 2) => void;
}) {
  const visualNodes = useMemo(() => programBlockyVisibleNodes(nodes), [nodes]);
  const host = useRef<HTMLDivElement>(null);
  const workspace = useRef<Blockly.WorkspaceSvg | null>(null);
  const nodesRef = useRef(nodes);
  const onSelectRef = useRef(onSelect);
  const callbacksRef = useRef({ onBlockMove, onDisclosureChange });
  const positionsRef = useRef(positions);
  const canvasBlocksRef = useRef(canvasBlocks);
  const onWorkspaceChangeRef = useRef(onWorkspaceChange);
  const onCreateGroupRef = useRef(onCreateGroup);
  nodesRef.current = visualNodes;
  onSelectRef.current = onSelect;
  callbacksRef.current = { onBlockMove, onDisclosureChange };
  positionsRef.current = positions;
  canvasBlocksRef.current = canvasBlocks;
  onWorkspaceChangeRef.current = onWorkspaceChange;
  onCreateGroupRef.current = onCreateGroup;

  useEffect(() => {
    if (!host.current) return;
    registerBlockyProgramBlocks();
    const compactTheme = Blockly.Theme.defineTheme("ruletrade-compact", { name: "ruletrade-compact", base: Blockly.Themes.Zelos, fontStyle: { family: "Inter, system-ui, sans-serif", weight: "600", size: 10 } });
    const canvas = Blockly.inject(host.current, {
      toolbox: entryBlocklyToolbox(objects), renderer: "zelos", theme: compactTheme, trashcan: true, sounds: false,
      grid: { spacing: 24, length: 3, colour: "#d8dfd9", snap: false },
      move: { scrollbars: true, drag: true, wheel: true },
      zoom: { controls: true, wheel: true, startScale: .78, minScale: .4, maxScale: 1.8, scaleSpeed: 1.12 },
    });
    workspace.current = canvas;
    const toolboxElement = (canvas.getToolbox() as unknown as { getDiv?: () => HTMLElement | null } | null)?.getDiv?.()
      ?? host.current.querySelector<HTMLElement>(".blocklyToolbox");
    toolboxElement?.setAttribute("data-ruletrade-native-toolbox", "true");
    canvas.registerButtonCallback("RULETRADE_CREATE_GROUP", () => {
      const selected = Blockly.getSelected();
      const block = selected instanceof Blockly.Block ? selected : null;
      const parentId = readAddress(block);
      const target = block?.inputList.find((input) => !input.connection?.isConnected() && input.connection?.getCheck()?.some((check) => ["RuleTradeAsset", "RuleTradeAssetSet", "RuleTradeGroup", "RuleTradeSubgroup"].includes(check)));
      onCreateGroupRef.current?.(parentId && target?.name ? { parentId, inputName: target.name } : undefined);
    });
    canvas.registerButtonCallback("CREATE_VARIABLE", (button) => Blockly.Variables.createVariableButtonHandler(button.getTargetWorkspace()));
    if (workspaceState) {
      Blockly.Events.disable();
      try { Blockly.serialization.workspaces.load(workspaceState, canvas); }
      finally { Blockly.Events.enable(); }
    }
    if (viewport) canvas.scroll(viewport.x, viewport.y);
    const fieldController = nativeBlockFieldController(canvas);
    onWorkspaceApi?.({
      undo: () => canvas.undo(false), redo: () => canvas.undo(true), canUndo: () => canvas.getUndoStack().length > 0, canRedo: () => canvas.getRedoStack().length > 0,
      fieldValue: fieldController.fieldValue,
      setFieldValue: fieldController.setFieldValue,
      dispose: (productId) => {
        const block = canvas.getAllBlocks(false).find((candidate) => readAddress(candidate) === productId);
        if (!block || !productId.startsWith("draft:")) return false;
        block.dispose(true);
        return true;
      },
      insertObjectReference: (object, target) => {
        const definitionId = object.kind === "group" ? "group-reference" : object.kind === "subgroup" ? "subgroup-reference" : null;
        if (!definitionId) return null;
        const block = canvas.newBlock(entryBlocklyType(definitionId)) as Blockly.BlockSvg;
        const id = `draft:${block.id}`;
        block.data = JSON.stringify({ productId: id, definitionId, objectRef: object.id });
        if (block.getField("REFERENCE")) block.setFieldValue(object.name, "REFERENCE");
        block.initSvg(); block.render();
        const parent = target ? canvas.getAllBlocks(false).find((candidate) => readAddress(candidate) === target.parentId) : null;
        const input = parent?.getInput(target?.inputName ?? "")?.connection;
        if (input && block.outputConnection) {
          try { input.connect(block.outputConnection); }
          catch { block.moveBy(300, 180); }
        } else block.moveBy(300, 180);
        block.select();
        return id;
      },
    });

    const emitSnapshot = () => {
      const nextBlocks: Record<string, ProgramCanvasBlock> = {};
      const nextPositions: Record<string, { x: number; y: number }> = {};
      const nextConnections: Record<string, ProgramDraftConnection> = {};
      const nextDisclosure: Record<string, 0 | 1 | 2> = {};
      for (const block of canvas.getAllBlocks(false)) {
        const metadata = readMetadata(block);
        const definitionId = metadata.definitionId ?? entryDefinitionIdForBlock(block);
        if (!definitionId || (metadata.productId && !metadata.productId.startsWith("draft:"))) continue;
        const id = metadata.productId?.startsWith("draft:") ? metadata.productId : `draft:${block.id}`;
        if (metadata.productId !== id) {
          block.data = JSON.stringify({ ...metadata, productId: id, definitionId });
        }
        const definition = entryBlockDefinition(definitionId);
        const old = canvasBlocksRef.current[id];
        const fieldValues = Object.fromEntries(["VALUE", "NUM", "OP", "REFERENCE", "SHORTAGE", "MODE", "FLOW", "SEED", "REDRAW", "CURRENCY", "INDICATOR", "PERIOD"].flatMap((name) => block.getField(name) ? [[name, block.getFieldValue(name) as string | number | boolean | null] as const] : []));
        nextBlocks[id] = { id, definitionId, label: definition?.label ?? definitionId, createdAt: old?.createdAt ?? new Date().toISOString(), active: old?.active ?? false, objectRef: metadata.objectRef ?? old?.objectRef ?? null, fieldValues };
        const xy = block.getRelativeToSurfaceXY(); nextPositions[id] = { x: xy.x, y: xy.y };
        nextDisclosure[id] = block.isCollapsed() ? 0 : 1;
        const parent = block.getParent();
        const parentId = readAddress(parent);
        const inputName = parent?.inputList.find((input) => input.connection?.targetBlock() === block)?.name ?? (parent && parent.nextConnection?.targetBlock() === block ? "NEXT" : null);
        nextConnections[id] = { childId: id, parentId, inputName };
      }
      const metrics = canvas.getMetrics();
      const nativeObjects: ProgramReusableObject[] = canvas.getVariableMap().getAllVariables().map((variable) => ({ id: `blockly:variable:${variable.getId()}`, kind: "variable", name: variable.getName(), version: 1, dependencies: [], capability: "draft_only" }));
      for (const block of canvas.getAllBlocks(false)) if (["procedures_defreturn", "procedures_defnoreturn"].includes(block.type)) nativeObjects.push({ id: `blockly:function:${block.id}`, kind: "function", name: String(block.getFieldValue("NAME") ?? "function"), version: 1, dependencies: [], capability: "draft_only" });
      const selected = Blockly.getSelected();
      onWorkspaceChangeRef.current?.({
        workspace: Blockly.serialization.workspaces.save(canvas) as Record<string, unknown>,
        viewport: metrics ? { x: metrics.viewLeft, y: metrics.viewTop, scale: canvas.scale } : null,
        canvasBlocks: nextBlocks, positions: nextPositions, connections: nextConnections, disclosure: nextDisclosure,
        selectedDraftId: readAddress(selected instanceof Blockly.Block ? selected : null),
        nativeObjects,
      });
    };
    const listener = (event: Blockly.Events.Abstract) => {
      if (event.type !== Blockly.Events.CLICK) return;
      const click = event as Blockly.Events.Abstract & { targetType?: string; blockId?: string };
      if (click.targetType === Blockly.Events.ClickTarget.WORKSPACE) onSelectRef.current(null);
      if (click.targetType === Blockly.Events.ClickTarget.BLOCK && click.blockId) {
        const id = readAddress(canvas.getBlockById(click.blockId));
        const selected = nodesRef.current.find((item) => item.id === id);
        if (selected) onSelectRef.current(selected.address.focusId);
        else if (id?.startsWith("draft:")) onSelectRef.current(id);
      }
    };
    const editListener = (event: Blockly.Events.Abstract) => {
      const blockId = (event as Blockly.Events.Abstract & { blockId?: string }).blockId;
      if (!blockId) {
        if (event.type === Blockly.Events.VIEWPORT_CHANGE || !event.isUiEvent) queueMicrotask(emitSnapshot);
        return;
      }
      if (event.type === Blockly.Events.BLOCK_CREATE) {
        const block = canvas.getBlockById(blockId);
        const definitionId = block && entryDefinitionIdForBlock(block);
        if (block && definitionId) {
          const id = `draft:${block.id}`;
          setAddress(block, id);
          onSelectRef.current(id);
        }
      }
      if (event.type === Blockly.Events.BLOCK_MOVE) {
        const block = canvas.getBlockById(blockId);
        if (!block) return;
        const address = readAddress(block);
        if (!address) return;
        const xy = block.getRelativeToSurfaceXY();
        const parent = block.getParent();
        const parentId = readAddress(parent);
        const inputName = parent?.inputList.find((input) => input.connection?.targetBlock() === block)?.name
          ?? (parent && parent.nextConnection?.targetBlock() === block ? "NEXT" : null);
        if (!address.startsWith("draft:")) callbacksRef.current.onBlockMove?.(address, { x: xy.x, y: xy.y }, parentId, inputName);
      }
      if (event.type === Blockly.Events.BLOCK_CHANGE) {
        const change = event as Blockly.Events.Abstract & { element?: string; newValue?: unknown };
        if (change.element === "collapsed") {
          const block = canvas.getBlockById(blockId);
          const address = readAddress(block);
          if (address) callbacksRef.current.onDisclosureChange?.(address, change.newValue ? 0 : 1);
        }
      }
      if (!event.isUiEvent) queueMicrotask(emitSnapshot);
    };
    canvas.addChangeListener(listener); canvas.addChangeListener(editListener);
    const flyout = host.current.querySelector<SVGGElement>(".blocklyFlyout");
    const expandAdd = () => { if (host.current) host.current.dataset.addExpanded = "true"; };
    const collapseAdd = () => { if (host.current?.dataset.nativeDragActive !== "true") host.current!.dataset.addExpanded = "false"; };
    flyout?.addEventListener("pointerenter", expandAdd);
    flyout?.addEventListener("pointerleave", collapseAdd);
    flyout?.addEventListener("focusin", expandAdd);
    flyout?.addEventListener("focusout", collapseAdd);
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => Blockly.svgResize(canvas));
    resizeObserver?.observe(host.current);
    return () => { resizeObserver?.disconnect(); flyout?.removeEventListener("pointerenter", expandAdd); flyout?.removeEventListener("pointerleave", collapseAdd); flyout?.removeEventListener("focusin", expandAdd); flyout?.removeEventListener("focusout", collapseAdd); onWorkspaceApi?.(null); canvas.removeChangeListener(listener); canvas.removeChangeListener(editListener); canvas.dispose(); workspace.current = null; };
  }, []);

  useEffect(() => { workspace.current?.updateToolbox(entryBlocklyToolbox(objects)); }, [objects]);

  useEffect(() => {
    const canvas = workspace.current;
    const toolbox = canvas?.getToolbox();
    if (!canvas || !toolbox) return;
    const visible = addSurfaceOpen && !suspended;
    if (!visible) toolbox.getFlyout()?.hide();
    const frame = requestAnimationFrame(() => Blockly.svgResize(canvas));
    return () => cancelAnimationFrame(frame);
  }, [addSurfaceOpen, suspended]);

  useEffect(() => {
    const canvas = workspace.current;
    if (!canvas) return;
    Blockly.Events.disable();
    try {
      const wanted = new Map(visualNodes.map((node) => [node.id, node]));
      const existing = new Map(canvas.getAllBlocks(false).flatMap((block) => {
        const id = readAddress(block);
        return id ? [[id, block as Blockly.BlockSvg] as const] : [];
      }));
      for (const [id, block] of existing) {
        const metadata = readMetadata(block);
        if (id === "context:portfolio" || metadata.definitionId === "portfolio" || (block.type === "rt_context" && String(block.getFieldValue("LABEL")).toLowerCase() === "portfolio")) {
          block.dispose(false); existing.delete(id); continue;
        }
        if (id.startsWith("draft:")) continue;
        const node = wanted.get(id);
        if (!node || block.type !== semanticBlockType(node)) {
          block.dispose(false);
          existing.delete(id);
        }
      }
      visualNodes.forEach((node, index) => {
        let block = existing.get(node.id);
        const isNew = !block;
        if (!block) {
          block = canvas.newBlock(semanticBlockType(node)) as Blockly.BlockSvg;
          setAddress(block, node.id);
          block.setDeletable(false); block.setMovable(node.role !== "context"); block.contextMenu = node.role !== "context";
          block.initSvg(); block.render();
          existing.set(node.id, block);
        }
        const label = node.detail ? `${node.label} · ${node.detail}` : node.label;
        if (block.getFieldValue("LABEL") !== label) block.setFieldValue(label, "LABEL");
        block.setCollapsed((disclosure[node.id] ?? 1) === 0);
        if (isNew) {
          const saved = positionsRef.current[node.id];
          block.moveBy(saved?.x ?? 40 + node.depth * 54, saved?.y ?? 36 + index * 92);
        }
      });
      // Object definitions are edited in the Object Library / Group Workspace.
      // Only explicit references belong on the Blockly canvas.
      const draftId = draft && draft.kind !== "group" ? `draft:${draft.semanticId}` : null;
      const existingDraft = draftId ? existing.get(draftId) : null;
      if (draft && draftId && !existingDraft) {
        const type = draft.kind === "control" ? "rt_control"
          : draft.kind === "selection" || draft.kind === "choose" ? "rt_selection"
            : draft.kind === "investment" ? "rt_investment"
              : draft.kind === "group" ? entryBlocklyType("create-group")
            : draft.kind === "event_state" || (draft.kind === "financial_intent" && ["temporal_sequence", "multi_clock_policy"].includes(draft.recipe)) ? "rt_event"
              : draft.kind === "financial_intent" && draft.recipe === "market_regime_rotation" ? "rt_control"
                : draft.kind === "financial_intent" && draft.recipe === "weighted_score" ? "rt_selection"
                  : "rt_allocation";
        const block = canvas.newBlock(type) as Blockly.BlockSvg;
        setAddress(block, draftId);
        if (block.getField("LABEL")) block.setFieldValue(draft.kind === "selection" || draft.kind === "choose" ? "Choose from Group · unfinished"
          : draft.kind === "investment" ? "Invest [target] by [amount] · unfinished"
            : draft.kind === "group" ? "Create Group · unfinished"
          : draft.kind === "event_state" ? "Event → State · unfinished"
            : draft.kind === "financial_intent" ? `${draft.recipe.replaceAll("_", " ")} · draft`
              : "IF · set condition", "LABEL");
        block.setDeletable(true); block.setMovable(true); block.contextMenu = false;
        block.initSvg(); block.render();
        const saved = positionsRef.current[draftId]; block.moveBy(saved?.x ?? 360, saved?.y ?? 80);
        existing.set(draftId, block);
      }
      const draftConditionId = draft?.kind === "control" && draft.condition ? `${draftId}:condition` : null;
      if (draftConditionId && !existing.has(draftConditionId)) {
        const condition = canvas.newBlock("rt_condition") as Blockly.BlockSvg;
        setAddress(condition, draftConditionId); condition.setFieldValue("Condition · configured", "LABEL");
        condition.setDeletable(true); condition.setMovable(true); condition.contextMenu = false;
        condition.initSvg(); condition.render();
        const saved = positionsRef.current[draftConditionId]; condition.moveBy(saved?.x ?? 120, saved?.y ?? 110);
        existing.set(draftConditionId, condition);
      }
      if (draftId && draftConditionId) {
        const control = existing.get(draftId); const condition = existing.get(draftConditionId);
        const input = control?.getInput("CONDITION")?.connection;
        if (input && condition?.outputConnection && input.targetConnection !== condition.outputConnection) {
          if (input.isConnected()) input.disconnect();
          if (condition.outputConnection.isConnected()) condition.outputConnection.disconnect();
          input.connect(condition.outputConnection);
        }
      }
      const activeDraftIds = new Set([draftId, draftConditionId].filter((id): id is string => Boolean(id)));
      for (const canvasBlock of Object.values(canvasBlocks)) {
        activeDraftIds.add(canvasBlock.id);
        let block = existing.get(canvasBlock.id);
        const definition = entryBlockDefinition(canvasBlock.definitionId);
        if (!definition) continue;
        const wantedType = entryBlocklyType(definition.id);
        if (block && block.type !== wantedType) { block.dispose(false); existing.delete(canvasBlock.id); block = undefined; }
        if (!block) {
          block = canvas.newBlock(wantedType) as Blockly.BlockSvg;
          setAddress(block, canvasBlock.id);
          const extraState = entryBlocklyExtraState(definition.id);
          if (extraState) block.loadExtraState?.(extraState);
          const fields = entryBlocklyFields(definition.id);
          if (fields) for (const [name, value] of Object.entries(fields)) if (block.getField(name)) block.setFieldValue(String(value), name);
          block.setDeletable(true); block.setMovable(true); block.contextMenu = true;
          block.initSvg(); block.render();
          const saved = positionsRef.current[canvasBlock.id]; block.moveBy(saved?.x ?? 360, saved?.y ?? 80);
          existing.set(canvasBlock.id, block);
        }
        if (canvasBlock.objectRef && block.getField("REFERENCE")) {
          const object = objects.find((item) => item.id === canvasBlock.objectRef);
          if (object) block.setFieldValue(object.name, "REFERENCE");
        }
        block.setWarningText(definition.execution === "verified" ? null : definition.execution === "draft_only" ? "Working Draft only — not executable." : "Complete the required context before execution.");
        block.setCollapsed((disclosure[canvasBlock.id] ?? 1) === 0);
      }
      for (const [id, block] of existing) if (id.startsWith("draft:") && !activeDraftIds.has(id)) { block.dispose(false); existing.delete(id); }
      // Native Blockly owns draft connections. React only reconciles immutable
      // committed projections; replaying mirrored draft edges here races gestures.
      for (const childId of new Set(visualNodes.map((node) => node.id))) {
        const node = visualNodes.find((item) => item.id === childId);
        const tentative = connections[childId];
        const connection = tentative
          ? tentative.parentId ? { kind: tentative.inputName === "NEXT" ? "next" as const : "input" as const, parentId: tentative.parentId, inputName: tentative.inputName ?? "NEXT" } : null
          : node?.connection;
        const child = existing.get(childId);
        if (!child) continue;
        if (!connection) {
          if (tentative) { if (child.previousConnection?.isConnected()) child.previousConnection.disconnect(); if (child.outputConnection?.isConnected()) child.outputConnection.disconnect(); }
          continue;
        }
        const parent = existing.get(connection.parentId);
        if (!parent) continue;
        const parentConnection = connection.kind === "next"
          ? parent.nextConnection
          : parent.getInput(connection.inputName)?.connection;
        const childConnection = connection.kind === "next" ? child.previousConnection : child.outputConnection;
        if (!parentConnection || !childConnection || parentConnection.targetConnection === childConnection) continue;
        if (parentConnection.isConnected()) parentConnection.disconnect();
        if (childConnection.isConnected()) childConnection.disconnect();
        parentConnection.connect(childConnection);
      }
      for (const block of existing.values()) block.render();
      Blockly.svgResize(canvas);
    } finally { Blockly.Events.enable(); }
  }, [visualNodes, draft, connections, disclosure, canvasBlocks, objects]);

  useEffect(() => {
    if (!selectedId) return;
    const node = visualNodes.find((item) => item.address.focusId === selectedId);
    const id = node?.id ?? (canvasBlocks[selectedId] ? selectedId : null);
    if (!id) return;
    workspace.current?.getAllBlocks(false).find((block) => readAddress(block) === id)?.select();
  }, [selectedId, visualNodes, canvasBlocks]);

  return <div className="blocky-representation" aria-label="Add blocks and compose strategy logic" data-blocky-contract="entry-style-v2-native" data-native-toolbox="category-flyout" data-native-add-open={addSurfaceOpen && !suspended} data-native-add-suspended={suspended} data-native-serialization="json" data-blocky-node-count={visualNodes.length + Object.keys(canvasBlocks).length} data-portfolio-block="excluded" data-workspace-pan="enabled" data-layout-updates="draft-only" data-block-identity="stable">
    <div className="blocky-canvas" ref={host} aria-label="Strategy logic blocks" data-add-expanded="false" data-native-drag-active="false" />
  </div>;
}
