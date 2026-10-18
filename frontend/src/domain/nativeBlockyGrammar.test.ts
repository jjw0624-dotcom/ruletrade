import { describe, expect, it } from "vitest";
import * as Blockly from "blockly";

import { entryBlocklyExtraState, entryBlocklyFields, entryBlocklyToolbox, entryBlocklyType, entryDefinitionIdForBlock, registerBlockyProgramBlocks } from "../components/blockyProgramBlocks";

describe("native Blockly product grammar", () => {
  it("reuses built-in logic, math, loop, variable, and procedure block types", () => {
    expect(entryBlocklyType("if-otherwise")).toBe("controls_if");
    expect(entryBlocklyType("compare-gt")).toBe("logic_compare");
    expect(entryBlocklyType("calculate-add")).toBe("math_arithmetic");
    expect(entryBlocklyType("repeat-n")).toBe("controls_repeat_ext");
    expect(entryBlocklyType("read-variable")).toBe("variables_get");
    expect(entryBlocklyType("create-function")).toBe("procedures_defreturn");
    expect(entryBlocklyExtraState("if-otherwise")).toEqual({ elseIfCount: 0, hasElse: true });
  });

  it("uses native connection geometry with RuleTrade-specific typed finance slots", () => {
    registerBlockyProgramBlocks();
    const workspace = new Blockly.Workspace();
    const invest = workspace.newBlock(entryBlocklyType("invest"));
    const comparison = workspace.newBlock(entryBlocklyType("compare-gt"));
    comparison.setFieldValue(String(entryBlocklyFields("compare-gt")!.OP), "OP");
    const arithmetic = workspace.newBlock(entryBlocklyType("calculate-add"));
    const number = workspace.newBlock(entryBlocklyType("number"));
    expect(invest.previousConnection?.getCheck()).toContain("RuleTradeStatement");
    expect(invest.getInput("TARGET")?.connection?.getCheck()).toEqual(expect.arrayContaining(["RuleTradeAsset", "RuleTradeGroup", "RuleTradeSubgroup"]));
    expect(invest.getInput("AMOUNT")?.connection?.getCheck()).toEqual(expect.arrayContaining(["RuleTradeMoney", "RuleTradePercentage", "RuleTradeQuantity"]));
    expect(comparison.outputConnection?.getCheck()).toContain("Boolean");
    expect(arithmetic.outputConnection?.getCheck()).toContain("Number");
    expect(number.outputConnection?.getCheck()).toContain("Number");
    arithmetic.getInput("A")!.connection!.connect(number.outputConnection!);
    expect(arithmetic.getInputTargetBlock("A")).toBe(number);
    workspace.dispose();
  });

  it("renders the primary categories through a native category toolbox and separates Group definition from references", () => {
    const toolbox = entryBlocklyToolbox([{ id: "growth", name: "Growth ETFs", kind: "group" }]) as unknown as { kind: string; contents: Array<{ name: string; contents: Array<Record<string, unknown>> }> };
    expect(toolbox.kind).toBe("categoryToolbox");
    expect(toolbox.contents.map((category) => category.name)).toEqual(["Start", "Control", "Logic", "Calculate", "Action", "Assets", "Data", "Functions"]);
    const assets = toolbox.contents.find((category) => category.name === "Assets")!.contents;
    expect(assets).toContainEqual(expect.objectContaining({ kind: "button", text: "Create Group…" }));
    expect(assets).not.toContainEqual(expect.objectContaining({ type: entryBlocklyType("create-group") }));
    expect(assets).toContainEqual(expect.objectContaining({ type: entryBlocklyType("group-reference"), fields: { REFERENCE: "Growth ETFs" } }));
  });

  it("round-trips native Blockly JSON with stable ids, coordinates, fields, and disconnected alternatives", () => {
    registerBlockyProgramBlocks();
    const first = new Blockly.Workspace();
    const left = first.newBlock(entryBlocklyType("invest"), "invest-a");
    const right = first.newBlock(entryBlocklyType("compare-lt"), "compare-b");
    left.data = JSON.stringify({ productId: "draft:invest-a", definitionId: "invest" });
    right.data = JSON.stringify({ productId: "draft:compare-b", definitionId: "compare-lt" });
    right.setFieldValue("LT", "OP");
    const state = Blockly.serialization.workspaces.save(first);
    const second = new Blockly.Workspace();
    Blockly.serialization.workspaces.load(state, second);
    expect(second.getBlockById("invest-a")?.data).toContain("draft:invest-a");
    expect(entryDefinitionIdForBlock(second.getBlockById("compare-b")!)).toBe("compare-lt");
    expect(second.getTopBlocks(false)).toHaveLength(2);
    first.dispose(); second.dispose();
  });
});
