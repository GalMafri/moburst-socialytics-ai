// The content brief reads "the latest competitive report" by the same rule as
// every screen: the newest one that passed its checks, behind a newer held one.
import { describe, expect, it } from "vitest";
import { competitiveBrief } from "../../../functions/_shared/competitive/brief";

const ready = { period: { start: "2026-09-01", end: "2026-09-30" }, aggregates: { companies: [{ name: "A", is_client: true, post_count: 3 }] }, ai_analysis: { executive_summary: "A posts steadily." } };
const held = { provider_status: 2, aggregates: { companies: [{ name: "A", is_client: true, post_count: 3 }] }, ai_analysis: { executive_summary: "Held summary." } };

/** A supabase-js stand-in: every table answers with its rows, ordered and limited as asked. */
function fakeDb(tables: Record<string, unknown[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: (n: number) => { rows = rows.slice(0, n); return q; },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return q;
    },
  };
}

describe("competitiveBrief", () => {
  it("is not empty when the newest complete report is held and an older one is ready", async () => {
    const db = fakeDb({
      competitive_reports: [
        { id: "new", created_at: "2026-10-09T07:00:00Z", report_data: held },
        { id: "old", created_at: "2026-10-02T07:00:00Z", report_data: ready },
      ],
    });
    const brief = await competitiveBrief(db, "client");
    expect(brief).toContain("analysis from 2026-10-02");
    expect(brief).toContain("A posts steadily.");
    expect(brief).not.toContain("Held summary.");
  });

  it("is empty when no complete report is ready", async () => {
    const db = fakeDb({ competitive_reports: [{ id: "new", created_at: "2026-10-09T07:00:00Z", report_data: held }] });
    expect(await competitiveBrief(db, "client")).toBe("");
  });
});
