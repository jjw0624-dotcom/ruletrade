import { afterAll, beforeAll, expect, test } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanonicalStrategyV1, EditorBootstrap } from "../../frontend/src/domain/canonical";
import { projectConceptualFlow } from "../../frontend/src/domain/conceptualFlow";
import { addConditionIntent, projectLogic, removeConditionIntent, thresholdIntent } from "./logic";
import { LogicSession } from "./session";
import * as Blockly from "blockly";
import { defineLogicBlocks } from "./blocks";

const root = resolve(import.meta.dirname, "../..");
let server: ChildProcess, base: string;
let tempDirectory: string;

async function freePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const socket = createServer().listen(0, "127.0.0.1", () => {
      const address = socket.address(); socket.close();
      if (address && typeof address !== "string") resolvePort(address.port);
      else reject(new Error("No port"));
    });
  });
}

async function post(path: string, data: unknown): Promise<Response> {
  return await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
}

beforeAll(async () => {
  const port = await freePort(); base = `http://127.0.0.1:${port}`;
  tempDirectory = mkdtempSync(join(tmpdir(), "ruletrade-spike-"));
  server = spawn("uv", ["run", "uvicorn", "ruletrade.api:app", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: root, stdio: "ignore", env: { ...process.env, RULETRADE_DB_PATH: join(tempDirectory, "strategies.sqlite3") },
  });
  for (let attempt = 0; attempt < 150; attempt++) {
    if (server.exitCode !== null) throw new Error(`API exited: ${server.exitCode}`);
    try { if ((await fetch(base + "/openapi.json")).ok) return; } catch { /* startup */ }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("API did not start");
}, 30_000);
afterAll(() => { server?.kill(); if (tempDirectory) rmSync(tempDirectory, { recursive: true, force: true }); });

test("real authoring round trip: Blocky logic → backend → Canonical → Flow", async () => {
  const bootstrap = await (await fetch(base + "/v1/editor/bootstrap?example=momentum")).json() as EditorBootstrap;
  const port = {
    async capabilities(strategy: CanonicalStrategyV1) {
      const response = await post("/v1/canonical/strategies/authoring/capabilities", strategy);
      if (!response.ok) throw new Error(await response.text());
      return await response.json();
    },
    async apply(strategy: CanonicalStrategyV1, operation: unknown) {
      const response = await post("/v1/canonical/strategies/authoring/apply", { strategy, operation });
      if (!response.ok) throw new Error(await response.text());
      return (await response.json()).strategy as CanonicalStrategyV1;
    },
  };
  const session = new LogicSession(bootstrap.strategy, bootstrap.registry, port);
  await session.refresh();
  const initial = session.canonical;
  expect(session.steps.map((step) => step.role)).toEqual(["assets", "score", "rank", "choose"]);
  defineLogicBlocks();
  const workspace = new Blockly.Workspace();
  const blocks = session.steps.map((step) => {
    const block = workspace.newBlock(`rt_${step.role}`);
    block.data = step.componentId;
    return block;
  });
  for (let index = 1; index < blocks.length; index++) {
    blocks[index - 1].nextConnection!.connect(blocks[index].previousConnection!);
  }
  expect(blocks.map((block) => block.data)).toEqual(session.steps.map((step) => step.componentId));
  expect(workspace.getTopBlocks(false)).toHaveLength(1);
  workspace.dispose();
  const add = addConditionIntent(session.steps, session.capabilities!);
  expect(add?.kind).toBe("add_qualification_condition");
  expect(await session.apply(add!)).toBe(true);
  const condition = session.steps.find((step) => step.role === "condition")!;
  expect(condition.componentId).toBe("momentum_rank_qualification");
  expect(initial.graph.components.map((item) => item.id).every((id) => session.canonical.graph.components.some((item) => item.id === id))).toBe(true);
  expect(projectConceptualFlow(session.canonical, bootstrap.registry).groups[0].choose?.filterComponentId).toBe(condition.componentId);

  const update = thresholdIntent(condition, 5, session.capabilities!);
  expect(update).toEqual({ kind: "update_qualification_threshold", component_id: condition.componentId, threshold: "0.05" });
  expect(await session.apply(update!)).toBe(true);
  expect(session.steps.find((step) => step.role === "condition")?.value).toBe("0.05");
  expect(projectConceptualFlow(session.canonical, bootstrap.registry).groups[0].choose?.threshold).toBe("0.05");

  const accepted = session.canonical;
  const acceptedSteps = session.steps;
  await expect(session.apply({ kind: "update_qualification_threshold", component_id: condition.componentId, threshold: "bogus" })).rejects.toThrow();
  expect(session.canonical).toBe(accepted);
  expect(session.steps).toBe(acceptedSteps);
  expect(session.capabilities?.qualification_remove_targets).toContain(condition.componentId);

  const created = await post("/v1/strategies", { name: "Logic spike", canonical_strategy: initial });
  expect(created.status).toBe(201);
  const record = await created.json();
  const saved = await post(`/v1/strategies/${record.strategy.id}/revisions`, {
    expected_parent_revision_id: record.current_revision.id, canonical_strategy: session.canonical,
  });
  expect(saved.status).toBe(201);
  const reopened = await fetch(base + `/v1/strategies/${record.strategy.id}`);
  expect(reopened.ok).toBe(true);
  const reopenedPayload = await reopened.json();
  const persisted = reopenedPayload.current_revision.canonical_strategy as CanonicalStrategyV1;
  expect(projectLogic(persisted, bootstrap.registry).find((step) => step.role === "condition")?.value).toBe("0.05");

  // Reverse direction: a separate Flow/Inspector edit produces Canonical; a fresh logic read sees it.
  const external = await port.apply(session.canonical, {
    kind: "update_qualification_threshold", component_id: condition.componentId, threshold: "0.07",
  });
  expect(new LogicSession(external, bootstrap.registry, port).steps.find((step) => step.role === "condition")?.value).toBe("0.07");
  const remove = removeConditionIntent(session.steps.find((step) => step.role === "condition")!, session.capabilities!);
  expect(await session.apply(remove!)).toBe(true);
  expect(session.steps.find((step) => step.role === "condition")).toBeUndefined();
  expect(projectConceptualFlow(session.canonical, bootstrap.registry).groups[0].choose?.filterComponentId).toBeUndefined();
  expect(projectLogic(session.canonical, bootstrap.registry).map((step) => step.role)).toEqual(session.steps.map((step) => step.role));
}, 30_000);
