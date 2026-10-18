import * as Blockly from "blockly";
import { ENTRY_BLOCK_DEFINITIONS, type EntryBlockDefinition, type EntryValueType } from "../domain/entryStyleGrammar";

let registered = false;

export const entryBlocklyType = (definitionId: string) => `rt_entry_${definitionId.replace(/[^a-z0-9]+/gi, "_")}`;

const checkName = (type: EntryValueType) => `RuleTrade${type}`;

function entryBlockJson(definition: EntryBlockDefinition): Record<string, unknown> {
  const json: Record<string, unknown> = {
    type: entryBlocklyType(definition.id),
    message0: definition.label,
    colour: ({ Start: 285, Control: 320, Logic: 155, Calculate: 190, Action: 115, Assets: 225, Data: 45, Functions: 260 } as const)[definition.category],
    tooltip: `${definition.description} ${definition.execution === "verified" ? "Execution verified." : definition.execution === "draft_only" ? "Working Draft only." : "Execution depends on completed context."}`,
  };
  const numericLiteral = ["number", "percentage", "money", "quantity", "trading-days", "calendar-days"].includes(definition.id);
  if (numericLiteral) {
    json.message0 = `${definition.label} %1`;
    json.args0 = [{ type: "field_number", name: "VALUE", value: definition.id === "percentage" ? 100 : 1, min: 0 }];
  } else if (["asset-reference", "group-reference", "subgroup-reference", "signal-reference", "read-variable", "state", "call-function", "import-function"].includes(definition.id)) {
    json.message0 = `${definition.label} %1`;
    json.args0 = [{ type: "field_input", name: "REFERENCE", text: "choose…" }];
  } else if (["create-group", "create-variable", "create-function"].includes(definition.id)) {
    json.message0 = `${definition.label} %1`;
    json.args0 = [{ type: "field_input", name: "NAME", text: "name" }];
  }
  definition.slots.forEach((slot, index) => {
    json[`message${index + 1}`] = `${slot.label} %1`;
    json[`args${index + 1}`] = [{ type: "input_value", name: slot.name, check: slot.accepts.map(checkName) }];
  });
  if (definition.id === "if-otherwise") {
    json.message2 = "DO %1"; json.args2 = [{ type: "input_statement", name: "THEN", check: "RuleTradeStatement" }];
    json.message3 = "OTHERWISE %1"; json.args3 = [{ type: "input_statement", name: "ELSE", check: "RuleTradeStatement" }];
  } else if (["repeat-n", "repeat-while"].includes(definition.id)) {
    const index = definition.slots.length + 1;
    json[`message${index}`] = "DO %1"; json[`args${index}`] = [{ type: "input_statement", name: "DO", check: "RuleTradeStatement" }];
  }
  if (definition.shape === "value") json.output = checkName(definition.output ?? "Value");
  else {
    if (definition.shape === "statement") json.previousStatement = "RuleTradeStatement";
    json.nextStatement = "RuleTradeStatement";
  }
  return json;
}

function argumentInputs(output: "RuleTradeCondition" | "RuleTradeValue") {
  const check = ["RuleTradeCondition", "RuleTradeValue"];
  const inputs: Record<string, unknown> = { output };
  for (let index = 1; index <= 12; index += 1) {
    inputs[`message${index}`] = "%1";
    inputs[`args${index}`] = [{ type: "input_value", name: `ARG_${index}`, check }];
  }
  return inputs;
}

export function registerBlockyProgramBlocks() {
  if (registered) return;
  registered = true;
  Blockly.defineBlocksWithJsonArray([
    { type: "rt_context", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Context" }], colour: 255 },
    { type: "rt_trigger", message0: "Every %1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "month" }], nextStatement: null, colour: 285 },
    { type: "rt_group", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Group" }], colour: 230 },
    { type: "rt_selection", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Choose assets" }], message1: "Qualification %1", args1: [{ type: "input_value", name: "ELIGIBILITY", check: "RuleTradeCondition" }], message2: "Order by %1", args2: [{ type: "input_value", name: "RANKING", check: "RuleTradeValue" }], message3: "%1", args3: [{ type: "input_value", name: "CONSTRAINT", check: "RuleTradeConstraint" }], message4: "%1", args4: [{ type: "input_value", name: "FALLBACK", check: "RuleTradeFallback" }], previousStatement: null, nextStatement: null, colour: 210 },
    { type: "rt_random_selection", message0: "Choose %1 assets", args0: [{ type: "field_number", name: "COUNT", value: 1, min: 1, precision: 1 }], previousStatement: null, nextStatement: null, colour: 210 },
    { type: "rt_eligibility", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Eligibility" }], output: "RuleTradeEligibility", colour: 155 },
    { type: "rt_constraint", message0: "Cooldown %1 trading days", args0: [{ type: "field_number", name: "VALUE", value: 1, min: 1, precision: 1 }], output: "RuleTradeConstraint", colour: 35 },
    { type: "rt_condition", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Condition" }], ...argumentInputs("RuleTradeCondition"), colour: 155 },
    { type: "rt_value", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Value" }], ...argumentInputs("RuleTradeValue"), colour: 190 },
    { type: "rt_fallback", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Fallback" }], output: "RuleTradeFallback", colour: 65 },
    { type: "rt_allocation", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Allocate capital" }], message1: "When %1", args1: [{ type: "input_value", name: "CONDITION", check: "RuleTradeCondition" }], previousStatement: null, nextStatement: null, colour: 120 },
    { type: "rt_investment", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Invest" }], message1: "Target %1", args1: [{ type: "input_value", name: "TARGET", check: ["RuleTradeAsset", "RuleTradeGroup", "RuleTradeSubgroup"] }], message2: "By %1", args2: [{ type: "input_value", name: "AMOUNT", check: ["RuleTradeMoney", "RuleTradePercentage", "RuleTradeQuantity"] }], previousStatement: "RuleTradeStatement", nextStatement: "RuleTradeStatement", colour: 120 },
    { type: "rt_split", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Split Portfolio" }], message1: "Route 1 %1", args1: [{ type: "input_statement", name: "LEG_1" }], message2: "Route 2 %1", args2: [{ type: "input_statement", name: "LEG_2" }], message3: "Route 3 %1", args3: [{ type: "input_statement", name: "LEG_3" }], message4: "Route 4 %1", args4: [{ type: "input_statement", name: "LEG_4" }], previousStatement: null, nextStatement: null, colour: 105 },
    { type: "rt_action", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Rebalance" }], previousStatement: null, nextStatement: null, colour: 20 },
    { type: "rt_control", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "IF" }], message1: "Condition %1", args1: [{ type: "input_value", name: "CONDITION", check: "RuleTradeCondition" }], message2: "DO %1", args2: [{ type: "input_statement", name: "THEN" }], message3: "OTHERWISE %1", args3: [{ type: "input_statement", name: "ELSE" }], previousStatement: null, nextStatement: null, colour: 300 },
    { type: "rt_event", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Event" }], message1: "When %1", args1: [{ type: "input_value", name: "CONDITION", check: "RuleTradeCondition" }], message2: "DO %1", args2: [{ type: "input_statement", name: "DO" }], previousStatement: null, nextStatement: null, colour: 285 },
    { type: "rt_state", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "State change" }], message1: "When %1", args1: [{ type: "input_value", name: "CONDITION", check: "RuleTradeCondition" }], previousStatement: null, nextStatement: null, colour: 45 },
    { type: "rt_memory", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Remember Value" }], message1: "Value %1", args1: [{ type: "input_value", name: "VALUE", check: "RuleTradeValue" }], previousStatement: null, nextStatement: null, colour: 190 },
    { type: "rt_policy", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Allocation policy" }], message1: "Guard %1", args1: [{ type: "input_value", name: "CONDITION", check: "RuleTradeCondition" }], message2: "DO %1", args2: [{ type: "input_statement", name: "DO" }], previousStatement: null, nextStatement: null, colour: 300 },
    { type: "rt_draft_if", message0: "IF %1", args0: [{ type: "field_label_serializable", name: "PREDICATE", text: "[set condition]" }], message1: "DO %1", args1: [{ type: "input_statement", name: "THEN" }], previousStatement: null, nextStatement: null, colour: 330 },
    { type: "rt_draft_if_else", message0: "IF %1", args0: [{ type: "field_label_serializable", name: "PREDICATE", text: "[set condition]" }], message1: "DO %1", args1: [{ type: "input_statement", name: "THEN" }], message2: "OTHERWISE %1", args2: [{ type: "input_statement", name: "ELSE" }], previousStatement: null, nextStatement: null, colour: 330 },
    ...ENTRY_BLOCK_DEFINITIONS.map(entryBlockJson),
  ]);
}
