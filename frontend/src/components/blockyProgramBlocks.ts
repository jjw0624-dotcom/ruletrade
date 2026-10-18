import * as Blockly from "blockly";
import { ENTRY_BLOCK_CATEGORIES, ENTRY_BLOCK_DEFINITIONS, type EntryBlockCategory, type EntryBlockDefinition, type EntryValueType } from "../domain/entryStyleGrammar";

let registered = false;

const BUILTIN_TYPES: Record<string, string> = {
  "if-otherwise": "controls_if", "repeat-n": "controls_repeat_ext", "repeat-while": "controls_whileUntil", "stop-repeat": "controls_flow_statements",
  "compare-gt": "logic_compare", "compare-lt": "logic_compare", "compare-eq": "logic_compare", "logic-and": "logic_operation", "logic-or": "logic_operation", "logic-not": "logic_negate",
  number: "math_number", "calculate-add": "math_arithmetic", "calculate-subtract": "math_arithmetic", "calculate-multiply": "math_arithmetic", "calculate-divide": "math_arithmetic", "calculate-power": "math_arithmetic",
  "read-variable": "variables_get", "set-variable": "variables_set", "create-function": "procedures_defreturn", "call-function": "procedures_callreturn",
};

export const entryBlocklyType = (definitionId: string) => BUILTIN_TYPES[definitionId] ?? `rt_entry_${definitionId.replace(/[^a-z0-9]+/gi, "_")}`;

export function entryBlocklyFields(definitionId: string): Record<string, string | number> | undefined {
  const fields: Record<string, Record<string, string | number>> = {
    "compare-gt": { OP: "GT" }, "compare-lt": { OP: "LT" }, "compare-eq": { OP: "EQ" },
    "logic-and": { OP: "AND" }, "logic-or": { OP: "OR" },
    "calculate-add": { OP: "ADD" }, "calculate-subtract": { OP: "MINUS" }, "calculate-multiply": { OP: "MULTIPLY" }, "calculate-divide": { OP: "DIVIDE" }, "calculate-power": { OP: "POWER" },
    "repeat-while": { MODE: "WHILE" }, "stop-repeat": { FLOW: "BREAK" }, number: { NUM: 0 },
  };
  return fields[definitionId];
}

export function entryBlocklyExtraState(definitionId: string): Record<string, unknown> | undefined {
  if (definitionId === "if-otherwise") return { elseIfCount: 0, hasElse: true };
  return undefined;
}

export function entryDefinitionIdForBlock(block: Pick<Blockly.Block, "type" | "getFieldValue">): string | null {
  const matches = Object.entries(BUILTIN_TYPES).filter(([, type]) => type === block.type).map(([id]) => id);
  if (matches.length === 1) return matches[0]!;
  const field = String(block.getFieldValue("OP") ?? "");
  if (block.type === "logic_compare") return ({ GT: "compare-gt", LT: "compare-lt", EQ: "compare-eq" } as Record<string, string>)[field] ?? "compare-eq";
  if (block.type === "logic_operation") return field === "OR" ? "logic-or" : "logic-and";
  if (block.type === "math_arithmetic") return ({ ADD: "calculate-add", MINUS: "calculate-subtract", MULTIPLY: "calculate-multiply", DIVIDE: "calculate-divide", POWER: "calculate-power" } as Record<string, string>)[field] ?? "calculate-add";
  return ENTRY_BLOCK_DEFINITIONS.find((item) => entryBlocklyType(item.id) === block.type)?.id ?? null;
}

export interface EntryToolboxObject { id: string; name: string; kind: "group" | "subgroup" | "variable" | "function" | "signal" }

/** Blockly owns rendering and drag/drop for this category toolbox and its flyouts. */
export function entryBlocklyToolbox(objects: EntryToolboxObject[] = []): Blockly.utils.toolbox.ToolboxDefinition {
  const categoryContents = (category: EntryBlockCategory): Array<Record<string, unknown>> => {
    const entries: Array<Record<string, unknown>> = [];
    if (category === "Assets") entries.push({ kind: "button", text: "Create Group…", callbackKey: "RULETRADE_CREATE_GROUP" });
    for (const definition of ENTRY_BLOCK_DEFINITIONS.filter((item) => item.category === category && item.id !== "create-group" && item.id !== "create-variable")) {
      const objectKind = definition.id === "group-reference" ? "group" : definition.id === "subgroup-reference" ? "subgroup" : definition.id === "signal-reference" ? "signal" : definition.id === "call-function" ? "function" : null;
      const references = objectKind ? objects.filter((item) => item.kind === objectKind) : [];
      if (objectKind && references.length === 0) continue;
      const variants = references.length ? references : [null];
      for (const reference of variants) entries.push({
        kind: "block", type: entryBlocklyType(definition.id),
        fields: reference ? { REFERENCE: reference.name } : entryBlocklyFields(definition.id),
        extraState: entryBlocklyExtraState(definition.id),
        data: JSON.stringify({ definitionId: definition.id, objectRef: reference?.id ?? null }),
      });
    }
    if (category === "Data") entries.push(
      { kind: "block", type: "lists_create_with" }, { kind: "block", type: "lists_getIndex" },
      { kind: "button", text: "Create variable…", callbackKey: "CREATE_VARIABLE" },
    );
    return entries;
  };
  return { kind: "categoryToolbox", contents: ENTRY_BLOCK_CATEGORIES.map((category) => ({ kind: "category", name: category, contents: categoryContents(category) })) } as unknown as Blockly.utils.toolbox.ToolboxDefinition;
}

const checkNames = (type: EntryValueType): string[] => {
  if (type === "Truth") return ["RuleTradeTruth", "RuleTradeCondition", "Boolean"];
  if (type === "Number") return ["RuleTradeNumber", "Number"];
  if (type === "Value") return ["RuleTradeValue", "RuleTradeNumber", "RuleTradePercentage", "RuleTradeMoney", "RuleTradeQuantity", "Number"];
  return [`RuleTrade${type}`];
};

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
    json[`args${index + 1}`] = [{ type: "input_value", name: slot.name, check: [...new Set(slot.accepts.flatMap(checkNames))] }];
  });
  if (definition.id === "if-otherwise") {
    json.message2 = "DO %1"; json.args2 = [{ type: "input_statement", name: "THEN", check: "RuleTradeStatement" }];
    json.message3 = "OTHERWISE %1"; json.args3 = [{ type: "input_statement", name: "ELSE", check: "RuleTradeStatement" }];
  } else if (["repeat-n", "repeat-while"].includes(definition.id)) {
    const index = definition.slots.length + 1;
    json[`message${index}`] = "DO %1"; json[`args${index}`] = [{ type: "input_statement", name: "DO", check: "RuleTradeStatement" }];
  }
  if (definition.shape === "value") json.output = checkNames(definition.output ?? "Value");
  else {
    if (definition.shape === "statement") json.previousStatement = "RuleTradeStatement";
    if (definition.shape === "hat") json.hat = "cap";
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
    ...ENTRY_BLOCK_DEFINITIONS.filter((definition) => !BUILTIN_TYPES[definition.id]).map(entryBlockJson),
  ]);
}
