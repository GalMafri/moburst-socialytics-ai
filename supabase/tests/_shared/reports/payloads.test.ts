// A monthly report always carries trends (Trends Task 12): the request sends
// no trend switch, and the in-app pipeline reads a request without one as a
// report with trends. Its own reading of skip_trends stays for the stored
// requests it is replayed against (supabase/fixtures/pipelines).
import { describe, it, expect } from "vitest";
import { buildSocialPayload } from "../../../functions/_shared/reports/payloads";
import { prepareTrendInputs } from "../../../functions/_shared/pipelines/social/nodes";

/** A database whose every read answers with no rows. */
const emptyDb = {
  from() {
    const q: unknown = new Proxy({}, { get: (_t, op) => (op === "then" ? (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }) : op === "maybeSingle" ? async () => ({ data: null, error: null }) : () => q) });
    return q;
  },
};

describe("buildSocialPayload", () => {
  it("sends no trend switch, and still sends the client's own keywords", async () => {
    const client = { id: "c1", name: "Fixture", sprout_customer_id: "123", social_keywords: ["a"], trends_keywords: "x,y", timezone: "UTC" };
    const payload = await buildSocialPayload({ supabase: emptyDb, client, reportId: "r1", range: { start: "2026-08-01", end: "2026-08-31" } });
    expect(payload).not.toHaveProperty("skip_trends");
    expect(payload).toMatchObject({ report_id: "r1", social_keywords: ["a"], trends_keywords: "x,y", date_range_start: "2026-08-01", date_range_end: "2026-08-31" });
  });

  it("is a request the in-app pipeline runs with trends", async () => {
    const client = { id: "c1", name: "Fixture", sprout_customer_id: "123", social_keywords: ["personal injury"], timezone: "UTC", geo: "US" };
    const payload = await buildSocialPayload({ supabase: emptyDb, client, reportId: "r1", range: { start: "2026-08-01", end: "2026-08-31" } });
    const trends = prepareTrendInputs({ ...payload, date_ranges: { current_month: { start: "2026-08-01", end: "2026-08-31" } } });
    expect(trends.trend_status).toMatchObject({ tiktok: "requested" });
  });
});
