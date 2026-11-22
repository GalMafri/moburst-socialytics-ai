// P28-02: runWeekRevise decides which posts were worked on (calendar_post_worked:
// touched, a copy revision, a design request, a Sprout schedule) BEFORE its model
// call, and its write is guarded only on copy, touched_at and plan_id. A person who
// presses Design (or schedules the post) while the call runs changes none of those
// columns, so the revision overwrites the copy the design or the schedule was made from.
import { afterAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ anthropic: vi.fn(), owned: vi.fn() }));
vi.mock("../../../functions/_shared/anthropic.ts", () => ({ anthropicMessages: m.anthropic }));
vi.mock("../../../functions/_shared/competitive/ownedSource.ts", () => ({ collectOwnedCompetitive: m.owned }));
vi.mock("../../../functions/_shared/voice/load.ts", async (original) => ({
  ...(await original<typeof import("../../../functions/_shared/voice/load.ts")>()),
  loadClientVoice: async () => ({ brand: "Pay The Pyper", preferences: [], social: null, briefTone: null }),
  learnFromSignal: async () => ({ ops: 0, changes: [] }),
}));

import { runWeekRevise, type WeekJob } from "../../../functions/_shared/calendar/runWeek";

vi.stubGlobal("Deno", { env: { get: (n: string) => (n === "ANTHROPIC_API_KEY" ? "test" : undefined) } });
afterAll(() => vi.unstubAllGlobals());

/** Rows per table; an update applies its eq/is filters as Postgres would, and is recorded with the rows it changed. */
function fakeDb(tables: Record<string, Array<Record<string, unknown>>>, worked: Set<string>) {
  const writes: Array<{ table: string; value: Record<string, unknown>; ids: unknown[] }> = [];
  return {
    writes,
    rpc: async (_n: string, args: { p_key?: string; p_touched?: string | null }) => ({ data: !!args.p_touched || worked.has(String(args.p_key)), error: null }),
    from(table: string) {
      let rows = tables[table] ?? [];
      let patch: Record<string, unknown> | null = null;
      // deno-lint-ignore no-explicit-any
      const q: any = {};
      for (const n of ["select", "neq", "in", "gte", "lte", "lt", "order", "limit", "not", "or", "range"]) q[n] = () => q;
      q.eq = (c: string, v: unknown) => { rows = rows.filter((r) => !(c in r) || r[c] === v); return q; };
      q.is = (c: string, v: unknown) => { if (v === null) rows = rows.filter((r) => r[c] == null); return q; };
      q.update = (value: Record<string, unknown>) => { patch = value; return q; };
      for (const op of ["insert", "upsert", "delete"]) q[op] = () => q;
      q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
      q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
        if (patch) { for (const r of rows) Object.assign(r, patch); writes.push({ table, value: patch, ids: rows.map((r) => r.id) }); }
        return Promise.resolve({ data: rows, error: null, count: rows.length }).then(ok, bad);
      };
      return q;
    },
  };
}

const NOW = new Date("2026-10-19T07:15:00Z");
const CLIENT = { id: "ptp", name: "Pay The Pyper", timezone: "America/New_York", primary_platforms: ["Instagram"], posting_rhythm: null, content_pillars: [], geo: "US", language: "en" };
const job: WeekJob = { id: "j", kind: "week_revise", client_id: "ptp", occurrence: "2026-10-26T00:00:00Z", attempts: 1, max_attempts: 3 };

describe("P28-02 a revision running while a person starts a design", () => {
  it("leaves the copy of a post someone started designing during the model call", async () => {
    const plan = { id: "plan-1", client_id: "ptp", week_start: "2026-10-26", status: "ready", revisions: [], claimed_at: null,
      pending_revision: { note: "Warmer, please", by: null, at: "2026-10-19T07:00:00Z", scope: "untouched" } };
    const post = { id: "p1", post_key: "post:p1", post_date: "2026-10-27", platform: "Instagram", format: "image", pillar: null, copy: "Old copy", hashtags: [], cta: null, visual_direction: null, reasons: [], touched_at: null, plan_id: "plan-1", story_of: null };
    const worked = new Set<string>();
    m.anthropic.mockImplementation(async () => {
      // Meanwhile a person presses Design on the post: a design_requests row now exists for it, the post row is unchanged.
      worked.add("post:p1");
      return { text: JSON.stringify({ posts: [{ id: "p1", copy: "Warmer new copy" }] }), raw: {} };
    });
    const db = fakeDb({ calendar_plans: [plan], clients: [CLIENT], calendar_posts: [post] }, worked);
    await runWeekRevise(db, job, NOW);
    // Expected: the post is worked on now, so its copy stays. Actual: overwritten.
    expect(post.copy).toBe("Old copy");
  });
});
