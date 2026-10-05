import * as Blockly from "blockly";
import { describe, expect, it } from "vitest";

import type { ConditionExpression } from "./canonical";

import { classifyWorkingProgram, controlCommitIntent } from "./logicDraft";
import { projectWorkingProgram, registerBlockyProgramBlocks } from "../views/BlockyView";

function semanticData(workingId: string, source: "canonical" | "draft" = "canonical", condition: ConditionExpression | null = null) {
  return JSON.stringify({ workingId, source, kind: workingId, condition });
}

function block(workspace: Blockly.Workspace, type: string, workingId: string, source: "canonical" | "draft" = "canonical", condition: ConditionExpression | null = null) {
  const value = workspace.newBlock(type);
  value.data = semanticData(workingId, source, condition);
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
    expect(draft.blocks.find((item) => item.workingId === "logic-draft-1")?.condition).toBeNull();
    expect(classifyWorkingProgram(draft, baseline)).toBe("incomplete");
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


describe("typed control branch readiness", () => {
  const item = (
    workingId: string,
    blockType: string,
    componentId: string | null,
    parentWorkingId: string | null,
    inputName: string | null,
    nextWorkingId: string | null,
    source: "canonical" | "draft" = "canonical",
    summary: string | null = null,
    condition: ConditionExpression | null = null,
  ) => ({ workingId, blockType, source, componentId, parentWorkingId, inputName, nextWorkingId, summary, condition });

  it("requires an explicit composed Predicate before a valid branch topology becomes commit-ready", () => {
    const condition: ConditionExpression = {
      kind: "comparison", operator: "gte",
      left: { kind: "current", series: { kind: "market_series", field: "price", subject: { kind: "literal", value_type: "asset", value: "QQQ" } } },
      right: { kind: "literal", value_type: "money_per_share", value: 100 },
    };
    const program = { blocks: [
      item("trigger", "rt_trigger", "monthly", null, null, null),
      item("control", "rt_draft_if_else", null, null, null, null, "draft", null, condition),
      item("then-allocation", "rt_allocation", "weights", "control", "THEN", "then-action"),
      item("then-action", "rt_action", "rebalance", "then-allocation", "NEXT", null),
      item("else-allocation", "rt_allocation", "defensive_weights", "control", "ELSE", "else-action"),
      item("else-action", "rt_action", "rebalance", "else-allocation", "NEXT", null),
    ] };
    const unset = { blocks: program.blocks.map((block) => block.workingId === "control" ? { ...block, condition: null } : block) };
    expect(classifyWorkingProgram(unset, { blocks: [program.blocks[0]] })).toBe("incomplete");
    expect(controlCommitIntent(unset)).toBeNull();
    expect(classifyWorkingProgram(program, { blocks: [program.blocks[0]] })).toBe("commit_ready");
    expect(controlCommitIntent(program)).toMatchObject({
      component_id: "rebalance",
      then_target_component_id: "weights",
      otherwise_target_component_id: "defensive_weights",
      condition,
    });
  });

  it("keeps Timing and nested Control topologies unsupported", () => {
    const base = [
      item("action", "rt_action", "rebalance", null, null, null),
      item("control", "rt_draft_if", null, null, null, null, "draft", null, {
        kind: "comparison", operator: "gt", left: { kind: "literal", value_type: "decimal", value: 1 }, right: { kind: "literal", value_type: "decimal", value: 0 },
      }),
    ];
    const timing = { blocks: [...base, item("timing", "rt_trigger", "monthly", "control", "THEN", null)] };
    expect(classifyWorkingProgram(timing, { blocks: [base[0]] })).toBe("valid_but_unsupported");
    expect(controlCommitIntent(timing)).toBeNull();
  });
});
