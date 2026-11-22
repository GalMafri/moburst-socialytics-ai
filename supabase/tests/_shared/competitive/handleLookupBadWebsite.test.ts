// @vitest-environment node
// QA 22 Nov 2026 (P30): a competitor whose website has a typo (a space) leaves its profile
// lookup "running" for good, and the next competitor is never looked up.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";
import { detectCompetitorHandles } from "../../../functions/_shared/competitive/detectHandles";

afterEach(() => vi.unstubAllGlobals());

describe("P30 detectCompetitorHandles with a malformed website", () => {
  it("ends every competitor's lookup with a final status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
    const db = fakeDb({
      competitors: [{ id: "c1", client_id: "cl", name: "Acme", website_url: "acme .com" }, { id: "c2", client_id: "cl", name: "Beta", website_url: "beta.com" }],
      competitor_handles: [],
    });
    await detectCompetitorHandles(db, [
      { id: "c1", client_id: "cl", name: "Acme", website_url: "acme .com" },
      { id: "c2", client_id: "cl", name: "Beta", website_url: "beta.com" },
    ]).catch(() => undefined);
    const statuses = db.tables.competitors.map((c) => c.profile_detection?.status ?? null);
    expect(statuses).not.toContain("running");
    expect(statuses[1]).not.toBeNull();
    expect(db.tables.competitors[0].profile_detection).toMatchObject({ status: "failed", detail: "The website address on file is not a valid web address." });
  });
});
