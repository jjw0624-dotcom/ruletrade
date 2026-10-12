import { useEffect, useRef } from "react";
import * as Blockly from "blockly";

import type { ProductNode } from "../domain/productSemantics";
import type { ProgramBlockNode } from "../domain/programProjections";
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
  if (node.role === "selection") return "rt_selection";
  if (node.role === "allocation") return "rt_allocation";
  if (node.role === "control" || node.role === "policy") return "rt_control";
  return "rt_action";
}

/** Program-native logic projection. It never consumes the Structure tree. */
export function ProgramBlockyProjection({ nodes, selectedId, onSelect }: {
  nodes: ProgramBlockNode[];
  selectedId: string | null;
  onSelect: (focusId: string | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const workspace = useRef<Blockly.WorkspaceSvg | null>(null);

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
      if (click.targetType === Blockly.Events.ClickTarget.WORKSPACE) onSelect(null);
      if (click.targetType === Blockly.Events.ClickTarget.BLOCK && click.blockId) {
        const id = readAddress(canvas.getBlockById(click.blockId));
        const selected = nodes.find((item) => item.id === id);
        if (selected) onSelect(selected.address.focusId);
      }
    };
    canvas.addChangeListener(listener);
    return () => { canvas.removeChangeListener(listener); canvas.dispose(); workspace.current = null; };
  }, [nodes, onSelect]);

  useEffect(() => {
    const canvas = workspace.current;
    if (!canvas) return;
    Blockly.Events.disable();
    try {
      canvas.clear();
      nodes.forEach((node, index) => {
        const block = canvas.newBlock(semanticBlockType(node)) as Blockly.BlockSvg;
        const label = node.detail ? `${node.label} · ${node.detail}` : node.label;
        block.setFieldValue(label, node.role === "trigger" ? "LABEL" : "LABEL");
        setAddress(block, node.id);
        block.setDeletable(false); block.setMovable(true); block.contextMenu = false;
        block.initSvg(); block.render();
        block.moveBy(40 + node.depth * 54, 36 + index * 92);
      });
      canvas.clearUndo(); Blockly.svgResize(canvas);
    } finally { Blockly.Events.enable(); }
  }, [nodes]);

  useEffect(() => {
    if (!selectedId) return;
    const node = nodes.find((item) => item.address.focusId === selectedId);
    if (!node) return;
    workspace.current?.getAllBlocks(false).find((block) => readAddress(block) === node.id)?.select();
  }, [selectedId, nodes]);

  return <div className="blocky-representation" data-blocky-contract="semantic-program-v1" data-blocky-node-count={nodes.length}>
    <div className="blocky-canvas" ref={host} aria-label="Strategy logic blocks" />
  </div>;
}
