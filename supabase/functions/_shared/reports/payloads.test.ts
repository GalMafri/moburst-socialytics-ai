import { describe, it, expect } from "vitest";
import { buildSocialPayload } from "./payloads";

/** A database whose every read answers with no rows. */
const emptyDb = {
  from() {
    const q: unknown = new Proxy({}, { get: (_t, op) => (op === "then" ? (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }) : () => q) });
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
});
