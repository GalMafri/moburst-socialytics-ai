// A monthly report always carries trends (Trends Task 12): the request sends
// no trend switch, and the in-app pipeline reads the stored trends for a
// request without one (Task 16). Its own reading of skip_trends stays for the
// stored requests it is replayed against (supabase/fixtures/pipelines).
import { describe, it, expect } from "vitest";
import { buildSocialPayload } from "../../../functions/_shared/reports/payloads";
import { readsTrends } from "../../../functions/_shared/pipelines/social/nodes";

/** A database whose every read answers with no rows. */
const emptyDb = {
  from() {
    const q: unknown = new Proxy({}, { get: (_t, op) => (op === "then" ? (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }) : op === "maybeSingle" ? async () => ({ data: null, error: null }) : () => q) });
    return q;
  },
};

describe("buildSocialPayload", () => {
  it("sends no trend switch, and still sends the client's own keywords", async () => {
    const client = { id: "c1", name: "Fixture", sprout_customer_id: "123", social_keywords: ["a"], timezone: "UTC" };
    const payload = await buildSocialPayload({ supabase: emptyDb, client, reportId: "r1", range: { start: "2026-08-01", end: "2026-08-31" } });
    expect(payload).not.toHaveProperty("skip_trends");
    expect(payload).toMatchObject({ report_id: "r1", social_keywords: ["a"], date_range_start: "2026-08-01", date_range_end: "2026-08-31" });
  });

  // Trends Task 18: clients.trends_keywords is dropped. n8n's social workflow, kept unpublished as a fallback until the
  // 7 Dec reports run clean, still reads the field, so the request carries it empty, from no column.
  it("sends trends_keywords empty, whatever a client row still holds", async () => {
    for (const client of [{ id: "c1", name: "Fixture", sprout_customer_id: "123" }, { id: "c1", name: "Fixture", sprout_customer_id: "123", trends_keywords: "x,y" }]) {
      const payload = await buildSocialPayload({ supabase: emptyDb, client, reportId: "r1", range: { start: "2026-08-01", end: "2026-08-31" } });
      expect(payload.trends_keywords).toBe("");
    }
  });

  it("is a request the in-app pipeline runs with the stored trends", async () => {
    const client = { id: "c1", name: "Fixture", sprout_customer_id: "123", social_keywords: ["personal injury"], timezone: "UTC", geo: "US" };
    const payload = await buildSocialPayload({ supabase: emptyDb, client, reportId: "r1", range: { start: "2026-08-01", end: "2026-08-31" } });
    expect(readsTrends(payload)).toBe(true);
    // A stored request from before Task 12 that asked for none reads none.
    expect(readsTrends({ ...payload, skip_trends: true })).toBe(false);
  });
});
