import { useEffect, useRef } from "react";
import * as Blockly from "blockly";

import type { ProductNode } from "../domain/productSemantics";
import type { ProgramBlockNode } from "../domain/programProjections";
import type { ProgramDraftConcept } from "../domain/programWorkingDraft";
import { registerBlockyProgramBlocks } from "./blockyProgramBlocks";

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
  block.data = JSON.stringify({ productId: id });
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
      const context = canvas.newBlock("rt_context") as Blockly.BlockSvg;
      context.setFieldValue(root.label, "LABEL"); setAddress(context, root.id);
      context.setDeletable(false); context.setMovable(true); context.contextMenu = false;
      context.initSvg(); context.render(); context.moveBy(40, 36);
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

/** Program-native logic projection. It never consumes the Structure tree. */
export function ProgramBlockyProjection({ nodes, selectedId, onSelect, positions = {}, connections = {}, disclosure = {}, draft = null, onBlockMove, onDisclosureChange, onDraftDelete, onToolDrop }: {
  nodes: ProgramBlockNode[];
  selectedId: string | null;
  onSelect: (focusId: string | null) => void;
  positions?: Record<string, { x: number; y: number }>;
  connections?: Record<string, { childId: string; parentId: string | null; inputName: string | null }>;
  disclosure?: Record<string, 0 | 1 | 2>;
  draft?: ProgramDraftConcept;
  onBlockMove?: (blockId: string, position: { x: number; y: number }, parentId: string | null, inputName: string | null) => void;
  onDisclosureChange?: (blockId: string, level: 0 | 1 | 2) => void;
  onDraftDelete?: () => void;
  onToolDrop?: (toolId: string, position: { x: number; y: number }) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const workspace = useRef<Blockly.WorkspaceSvg | null>(null);
  const nodesRef = useRef(nodes);
  const onSelectRef = useRef(onSelect);
  const callbacksRef = useRef({ onBlockMove, onDisclosureChange, onDraftDelete });
  const positionsRef = useRef(positions);
  nodesRef.current = nodes;
  onSelectRef.current = onSelect;
  callbacksRef.current = { onBlockMove, onDisclosureChange, onDraftDelete };
  positionsRef.current = positions;

  useEffect(() => {
    if (!host.current) return;
    registerBlockyProgramBlocks();
    const canvas = Blockly.inject(host.current, {
      trashcan: false, sounds: false,
      move: { scrollbars: true, drag: true, wheel: true },
      zoom: { controls: true, wheel: true, startScale: .9, minScale: .4, maxScale: 1.8, scaleSpeed: 1.12 },
    });
    workspace.current = canvas;
    const listener = (event: Blockly.Events.Abstract) => {
      if (event.type !== Blockly.Events.CLICK) return;
      const click = event as Blockly.Events.Abstract & { targetType?: string; blockId?: string };
      if (click.targetType === Blockly.Events.ClickTarget.WORKSPACE) onSelectRef.current(null);
      if (click.targetType === Blockly.Events.ClickTarget.BLOCK && click.blockId) {
        const id = readAddress(canvas.getBlockById(click.blockId));
        const selected = nodesRef.current.find((item) => item.id === id);
        if (selected) onSelectRef.current(selected.address.focusId);
      }
    };
    const editListener = (event: Blockly.Events.Abstract) => {
      const blockId = (event as Blockly.Events.Abstract & { blockId?: string }).blockId;
      if (!blockId) return;
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
        callbacksRef.current.onBlockMove?.(address, { x: xy.x, y: xy.y }, parentId, inputName);
      }
      if (event.type === Blockly.Events.BLOCK_DELETE) {
        const raw = (event as Blockly.Events.Abstract & { oldJson?: { data?: string } }).oldJson?.data;
        try { if (raw && (JSON.parse(raw) as { productId?: string }).productId?.startsWith("draft:")) callbacksRef.current.onDraftDelete?.(); }
        catch { /* Ignore malformed third-party Blockly data. */ }
      }
      if (event.type === Blockly.Events.BLOCK_CHANGE) {
        const change = event as Blockly.Events.Abstract & { element?: string; newValue?: unknown };
        if (change.element === "collapsed") {
          const block = canvas.getBlockById(blockId);
          const address = readAddress(block);
          if (address) callbacksRef.current.onDisclosureChange?.(address, change.newValue ? 0 : 1);
        }
      }
    };
    canvas.addChangeListener(listener); canvas.addChangeListener(editListener);
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => Blockly.svgResize(canvas));
    resizeObserver?.observe(host.current);
    return () => { resizeObserver?.disconnect(); canvas.removeChangeListener(listener); canvas.removeChangeListener(editListener); canvas.dispose(); workspace.current = null; };
  }, []);

  useEffect(() => {
    const canvas = workspace.current;
    if (!canvas) return;
    Blockly.Events.disable();
    try {
      const wanted = new Map(nodes.map((node) => [node.id, node]));
      const existing = new Map(canvas.getAllBlocks(false).flatMap((block) => {
        const id = readAddress(block);
        return id ? [[id, block as Blockly.BlockSvg] as const] : [];
      }));
      for (const [id, block] of existing) {
        if (id.startsWith("draft:")) continue;
        const node = wanted.get(id);
        if (!node || block.type !== semanticBlockType(node)) {
          block.dispose(false);
          existing.delete(id);
        }
      }
      nodes.forEach((node, index) => {
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
      const draftId = draft ? `draft:${draft.semanticId}` : null;
      const existingDraft = draftId ? existing.get(draftId) : null;
      if (draft && draftId && !existingDraft) {
        const type = draft.kind === "control" ? "rt_control"
          : draft.kind === "selection" ? "rt_selection"
            : draft.kind === "event_state" || (draft.kind === "financial_intent" && ["temporal_sequence", "multi_clock_policy"].includes(draft.recipe)) ? "rt_event"
              : draft.kind === "financial_intent" && draft.recipe === "market_regime_rotation" ? "rt_control"
                : draft.kind === "financial_intent" && draft.recipe === "weighted_score" ? "rt_selection"
                  : "rt_allocation";
        const block = canvas.newBlock(type) as Blockly.BlockSvg;
        setAddress(block, draftId);
        if (block.getField("LABEL")) block.setFieldValue(draft.kind === "selection" ? "Choose assets · unfinished"
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
      for (const [id, block] of existing) if (id.startsWith("draft:") && !activeDraftIds.has(id)) { block.dispose(false); existing.delete(id); }
      for (const node of nodes) {
        const tentative = connections[node.id];
        const connection = tentative
          ? tentative.parentId ? { kind: tentative.inputName === "NEXT" ? "next" as const : "input" as const, parentId: tentative.parentId, inputName: tentative.inputName ?? "NEXT" } : null
          : node.connection;
        const child = existing.get(node.id);
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
  }, [nodes, draft, connections, disclosure]);

  useEffect(() => {
    if (!selectedId) return;
    const node = nodes.find((item) => item.address.focusId === selectedId);
    if (!node) return;
    workspace.current?.getAllBlocks(false).find((block) => readAddress(block) === node.id)?.select();
  }, [selectedId, nodes]);

  return <div className="blocky-representation" data-blocky-contract="semantic-program-v1" data-blocky-node-count={nodes.length} data-workspace-pan="enabled" data-layout-updates="draft-only" data-block-identity="stable"
    onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-ruletrade-program-tool")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
    onDrop={(event) => { const toolId = event.dataTransfer.getData("application/x-ruletrade-program-tool"); if (!toolId) return; event.preventDefault(); const rect = host.current?.getBoundingClientRect(); onToolDrop?.(toolId, { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }); }}>
    <div className="blocky-canvas" ref={host} aria-label="Strategy logic blocks" />
  </div>;
}
