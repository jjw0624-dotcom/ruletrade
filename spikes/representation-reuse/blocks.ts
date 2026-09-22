import * as Blockly from "blockly";

export function defineLogicBlocks(): void {
  if (Blockly.Blocks.rt_assets) return;
  Blockly.defineBlocksWithJsonArray([
    { type: "rt_assets", message0: "Assets  %1", args0: [{ type: "field_label_serializable", name: "value", text: "" }], nextStatement: null, colour: 195 },
    { type: "rt_score", message0: "Calculate trailing return  %1", args0: [{ type: "field_label_serializable", name: "value", text: "" }], previousStatement: null, nextStatement: null, colour: 200 },
    { type: "rt_condition", message0: "If return above  %1 %%", args0: [{ type: "field_number", name: "threshold", value: 0, min: -100, max: 100, precision: 0.1 }], previousStatement: null, nextStatement: null, colour: 165 },
    { type: "rt_rank", message0: "Rank  %1", args0: [{ type: "field_label_serializable", name: "value", text: "" }], previousStatement: null, nextStatement: null, colour: 225 },
    { type: "rt_choose", message0: "Choose  %1", args0: [{ type: "field_label_serializable", name: "value", text: "" }], previousStatement: null, nextStatement: null, colour: 235 },
    { type: "rt_fallback", message0: "Otherwise  %1", args0: [{ type: "field_label_serializable", name: "value", text: "" }], previousStatement: null, colour: 40 },
  ]);
}
