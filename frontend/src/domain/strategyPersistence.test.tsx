import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sleevesBootstrap } from "../test/fixture";
import { sameCanonicalSnapshot, strategyApi } from "../strategyApi";
import { StrategiesView } from "../views/StrategiesView";
import { createEditorState, editorReducer } from "../store/editorStore";

const record = { id: "s1", name: "Growth + Defensive", created_at: "2026-09-09T10:00:00Z", updated_at: "2026-09-09T11:00:00Z", current_revision_id: "r1", archived_at: null };

function jsonResponse(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }

describe("Strategy and immutable Revision frontend", () => {
  it("renders a backend Strategy list", () => {
    const markup = renderToStaticMarkup(<StrategiesView status="loaded" strategies={[record]} error={null} onExplore={() => undefined} onOpen={() => undefined} onRetry={() => undefined} />);
    expect(markup).toContain("Growth + Defensive");
    expect(markup).toContain("Updated");
  });

  it("creates from the complete backend bootstrap Canonical source", async () => {
    let request: RequestInit | undefined;
    const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => { request = init; return jsonResponse({ strategy: record, current_revision: { id: "r1" } }, 201); }) as typeof fetch;
    await strategyApi.create("My strategy", sleevesBootstrap.strategy, fetcher);
    expect(JSON.parse(String(request?.body))).toEqual({ name: "My strategy", canonical_strategy: sleevesBootstrap.strategy });
  });

  it("saves with the persisted parent and accepts identical-source no-op", async () => {
    let request: RequestInit | undefined;
    const response = { created: false, strategy: record, revision: { id: "r1", strategy_id: "s1", parent_revision_id: null, canonical_strategy: sleevesBootstrap.strategy, source_hash: "hash", schema_version: "ruletrade.dev/strategy/v1", created_at: record.created_at } };
    const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => { request = init; return jsonResponse(response); }) as typeof fetch;
    expect((await strategyApi.save("s1", "r1", sleevesBootstrap.strategy, fetcher)).created).toBe(false);
    expect(JSON.parse(String(request?.body))).toEqual({ expected_parent_revision_id: "r1", canonical_strategy: sleevesBootstrap.strategy });
  });

  it("detects only Canonical working-copy changes as dirty", () => {
    const original = sleevesBootstrap.strategy;
    const moved = editorReducer(createEditorState(sleevesBootstrap), { type: "move_node", componentId: "top_n", position: { x: 10, y: 20 } });
    expect(sameCanonicalSnapshot(original, moved.canonical)).toBe(true);
    const edited = editorReducer(moved, { type: "apply_semantic_patch", operation: { kind: "update_component_config", componentId: "top_n", field: "count", value: 3 } });
    expect(sameCanonicalSnapshot(original, edited.canonical)).toBe(false);
  });

  it("preserves the structured stale-revision conflict", async () => {
    const fetcher = (async () => jsonResponse({ detail: { code: "stale_revision", message: "advanced", current_revision_id: "r2" } }, 409)) as typeof fetch;
    await expect(strategyApi.save("s1", "r1", sleevesBootstrap.strategy, fetcher)).rejects.toMatchObject({ status: 409, detail: { code: "stale_revision", current_revision_id: "r2" } });
  });

  it("renames metadata and archives through the exact resource endpoints", async () => {
    const calls: Array<[string, string | undefined]> = [];
    const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => { calls.push([String(url), init?.method]); return init?.method === "DELETE" ? new Response(null, { status: 204 }) : jsonResponse({ strategy: { ...record, name: "Renamed" }, current_revision: { id: "r1" } }); }) as typeof fetch;
    await strategyApi.rename("s1", "Renamed", fetcher); await strategyApi.archive("s1", fetcher);
    expect(calls).toEqual([["/api/v1/strategies/s1", "PATCH"], ["/api/v1/strategies/s1", "DELETE"]]);
  });
});
