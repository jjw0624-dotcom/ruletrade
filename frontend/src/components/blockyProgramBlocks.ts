import * as Blockly from "blockly";

let registered = false;

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
    { type: "rt_selection", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Choose assets" }], message1: "Qualification %1", args1: [{ type: "input_value", name: "ELIGIBILITY", check: "RuleTradeCondition" }], message2: "Order by %1", args2: [{ type: "input_value", name: "RANKING", check: "RuleTradeValue" }], message3: "%1", args3: [{ type: "input_value", name: "CONSTRAINT", check: "RuleTradeConstraint" }], message4: "%1", args4: [{ type: "input_value", name: "FALLBACK", check: "RuleTradeFallback" }], previousStatement: null, nextStatement: null, colour: 210 },
    { type: "rt_random_selection", message0: "Choose %1 assets", args0: [{ type: "field_number", name: "COUNT", value: 1, min: 1, precision: 1 }], previousStatement: null, nextStatement: null, colour: 210 },
    { type: "rt_eligibility", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Eligibility" }], output: "RuleTradeEligibility", colour: 155 },
    { type: "rt_constraint", message0: "Cooldown %1 trading days", args0: [{ type: "field_number", name: "VALUE", value: 1, min: 1, precision: 1 }], output: "RuleTradeConstraint", colour: 35 },
    { type: "rt_condition", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Condition" }], ...argumentInputs("RuleTradeCondition"), colour: 155 },
    { type: "rt_value", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Value" }], ...argumentInputs("RuleTradeValue"), colour: 190 },
    { type: "rt_fallback", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Fallback" }], output: "RuleTradeFallback", colour: 65 },
    { type: "rt_allocation", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Allocate capital" }], message1: "When %1", args1: [{ type: "input_value", name: "CONDITION", check: "RuleTradeCondition" }], previousStatement: null, nextStatement: null, colour: 120 },
    { type: "rt_action", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Rebalance" }], previousStatement: null, nextStatement: null, colour: 20 },
    { type: "rt_control", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "IF" }], message1: "Condition %1", args1: [{ type: "input_value", name: "CONDITION", check: "RuleTradeCondition" }], message2: "DO %1", args2: [{ type: "input_statement", name: "THEN" }], message3: "OTHERWISE %1", args3: [{ type: "input_statement", name: "ELSE" }], previousStatement: null, nextStatement: null, colour: 300 },
    { type: "rt_event", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Event" }], message1: "When %1", args1: [{ type: "input_value", name: "CONDITION", check: "RuleTradeCondition" }], message2: "DO %1", args2: [{ type: "input_statement", name: "DO" }], previousStatement: null, nextStatement: null, colour: 285 },
    { type: "rt_state", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "State change" }], message1: "When %1", args1: [{ type: "input_value", name: "CONDITION", check: "RuleTradeCondition" }], previousStatement: null, nextStatement: null, colour: 45 },
    { type: "rt_memory", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Remember Value" }], message1: "Value %1", args1: [{ type: "input_value", name: "VALUE", check: "RuleTradeValue" }], previousStatement: null, nextStatement: null, colour: 190 },
    { type: "rt_policy", message0: "%1", args0: [{ type: "field_label_serializable", name: "LABEL", text: "Allocation policy" }], message1: "Guard %1", args1: [{ type: "input_value", name: "CONDITION", check: "RuleTradeCondition" }], message2: "DO %1", args2: [{ type: "input_statement", name: "DO" }], previousStatement: null, nextStatement: null, colour: 300 },
    { type: "rt_draft_if", message0: "IF %1", args0: [{ type: "field_label_serializable", name: "PREDICATE", text: "[set condition]" }], message1: "DO %1", args1: [{ type: "input_statement", name: "THEN" }], previousStatement: null, nextStatement: null, colour: 330 },
    { type: "rt_draft_if_else", message0: "IF %1", args0: [{ type: "field_label_serializable", name: "PREDICATE", text: "[set condition]" }], message1: "DO %1", args1: [{ type: "input_statement", name: "THEN" }], message2: "OTHERWISE %1", args2: [{ type: "input_statement", name: "ELSE" }], previousStatement: null, nextStatement: null, colour: 330 },
  ]);
}
