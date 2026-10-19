import { describe, expect, it } from "vitest";
import * as Blockly from "blockly";

import { entryBlockJson, entryBlocklyExtraState, entryBlocklyFields, entryBlocklyFlyoutToolbox, entryBlocklyToolbox, entryBlocklyType, entryDefinitionIdForBlock, registerBlockyProgramBlocks } from "../components/blockyProgramBlocks";
import { entryBlockDefinition } from "./entryStyleGrammar";
import { nativeBlockFieldController, programBlockyVisibleNodes } from "../components/ProductBlockyProjection";

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

  it("renders simple financial meaning in one compact horizontal message", () => {
    expect(entryBlockJson(entryBlockDefinition("invest")!)).toMatchObject({ message0: "Buy %1 with %2", inputsInline: true });
    expect(entryBlockJson(entryBlockDefinition("trailing-return")!)).toMatchObject({ message0: "%1 return over %2 days", inputsInline: true });
    expect(entryBlockJson(entryBlockDefinition("rebalance")!)).toMatchObject({ message0: "Rebalance %1 to %2 portfolio weight", inputsInline: true });
    expect(entryBlockJson(entryBlockDefinition("invest")!)).not.toHaveProperty("message1");
  });

  it("uses typed native connections for nested AssetSet and candidate-predicate composition", () => {
    registerBlockyProgramBlocks();
    const workspace = new Blockly.Workspace();
    const filter = workspace.newBlock(entryBlocklyType("filter-assets"));
    const group = workspace.newBlock(entryBlocklyType("group-reference"));
    const predicate = workspace.newBlock(entryBlocklyType("candidate-compare"));
    const candidateRsi = workspace.newBlock(entryBlocklyType("candidate-rsi"));
    const top = workspace.newBlock(entryBlocklyType("top-n-assets"));
    filter.getInput("ASSETS")!.connection!.connect(group.outputConnection!);
    predicate.getInput("A")!.connection!.connect(candidateRsi.outputConnection!);
    filter.getInput("PREDICATE")!.connection!.connect(predicate.outputConnection!);
    top.getInput("ASSETS")!.connection!.connect(filter.outputConnection!);
    expect(filter.getInputTargetBlock("ASSETS")).toBe(group);
    expect(filter.getInputTargetBlock("PREDICATE")).toBe(predicate);
    expect(top.getInputTargetBlock("ASSETS")).toBe(filter);
    workspace.dispose();
  });

  it("serializes deterministic random draft metadata without claiming execution", () => {
    registerBlockyProgramBlocks();
    const first = new Blockly.Workspace();
    const random = first.newBlock(entryBlocklyType("random-filter-assets"));
    random.setFieldValue("42", "SEED");
    random.setFieldValue("PER_SCHEDULE", "REDRAW");
    const state = Blockly.serialization.workspaces.save(first);
    const second = new Blockly.Workspace();
    Blockly.serialization.workspaces.load(state, second);
    const restored = second.getBlockById(random.id)!;
    expect(restored.getFieldValue("SEED")).toBe("42");
    expect(restored.getFieldValue("REDRAW")).toBe("PER_SCHEDULE");
    first.dispose(); second.dispose();
  });

  it("lets Builder Add select one category while Blockly renders its shaped flyout", () => {
    const flyout = entryBlocklyFlyoutToolbox("Action") as unknown as { kind: string; contents: Array<{ type?: string }> };
    expect(flyout.kind).toBe("flyoutToolbox");
    expect(flyout.contents.map((item) => item.type)).toEqual(expect.arrayContaining([entryBlocklyType("invest"), entryBlocklyType("rebalance")]));
  });

  it("lets Inspector and the block edit the same native field instead of mirrored state", () => {
    registerBlockyProgramBlocks();
    const workspace = new Blockly.Workspace();
    const choose = workspace.newBlock(entryBlocklyType("choose-group"));
    choose.data = JSON.stringify({ productId: "draft:choose", definitionId: "choose-group" });
    const fields = nativeBlockFieldController(workspace);
    expect(fields.setFieldValue("draft:choose", "SHORTAGE", "CHOOSE_ALL")).toBe(true);
    expect(choose.getFieldValue("SHORTAGE")).toBe("CHOOSE_ALL");
    choose.setFieldValue("REQUIRE_FULL", "SHORTAGE");
    expect(fields.fieldValue("draft:choose", "SHORTAGE")).toBe("REQUIRE_FULL");
    workspace.dispose();
  });

  it("excludes the canonical Portfolio context only from Blocky", () => {
    const visible = programBlockyVisibleNodes([
      { id: "context:portfolio", role: "context", label: "Portfolio", depth: 0, address: { kind: "strategy", focusId: "portfolio", semanticId: "program", canonicalPath: "program" } },
      { id: "action:1", role: "allocation", label: "Rebalance QQQ", depth: 1, address: { kind: "statement", focusId: "action:1", semanticId: "action:1", canonicalPath: "statements" } },
    ]);
    expect(visible.map((node) => node.label)).toEqual(["Rebalance QQQ"]);
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
