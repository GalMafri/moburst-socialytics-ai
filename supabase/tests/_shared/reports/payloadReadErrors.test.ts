// QA 22 Nov 2026 (P47-01): a failed read of the client's Sprout profiles (or competitors, or rejected
// suggestions) is dropped, and the run is sent as if the client had none.
import { describe, expect, it } from "vitest";
import { fakeDb } from "../../support/dbFake";
import { buildCompetitivePayload, buildSocialPayload } from "../../../functions/_shared/reports/payloads";

const failing = (table: string) => fakeDb((call) => (call.table === table ? { error: { message: "timeout" } } : { data: [] })).db;
const client = { id: "c1", name: "Acme", sprout_customer_id: "123", timezone: "UTC" };
const range = { start: "2026-10-01", end: "2026-10-31" };

describe("P47-01 payload reads that fail", () => {
  it("a social run whose profile read failed is not sent as a client with no Sprout profile", async () => {
    const sent = await buildSocialPayload({ supabase: failing("sprout_profiles"), client, reportId: "r1", range }).catch((e) => e);
    // Expected: the read error stops the build (as insights.ts and competitive ownProfiles do).
    expect(sent).toBeInstanceOf(Error);
  });
  it("a competitive run whose competitor read failed is not sent with no competitors", async () => {
    const sent = await buildCompetitivePayload({ supabase: failing("competitors"), client, reportId: "r2", attemptStartedAt: "2026-11-01T00:00:00Z", set: { id: "s1" }, range }).catch((e) => e);
    expect(sent).toBeInstanceOf(Error);
  });
  it("a competitive run whose rejected-suggestion read failed does not drop the rejections", async () => {
    const sent = await buildCompetitivePayload({ supabase: failing("competitive_insight_feedback"), client, reportId: "r3", attemptStartedAt: "2026-11-01T00:00:00Z", set: { id: "s1" }, range }).catch((e) => e);
    expect(sent).toBeInstanceOf(Error);
  });
});
