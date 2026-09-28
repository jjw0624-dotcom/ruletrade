import type { SemanticSelection } from "./semanticSelection";
import { semanticSelection } from "./semanticSelection";
import type {
  LogicContext,
  LogicScript,
  LogicStatement,
  SemanticCompositionProjection,
  SemanticFact,
  SemanticProjectionRef,
} from "../semanticCompositionApi";

export interface ProgramModifier {
  kind: "eligibility" | "fallback" | "constraint";
  label: string;
  selection: SemanticSelection;
  ref: SemanticProjectionRef;
  value?: number;
}

export interface ProgramStatement {
  id: string;
  kind: "selection" | "allocation" | "action" | "control";
  label: string;
  selection: SemanticSelection;
  ref: SemanticProjectionRef;
  modifiers: ProgramModifier[];
  thenStatements: ProgramStatement[];
  elseStatements: ProgramStatement[];
  count?: number;
}

export interface ProgramScript {
  id: string;
  contextId: string;
  triggerLabel: string;
  triggerSelection: SemanticSelection;
  statements: ProgramStatement[];
}

export interface ProgramContext {
  id: string;
  kind: LogicContext["kind"];
  label: string;
  selection: SemanticSelection;
  scripts: ProgramScript[];
}

export interface BlockyProgram {
  contexts: ProgramContext[];
}

function roleFor(ref: SemanticProjectionRef): SemanticSelection["role"] {
  if (ref.semantic_role === "portfolio") return "group";
  if (ref.semantic_role === "timing") return "schedule";
  if (ref.semantic_role === "selection") return "selection";
  if (ref.semantic_role === "eligibility") return "qualification";
  if (ref.semantic_role === "constraint") return "cooldown";
  return "rule";
}

export function selectionForRef(ref: SemanticProjectionRef, groupId: string | null = null): SemanticSelection {
  return semanticSelection(roleFor(ref), ref.primary_component_id, {
    fieldPath: ref.field_path,
    groupId,
  });
}

function number(detail: Record<string, unknown>, key: string): number | undefined {
  const value = detail[key];
  return typeof value === "number" ? value : typeof value === "string" && value !== "" ? Number(value) : undefined;
}

function modifier(
  fact: SemanticFact,
  kind: ProgramModifier["kind"],
  groupId: string,
): ProgramModifier {
  const role = kind === "fallback" ? "fallback" : kind === "constraint" ? "cooldown" : "qualification";
  return {
    kind,
    label: fact.label,
    selection: semanticSelection(role, fact.ref.primary_component_id, {
      fieldPath: fact.ref.field_path,
      groupId,
    }),
    ref: fact.ref,
    value: kind === "eligibility"
      ? number(fact.detail, "threshold")
      : kind === "constraint" ? number(fact.detail, "duration") : undefined,
  };
}

function statement(
  source: LogicStatement,
  facts: Map<string, SemanticFact>,
  groupId: string,
): ProgramStatement {
  const related = [...source.fact_ids, ...source.modifier_fact_ids]
    .map((id) => facts.get(id))
    .filter((fact): fact is SemanticFact => Boolean(fact));
  const modifiers: ProgramModifier[] = [];
  for (const fact of related) {
    if (fact.category === "eligibility") modifiers.push(modifier(fact, "eligibility", groupId));
    else if (fact.kind === "selection_fallback") modifiers.push(modifier(fact, "fallback", groupId));
    else if (fact.category === "constraint") modifiers.push(modifier(fact, "constraint", groupId));
  }
  const primaryFact = facts.get(source.fact_ids[0]);
  return {
    id: source.id,
    kind: source.family === "portfolio_operation" ? "allocation" : source.family,
    label: source.label,
    selection: selectionForRef(source.ref, groupId),
    ref: source.ref,
    modifiers,
    thenStatements: [],
    elseStatements: [],
    count: primaryFact ? number(primaryFact.detail, "count") : undefined,
  };
}

function script(
  source: LogicScript,
  facts: Map<string, SemanticFact>,
): ProgramScript {
  const timing = facts.get(source.trigger.timing_fact_id);
  const statements = source.statements.map((item) => statement(item, facts, source.context_id));
  const statementsById = new Map(statements.map((item) => [item.id, item]));
  const nestedIds = new Set(source.statements.flatMap((item) => [...item.then_statement_ids, ...item.else_statement_ids]));
  source.statements.forEach((item, index) => {
    statements[index].thenStatements = item.then_statement_ids.map((id) => statementsById.get(id)).filter((value): value is ProgramStatement => Boolean(value));
    statements[index].elseStatements = item.else_statement_ids.map((id) => statementsById.get(id)).filter((value): value is ProgramStatement => Boolean(value));
  });
  return {
    id: source.id,
    contextId: source.context_id,
    triggerLabel: timing?.label ?? "Scheduled",
    triggerSelection: selectionForRef(source.trigger.ref),
    statements: statements.filter((item) => !nestedIds.has(item.id)),
  };
}

export function projectBlockyProgram(projection: SemanticCompositionProjection): BlockyProgram {
  const facts = new Map(projection.facts.map((fact) => [fact.id, fact]));
  const scripts = new Map(projection.logic.scripts.map((item) => [item.id, script(item, facts)]));
  return {
    contexts: projection.logic.contexts.map((context) => ({
      id: context.id,
      kind: context.kind,
      label: context.label,
      selection: selectionForRef(context.ref, context.id),
      scripts: context.script_ids.map((id) => scripts.get(id)).filter((item): item is ProgramScript => Boolean(item)),
    })),
  };
}

export function programStatementForSelection(
  program: BlockyProgram,
  selection: SemanticSelection | null,
): ProgramStatement | null {
  if (!selection?.componentId) return null;
  for (const statement of program.contexts.flatMap((context) => context.scripts.flatMap((item) => item.statements))) {
    if (statement.selection.componentId === selection.componentId
      || statement.ref.related_component_ids.includes(selection.componentId)
      || statement.modifiers.some((item) => item.selection.componentId === selection.componentId)) return statement;
  }
  return null;
}
