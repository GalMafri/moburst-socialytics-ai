// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  checkClientLandscape,
  CLIENT_NOT_TRACKED,
  isAppCreatedLandscape,
  isTrackingProblem,
  LANDSCAPE_MISSING,
  recordTrackingCheck,
  trackingCheckRecord,
  resolveClientLandscape,
  RIVALIQ_BUSY,
  RIVALIQ_UNAVAILABLE,
} from "../../../supabase/functions/_shared/competitive/landscapeCheck";

const client = { name: "Fixture", website_url: "https://fixture.agency" };
const own = { id: 10, name: "Socialytics - Fixture - set-1", focusCompanyId: 1, companies: [{ id: 1, name: "Fixture", url: "https://fixture.agency" }, { id: 2, name: "Rival", url: "https://rival.studio" }] };
const shared = { id: 11, name: "TIER 2 FIRMS", focusCompanyId: 1, companies: [{ id: 1, name: "Fixture", url: "https://fixture.agency" }, { id: 3, name: "Other", url: "https://other.studio" }] };
const someoneElse = { id: 12, name: "Another client", focusCompanyId: 5, companies: [{ id: 5, name: "Another", url: "https://another.com" }] };

describe("resolveClientLandscape", () => {
  it("uses the linked landscape when it still tracks the client", () => {
    const r = resolveClientLandscape([shared, own], client, "10");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.summary.id).toBe("10");
      expect(r.summary.client_company_id).toBe("1");
      expect(r.landscape).toBe(own);
      expect(r.linked).toBe(true);
    }
  });

  it("falls back to the best match only when nothing is linked", () => {
    const r = resolveClientLandscape([someoneElse, shared], client, null);
    expect(r.ok && r.summary.id).toBe("11");
    expect(r.ok && r.linked).toBe(false);
  });

  it("says not tracked when nothing is linked and nothing matches", () => {
    const r = resolveClientLandscape([someoneElse], client, "  ");
    expect(r).toMatchObject({ ok: false, code: CLIENT_NOT_TRACKED, landscapeId: null });
  });

  it("says missing, never not tracked, when the linked landscape is gone", () => {
    const r = resolveClientLandscape([shared], client, 99);
    expect(r).toMatchObject({ ok: false, code: LANDSCAPE_MISSING, landscapeId: "99", message: expect.stringMatching(/no longer exists/) });
  });

  it("says missing when the linked landscape no longer tracks the client, even if another one does", () => {
    const r = resolveClientLandscape([someoneElse, shared], client, "12");
    expect(r).toMatchObject({ ok: false, code: LANDSCAPE_MISSING, landscapeId: "12", message: expect.stringMatching(/no longer tracks Fixture/) });
  });

  it("treats a client tracked twice in the linked landscape as missing", () => {
    const doubled = { ...own, companies: [...own.companies, { id: 9, name: "Fixture LLC", url: "http://www.fixture.agency/" }] };
    expect(resolveClientLandscape([doubled], client, "10")).toMatchObject({ ok: false, code: LANDSCAPE_MISSING });
  });
});

describe("checkClientLandscape", () => {
  const respond = (body: unknown, status = 200) => vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));

  it("makes one read and resolves the client", async () => {
    const fetch = respond({ landscapes: [own] });
    const r = await checkClientLandscape("k&y", client, "10", fetch);
    expect(r.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch.mock.calls[0] as unknown[])[0]).toBe("https://api.rivaliq.com/v3/landscapes?apiKey=k%26y");
  });

  it("reports a busy provider separately from a tracking problem", async () => {
    const r = await checkClientLandscape("key", client, "10", respond("HourRateLimitExceeded", 429));
    expect(r).toMatchObject({ ok: false, code: RIVALIQ_BUSY, status: 429 });
    expect(isTrackingProblem(r)).toBe(false);
  });

  it("reports a provider error, an unreadable answer and a network failure as unavailable", async () => {
    expect(await checkClientLandscape("key", client, null, respond("{}", 502))).toMatchObject({ ok: false, code: RIVALIQ_UNAVAILABLE, status: 502 });
    expect(await checkClientLandscape("key", client, null, respond("not json"))).toMatchObject({ ok: false, code: RIVALIQ_UNAVAILABLE });
    const down = vi.fn(async () => { throw new TypeError("network down"); });
    const r = await checkClientLandscape("key", client, null, down);
    expect(r).toMatchObject({ ok: false, code: RIVALIQ_UNAVAILABLE, status: null });
  });

  it("never puts the key in a message", async () => {
    for (const fetch of [respond("{}", 500), respond("HourRateLimitExceeded", 429), respond({ landscapes: [] })]) {
      const r = await checkClientLandscape("secret-key", client, "10", fetch);
      expect(JSON.stringify(r)).not.toContain("secret-key");
    }
  });

  it("flags not tracked and missing as tracking problems", async () => {
    expect(isTrackingProblem(await checkClientLandscape("key", client, null, respond({ landscapes: [] })))).toBe(true);
    expect(isTrackingProblem(await checkClientLandscape("key", client, "10", respond({ landscapes: [] })))).toBe(true);
  });
});

describe("isAppCreatedLandscape", () => {
  const job = { landscape_id: "10", plan: { name: "Socialytics - Fixture - set-1" } };

  it("accepts only a landscape a setup job recorded under its own name", () => {
    expect(isAppCreatedLandscape(own, [job])).toBe(true);
    expect(isAppCreatedLandscape(own, [{ ...job, landscape_id: 10 as unknown as string }])).toBe(true);
  });

  it("never treats a shared strategy-team landscape as the app's", () => {
    // A setup that reused an existing landscape records its id, but the name is the team's.
    expect(isAppCreatedLandscape(shared, [{ landscape_id: "11", plan: { name: "Socialytics - Fixture - set-2" } }])).toBe(false);
  });

  it("needs both the record and the name", () => {
    expect(isAppCreatedLandscape(own, [])).toBe(false);
    expect(isAppCreatedLandscape({ ...own, name: "Socialytics - Fixture - renamed" }, [job])).toBe(false);
    expect(isAppCreatedLandscape(own, [{ ...job, landscape_id: "77" }])).toBe(false);
    expect(isAppCreatedLandscape(own, [{ landscape_id: null, plan: job.plan }])).toBe(false);
  });
});

describe("tracking check record", () => {
  const now = new Date("2026-10-14T08:00:00Z");

  it("keeps what the check found, for the set it was made for", () => {
    expect(trackingCheckRecord(resolveClientLandscape([own], client, "10"), "10", now)).toEqual({ code: "ok", landscape_id: "10", message: null, checked_at: now.toISOString() });
    const missing = trackingCheckRecord(resolveClientLandscape([], client, 99), 99, now);
    expect(missing).toMatchObject({ code: LANDSCAPE_MISSING, landscape_id: "99" });
    expect(missing?.message).toMatch(/no longer exists/);
    expect(trackingCheckRecord(resolveClientLandscape([], client, null), null, now)).toMatchObject({ code: CLIENT_NOT_TRACKED, landscape_id: null });
  });

  it("records nothing when RivalIQ could not be asked", () => {
    expect(trackingCheckRecord({ ok: false, code: RIVALIQ_BUSY, status: 429, message: "busy" }, "10", now)).toBeNull();
    expect(trackingCheckRecord({ ok: false, code: RIVALIQ_UNAVAILABLE, status: null, message: "down" }, "10", now)).toBeNull();
  });

  it("writes to the set, and never lets a failed write stop the caller", async () => {
    const writes: Array<{ table: string; patch: any; id: string }> = [];
    const db = { from: (table: string) => ({ update: (patch: any) => ({ eq: async (_k: string, id: string) => { writes.push({ table, patch, id }); return { error: null }; } }) }) };
    await recordTrackingCheck(db, "set-1", "10", resolveClientLandscape([own], client, "10"));
    expect(writes).toEqual([{ table: "competitor_sets", id: "set-1", patch: { tracking_check: expect.objectContaining({ code: "ok", landscape_id: "10" }) } }]);
    const missingColumn = { from: () => ({ update: () => ({ eq: async () => ({ error: { message: 'column "tracking_check" does not exist' } }) }) }) };
    const thrown = { from: () => { throw new Error("db down"); } };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(recordTrackingCheck(missingColumn, "set-1", "10", resolveClientLandscape([own], client, "10"))).resolves.toBeUndefined();
    await expect(recordTrackingCheck(thrown, "set-1", "10", resolveClientLandscape([own], client, "10"))).resolves.toBeUndefined();
    warn.mockRestore();
    // No set, nothing to record.
    await recordTrackingCheck(db, null, null, resolveClientLandscape([], client, null));
    expect(writes).toHaveLength(1);
  });
});
