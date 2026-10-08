import { useEffect, useRef, type ReactNode } from "react";
import * as Blockly from "blockly";

import type { ProgramStatementV2 } from "../domain/canonicalV2";
import { describeProgramStatement } from "../domain/v2Semantics";

interface ProgramBlockData {
  semanticId: string;
}

let registered = false;

function registerProgramBlocks() {
  if (registered) return;
  registered = true;
  Blockly.defineBlocksWithJsonArray([
    { type: "rt_v2_selection", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Choose assets" }], previousStatement: null, nextStatement: null, colour: 210 },
    { type: "rt_v2_allocation", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Allocate capital" }], previousStatement: null, nextStatement: null, colour: 120 },
    { type: "rt_v2_control", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "IF condition" }], message1: "DO %1", args1: [{ type: "input_statement", name: "THEN" }], message2: "OTHERWISE %1", args2: [{ type: "input_statement", name: "ELSE" }], previousStatement: null, nextStatement: null, colour: 300 },
    { type: "rt_v2_event", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "WHEN event occurs" }], message1: "DO %1", args1: [{ type: "input_statement", name: "EVENT" }], previousStatement: null, nextStatement: null, colour: 285 },
    { type: "rt_v2_state", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Change state" }], previousStatement: null, nextStatement: null, colour: 35 },
    { type: "rt_v2_remember", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Remember value for later" }], previousStatement: null, nextStatement: null, colour: 45 },
    { type: "rt_v2_policy", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Apply allocation policy" }], previousStatement: null, nextStatement: null, colour: 65 },
    { type: "rt_v2_unresolved", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Needs a precise definition" }], previousStatement: null, nextStatement: null, colour: 5 },
  ]);
}

function blockType(statement: ProgramStatementV2) {
  if (statement.kind === "select") return "rt_v2_selection";
  if (statement.kind === "allocate") return "rt_v2_allocation";
  if (statement.kind === "control") return "rt_v2_control";
  if (statement.kind === "on_event") return "rt_v2_event";
  if (statement.kind === "transition") return "rt_v2_state";
  if (statement.kind === "remember_value") return "rt_v2_remember";
  if (statement.kind === "guarded_allocation") return "rt_v2_policy";
  return "rt_v2_unresolved";
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
  } else if (statement.kind === "on_event") {
    connectChain(canvas, block, "EVENT", statement.statements);
  }
  return block;
}

function connectChain(canvas: Blockly.WorkspaceSvg, parent: Blockly.BlockSvg, input: string, statements: ProgramStatementV2[]) {
  let connection = parent.getInput(input)?.connection ?? null;
  for (const statement of statements) {
    const child = createBlock(canvas, statement);
    if (connection && child.previousConnection) connection.connect(child.previousConnection);
    connection = child.nextConnection;
  }
}

export function SemanticProgramBlockyProjection({ statements, selectedId, onSelect, empty }: {
  statements: ProgramStatementV2[];
  selectedId: string | null;
  onSelect: (semanticId: string | null) => void;
  empty: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const workspace = useRef<Blockly.WorkspaceSvg | null>(null);
  const positions = useRef(new Map<string, Blockly.utils.Coordinate>());
  const initializing = useRef(false);

  useEffect(() => {
    if (!host.current) return;
    registerProgramBlocks();
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
      let prior: Blockly.BlockSvg | null = null;
      statements.forEach((statement, index) => {
        const block = createBlock(canvas, statement);
        if (prior?.nextConnection && block.previousConnection) prior.nextConnection.connect(block.previousConnection);
        else if (!prior) {
          const position = positions.current.get(statement.semantic_id);
          block.moveBy(position?.x ?? 80, position?.y ?? 60 + index * 110);
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

  return <div className="blocky-representation v2-program-blocky" data-program-blocky="production">
    <div className="blocky-canvas" ref={host} aria-label="Strategy decision program" />
    {statements.length === 0 && <div className="program-empty-state">{empty}</div>}
  </div>;
}
