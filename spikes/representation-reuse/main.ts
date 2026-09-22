import * as Blockly from "blockly";
import { projectConceptualFlow } from "../../frontend/src/domain/conceptualFlow";
import type { EditorBootstrap } from "../../frontend/src/domain/canonical";
import { authoringApi } from "../../frontend/src/structuralAuthoringApi";
import { addConditionIntent, removeConditionIntent, thresholdIntent, type LogicStep } from "./logic";
import { LogicSession } from "./session";
import { defineLogicBlocks } from "./blocks";
import "./style.css";

defineLogicBlocks();

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = element<HTMLElement>("status");
const workspace = Blockly.inject("blockly", { toolbox: { kind: "flyoutToolbox", contents: [] },
  trashcan: false, sounds: false, zoom: { controls: true, wheel: true, startScale: 1 } });
let session: LogicSession | null = null;
let lastError = "";

function report(message: string) { status.textContent = message; }
function redraw(focusComponentId?: string) {
  if (!session) return;
  // Blockly is a derived editor model. Suppress projection events and keep block IDs disposable.
  Blockly.Events.disable();
  try {
    workspace.clear();
    let prior: Blockly.BlockSvg | undefined;
    for (const step of session.steps) {
      const block = workspace.newBlock(`rt_${step.role}`) as Blockly.BlockSvg;
      block.data = step.componentId; // provenance is looked up here; block.id is never sent to backend.
      block.setMovable(false); block.setDeletable(false);
      if (step.role === "condition") {
        block.setFieldValue(String(Number(step.value) * 100), "threshold");
        block.getField("threshold")?.setValidator((input) => {
          const proposed = Number(input);
          if (session?.capabilities) {
            const intent = thresholdIntent(step, proposed, session.capabilities);
            if (intent) void commit(intent, step.componentId);
            else report("Unsupported threshold edit");
          }
          return null; // Pessimistic: editor never commits a value until backend returns Canonical.
        });
      } else block.setFieldValue(step.label, "value");
      block.initSvg(); block.render();
      if (prior?.nextConnection && block.previousConnection) prior.nextConnection.connect(block.previousConnection);
      else block.moveBy(40, 35);
      prior = block;
      if (step.componentId === focusComponentId) block.select();
    }
  } finally { Blockly.Events.enable(); }
  const add = session.capabilities && addConditionIntent(session.steps, session.capabilities);
  const condition = session.steps.find((step) => step.role === "condition");
  element<HTMLButtonElement>("add").disabled = !add;
  element<HTMLButtonElement>("remove").disabled = !condition || !session.capabilities || !removeConditionIntent(condition, session.capabilities);
  const flow = projectConceptualFlow(session.canonical, session.registry);
  element<HTMLElement>("debug").textContent = JSON.stringify({
    componentIds: session.steps.map((step) => [step.role, step.componentId, step.fieldPath]),
    flow: flow.groups[0]?.choose,
    canonical: session.canonical,
  }, null, 2);
}

async function commit(intent: Parameters<LogicSession["apply"]>[0], focusComponentId?: string) {
  if (!session) return;
  const current = session;
  report("Checking with backend…");
  try {
    const accepted = await current.apply(intent);
    if (session === current && accepted) {
      redraw(focusComponentId);
      report("Backend accepted; Blockly and Flow read models reprojected from Canonical.");
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    if (session === current) { redraw(focusComponentId); report(`Backend rejected; Strategy unchanged: ${lastError}`); }
  }
}

async function load() {
  const example = element<HTMLSelectElement>("example").value;
  report("Loading example…");
  try {
    const response = await fetch(`/api/v1/editor/bootstrap?example=${example}`);
    if (!response.ok) throw new Error(`Bootstrap failed (${response.status})`);
    const bootstrap = await response.json() as EditorBootstrap;
    const next = new LogicSession(bootstrap.strategy, bootstrap.registry, {
      capabilities: authoringApi.capabilities, apply: authoringApi.apply,
    });
    await next.refresh();
    session = next; redraw(); report(`Loaded ${example}; authoritative API is ready.`);
  } catch (error) { report(error instanceof Error ? error.message : String(error)); }
}

element<HTMLButtonElement>("reload").onclick = () => { void load(); };
element<HTMLButtonElement>("add").onclick = () => {
  const intent = session?.capabilities && addConditionIntent(session.steps, session.capabilities);
  if (intent?.kind === "add_qualification_condition") void commit(intent, intent.rank_component_id);
};
element<HTMLButtonElement>("remove").onclick = () => {
  const step: LogicStep | undefined = session?.steps.find((item) => item.role === "condition");
  const intent = step && session?.capabilities && removeConditionIntent(step, session.capabilities);
  if (intent) void commit(intent, step?.componentId);
};
void load();

// The standalone spike does not persist its working copy. Saving remains the production Revision boundary.
