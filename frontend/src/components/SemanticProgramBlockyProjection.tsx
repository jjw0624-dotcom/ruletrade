import { useEffect, useRef } from "react";
import * as Blockly from "blockly";

import type { ProgramStatementV2 } from "../domain/canonicalV2";
import { describeProgramStatement } from "../domain/v2Semantics";
import { registerBlockyProgramBlocks } from "./blockyProgramBlocks";

interface ProgramBlockData {
  semanticId: string;
}

function blockType(statement: ProgramStatementV2) {
  if (statement.kind === "select") return "rt_selection";
  if (statement.kind === "allocate" || statement.kind === "guarded_allocation") return "rt_allocation";
  if (statement.kind === "control") return "rt_control";
  return "rt_action";
}

function setData(block: Blockly.Block, semanticId: string) {
  block.data = JSON.stringify({ semanticId } satisfies ProgramBlockData);
}

function readData(block: Blockly.Block): ProgramBlockData | null {
  try { return block.data ? JSON.parse(block.data) as ProgramBlockData : null; }
  catch { return null; }
}

function createBlock(canvas: Blockly.WorkspaceSvg, statement: ProgramStatementV2): Blockly.BlockSvg {
  const block = canvas.newBlock(blockType(statement)) as Blockly.BlockSvg;
  block.setFieldValue(describeProgramStatement(statement), "LABEL");
  setData(block, statement.semantic_id);
  block.setDeletable(false);
  block.setMovable(true);
  block.contextMenu = false;
  block.initSvg();
  block.render();
  if (statement.kind === "control") {
    connectChain(canvas, block, "THEN", statement.then_statements);
    connectChain(canvas, block, "ELSE", statement.otherwise_statements);
  }
  return block;
}

function connectChain(canvas: Blockly.WorkspaceSvg, parent: Blockly.BlockSvg, input: string, statements: ProgramStatementV2[]) {
  let connection = parent.getInput(input)?.connection ?? null;
  for (const statement of statements.filter((item) => ["select", "allocate", "control", "guarded_allocation"].includes(item.kind))) {
    const child = createBlock(canvas, statement);
    if (connection && child.previousConnection) connection.connect(child.previousConnection);
    connection = child.nextConnection;
  }
}

export function SemanticProgramBlockyProjection({ statements, selectedId, onSelect }: {
  statements: ProgramStatementV2[];
  selectedId: string | null;
  onSelect: (semanticId: string | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const workspace = useRef<Blockly.WorkspaceSvg | null>(null);
  const positions = useRef(new Map<string, Blockly.utils.Coordinate>());
  const initializing = useRef(false);

  useEffect(() => {
    if (!host.current) return;
    registerBlockyProgramBlocks();
    const canvas = Blockly.inject(host.current, {
      trashcan: false,
      sounds: false,
      move: { scrollbars: true, drag: true, wheel: true },
      zoom: { controls: true, wheel: true, startScale: 1, minScale: .45, maxScale: 1.8, scaleSpeed: 1.12 },
    });
    workspace.current = canvas;
    const listener = (event: Blockly.Events.Abstract) => {
      if (initializing.current || event.type !== Blockly.Events.CLICK) return;
      const click = event as Blockly.Events.Abstract & { targetType?: string; blockId?: string };
      if (click.targetType === Blockly.Events.ClickTarget.WORKSPACE) onSelect(null);
      if (click.targetType === Blockly.Events.ClickTarget.BLOCK && click.blockId) {
        const id = readData(canvas.getBlockById(click.blockId)!)?.semanticId;
        if (id) onSelect(id);
      }
    };
    canvas.addChangeListener(listener);
    return () => { canvas.removeChangeListener(listener); canvas.dispose(); workspace.current = null; };
  }, [onSelect]);

  useEffect(() => {
    const canvas = workspace.current;
    if (!canvas) return;
    for (const block of canvas.getTopBlocks(false)) {
      const id = readData(block)?.semanticId;
      if (id) positions.current.set(id, block.getRelativeToSurfaceXY());
    }
    initializing.current = true;
    Blockly.Events.disable();
    try {
      canvas.clear();
      const portfolio = canvas.newBlock("rt_context") as Blockly.BlockSvg;
      portfolio.setFieldValue("Portfolio", "LABEL");
      portfolio.setDeletable(false);
      portfolio.setMovable(true);
      portfolio.contextMenu = false;
      portfolio.initSvg();
      portfolio.render();
      portfolio.moveBy(40, 36);
      let prior: Blockly.BlockSvg | null = null;
      statements.forEach((statement, index) => {
        const block = createBlock(canvas, statement);
        if (prior?.nextConnection && block.previousConnection) prior.nextConnection.connect(block.previousConnection);
        else if (!prior) {
          const position = positions.current.get(statement.semantic_id);
          block.moveBy(position?.x ?? 80, position?.y ?? 120 + index * 110);
        }
        prior = block;
      });
      canvas.clearUndo();
      Blockly.svgResize(canvas);
    } finally {
      Blockly.Events.enable();
      initializing.current = false;
    }
  }, [statements]);

  useEffect(() => {
    const canvas = workspace.current;
    if (!canvas || !selectedId) return;
    canvas.getAllBlocks(false).find((block) => readData(block)?.semanticId === selectedId)?.select();
  }, [selectedId, statements]);

  return <div className="blocky-representation" data-program-composer="production">
    <div className="blocky-canvas" ref={host} aria-label="Strategy decision program" />
  </div>;
}
