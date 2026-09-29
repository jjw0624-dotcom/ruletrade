import * as Blockly from "blockly";
import { describe, expect, it } from "vitest";

import { classifyWorkingProgram } from "./logicDraft";
import { projectWorkingProgram, registerBlockyProgramBlocks } from "../views/BlockyView";

function semanticData(workingId: string, source: "canonical" | "draft" = "canonical") {
  return JSON.stringify({ workingId, source, kind: workingId });
}

function block(workspace: Blockly.Workspace, type: string, workingId: string, source: "canonical" | "draft" = "canonical") {
  const value = workspace.newBlock(type);
  value.data = semanticData(workingId, source);
  return value;
}

function connectNext(left: Blockly.Block, right: Blockly.Block) {
  left.nextConnection!.connect(right.previousConnection!);
}

describe("Blocky native working program", () => {
  it("uses the same native statement connections for projected and draft blocks", () => {
    registerBlockyProgramBlocks();
    const workspace = new Blockly.Workspace();
    const trigger = block(workspace, "rt_trigger", "trigger:monthly");
    const choose = block(workspace, "rt_selection", "statement:choose");
    const allocate = block(workspace, "rt_allocation", "statement:allocate");
    connectNext(trigger, choose);
    connectNext(choose, allocate);
    const baseline = projectWorkingProgram(workspace);

    const control = block(workspace, "rt_draft_if", "logic-draft-1", "draft");
    control.setFieldValue("market is risk-on", "PREDICATE");
    choose.unplug(true);
    control.getInput("THEN")!.connection!.connect(choose.previousConnection!);

    const draft = projectWorkingProgram(workspace);
    expect(draft.blocks.find((item) => item.workingId === "statement:choose")).toMatchObject({ parentWorkingId: "logic-draft-1", inputName: "THEN" });
    // Blockly heals the original stack when Choose is detached; Allocate remains executable.
    expect(draft.blocks.find((item) => item.workingId === "statement:allocate")).toMatchObject({ parentWorkingId: "trigger:monthly", inputName: "NEXT" });
    expect(classifyWorkingProgram(draft, baseline)).toBe("valid_but_unsupported");
    workspace.dispose();
  });

  it("adds multiple controls without clearing surviving connections", () => {
    registerBlockyProgramBlocks();
    const workspace = new Blockly.Workspace();
    const trigger = block(workspace, "rt_trigger", "trigger:monthly");
    const choose = block(workspace, "rt_selection", "statement:choose");
    connectNext(trigger, choose);
    const first = block(workspace, "rt_draft_if", "logic-draft-1", "draft");
    const second = block(workspace, "rt_draft_if_else", "logic-draft-2", "draft");

    expect(projectWorkingProgram(workspace).blocks.map((item) => item.workingId)).toEqual(expect.arrayContaining([
      "trigger:monthly", "statement:choose", "logic-draft-1", "logic-draft-2",
    ]));
    expect(trigger.getNextBlock()).toBe(choose);
    expect(first.workspace).toBe(workspace);
    expect(second.workspace).toBe(workspace);
    workspace.dispose();
  });

  it("inserts a compatible native statement between projected statements", () => {
    registerBlockyProgramBlocks();
    const workspace = new Blockly.Workspace();
    const trigger = block(workspace, "rt_trigger", "trigger:monthly");
    const allocate = block(workspace, "rt_allocation", "statement:allocate");
    const action = block(workspace, "rt_action", "statement:action");
    connectNext(trigger, action);

    trigger.nextConnection!.disconnect();
    connectNext(trigger, allocate);
    connectNext(allocate, action);

    expect(projectWorkingProgram(workspace).blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ workingId: "statement:allocate", parentWorkingId: "trigger:monthly" }),
      expect.objectContaining({ workingId: "statement:action", parentWorkingId: "statement:allocate" }),
    ]));
    workspace.dispose();
  });

  it("classifies native delete as incomplete while leaving Canonical outside the draft", () => {
    registerBlockyProgramBlocks();
    const workspace = new Blockly.Workspace();
    const trigger = block(workspace, "rt_trigger", "trigger:monthly");
    const choose = block(workspace, "rt_selection", "statement:choose");
    connectNext(trigger, choose);
    const baseline = projectWorkingProgram(workspace);
    choose.dispose(false);
    expect(classifyWorkingProgram(projectWorkingProgram(workspace), baseline)).toBe("incomplete");
    workspace.dispose();
  });

  it("ignores disconnected-script XY arrangement but tracks connection topology", () => {
    const baseline = { blocks: [
      { workingId: "a", blockType: "rt_action", source: "canonical" as const, componentId: "a", parentWorkingId: null, inputName: null, nextWorkingId: null, summary: null },
      { workingId: "b", blockType: "rt_action", source: "canonical" as const, componentId: "b", parentWorkingId: null, inputName: null, nextWorkingId: null, summary: null },
    ] };
    // Positions and viewport do not exist in the semantic snapshot.
    expect(classifyWorkingProgram({ blocks: [...baseline.blocks] }, baseline)).toBe("clean");
    expect(classifyWorkingProgram({ blocks: [
      { ...baseline.blocks[0], nextWorkingId: "b" },
      { ...baseline.blocks[1], parentWorkingId: "a", inputName: "NEXT" },
    ] }, baseline)).toBe("valid_but_unsupported");
  });

});
