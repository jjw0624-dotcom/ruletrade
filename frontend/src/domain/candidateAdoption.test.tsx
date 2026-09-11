import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { candidateApi } from "../candidateApi";
import { AdoptionAction } from "../components/AdoptionAction";
import {
  adoptionDestination,
  adoptionErrorMessage,
  canSubmitAdoption,
} from "./candidateAdoption";
import type { SaveRevisionResponse } from "../strategyApi";

const adopted = (created: boolean): SaveRevisionResponse => ({
  created,
  strategy: { id: "strategy-1", name: "Momentum", current_revision_id: "revision-2", created_at: "", updated_at: "", archived_at: null },
  revision: { id: "revision-2", strategy_id: "strategy-1", parent_revision_id: "revision-1", canonical_strategy: {} as SaveRevisionResponse["revision"]["canonical_strategy"], source_hash: "hash", schema_version: "1", created_at: "" },
});

describe("Candidate adoption", () => {
  it("posts the exact adopt request without Canonical data or a Run request", async () => {
    let url = ""; let body: unknown; let method = "";
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input); method = String(init?.method); body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(adopted(true)), { status: 200 });
    }) as typeof fetch;
    await candidateApi.adopt("candidate / 1", "revision-1", fetcher);
    expect(url).toBe("/api/v1/candidates/candidate%20%2F%201/adopt");
    expect(method).toBe("POST");
    expect(body).toEqual({ expected_current_revision_id: "revision-1" });
    expect(JSON.stringify(body)).not.toContain("canonical_strategy");
    expect(url).not.toContain("backtest");
  });

  it.each([true, false])("treats created=%s as successful navigation to the updated Strategy", (created) => {
    expect(adoptionDestination(adopted(created))).toEqual({ strategyId: "strategy-1", revisionId: "revision-2" });
  });

  it("prevents duplicate Keep submissions while confirmation or a request is active", () => {
    expect(canSubmitAdoption("confirming")).toBe(true);
    expect(canSubmitAdoption("keeping")).toBe(false);
    expect(canSubmitAdoption("success")).toBe(false);
  });

  it("keeps stale and lineage conflicts safe and actionable", () => {
    expect(adoptionErrorMessage("stale_revision")).toMatchObject({ kind: "conflict", actionLabel: "Open latest strategy" });
    expect(adoptionErrorMessage("candidate_adoption_lineage_mismatch")).toMatchObject({ kind: "conflict", actionLabel: "Open latest strategy" });
    expect(adoptionErrorMessage("strategy_archived").title).toContain("archived");
    expect(adoptionErrorMessage("not_found").title).toContain("could not be found");
    expect(adoptionErrorMessage("persistence_failure").message).toContain("Nothing changed");
  });

  it("renders Return to original and Keep without deletion or backend terminology", () => {
    const markup = renderToStaticMarkup(<AdoptionAction candidateId="candidate-1" expectedCurrentRevisionId="revision-1" onReturn={() => undefined} onAdopted={() => undefined} />);
    expect(markup).toContain("Return to original");
    expect(markup).toContain("Keep change");
    expect(markup).toContain("tested change");
    expect(markup).not.toMatch(/delete|merge|parent Revision|immutable Candidate/i);
  });

  it("preserves structured current revision details from adoption conflicts", async () => {
    const fetcher = (async () => new Response(JSON.stringify({ detail: { code: "stale_revision", message: "stale", current_revision_id: "revision-2" } }), { status: 409 })) as typeof fetch;
    await expect(candidateApi.adopt("candidate-1", "revision-1", fetcher)).rejects.toMatchObject({
      detail: { code: "stale_revision", current_revision_id: "revision-2" },
    });
  });
});
