// P28-01: a week whose posts were written by a run that stopped before marking
// the plan ready is finished by the next run with no evidence (and so no copy
// rules stamp). replan.ts then reads the fresh plan as written before the copy
// rules, and the lifecycle's calendar_recheck asks for its outside-cited posts
// to be written again.
import { afterAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ anthropic: vi.fn(), owned: vi.fn() }));
vi.mock("../../../functions/_shared/anthropic.ts", () => ({ anthropicMessages: m.anthropic }));
vi.mock("../../../functions/_shared/competitive/ownedSource.ts", () => ({ collectOwnedCompetitive: m.owned }));
vi.mock("../../../functions/_shared/voice/load.ts", async (original) => ({
  ...(await original<typeof import("../../../functions/_shared/voice/load.ts")>()),
  loadClientVoice: async () => ({ brand: "Pay The Pyper", preferences: [], social: null, briefTone: null }),
}));

import { runWeekPlan, type WeekJob } from "../../../functions/_shared/calendar/runWeek";
import { replanWhy } from "../../../functions/_shared/calendar/replan";

vi.stubGlobal("Deno", { env: { get: (n: string) => (n === "ANTHROPIC_API_KEY" ? "test" : undefined) } });
afterAll(() => vi.unstubAllGlobals());

function fakeDb(tables: Record<string, unknown[]>) {
  const writes: Array<{ table: string; op: string; value: unknown }> = [];
  return {
    writes,
    rpc: async () => ({ data: false, error: null }),
    from(table: string) {
      let rows = tables[table] ?? [];
      // deno-lint-ignore no-explicit-any
      const q: any = {};
      for (const n of ["select", "neq", "in", "gte", "lte", "lt", "order", "limit", "not", "or", "range"]) q[n] = () => q;
      q.eq = (c: string, v: unknown) => { rows = rows.filter((r) => !(c in (r as object)) || (r as Record<string, unknown>)[c] === v); return q; };
      q.is = (c: string, v: unknown) => { if (v === null) rows = rows.filter((r) => (r as Record<string, unknown>)[c] == null); return q; };
      for (const op of ["update", "insert", "upsert", "delete"]) q[op] = (value: unknown) => { writes.push({ table, op, value }); return q; };
      q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
      q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve({ data: rows, error: null, count: rows.length }).then(ok, bad);
      return q;
    },
  };
}

const NOW = new Date("2026-10-19T07:15:00Z");
const CLIENT = { id: "ptp", name: "Pay The Pyper", timezone: "America/New_York", primary_platforms: ["Instagram"], posting_rhythm: null, content_pillars: [], geo: "US", language: "en" };
const job: WeekJob = { id: "j", kind: "week_plan", client_id: "ptp", occurrence: "2026-10-26T00:00:00Z", attempts: 2, max_attempts: 3 };
// The run before wrote the week (posts checked under the current copy rules), then stopped before marking it ready.
const plan = { id: "plan-1", client_id: "ptp", week_start: "2026-10-26", status: "queued", requested_by: null, moments: { kept: [], dropped: [] }, evidence: null, revisions: [], ready_at: null, claimed_at: null };
const fromTrend = [{ type: "trend", label: "x", evidence: [{ id: "N1", kind: "trend", text: "x", theme: "Month-end", platform: "Instagram" }], test: false }];
const written = { id: "p1", post_key: "post:p1", plan_id: "plan-1", post_date: "2026-10-27", platform: "Instagram", copy: "Three habits for month-end.", reasons: fromTrend };

describe("P28-01 a plan finished from posts already written", () => {
  it("carries the copy rules it was written under, so it is not asked to be written again", async () => {
    const db = fakeDb({ calendar_plans: [plan], clients: [CLIENT], calendar_posts: [written] });
    const out = await runWeekPlan(db, job, NOW);
    expect(out).toMatchObject({ status: "done", result: { finished: true } });
    expect(m.anthropic).not.toHaveBeenCalled();
    const ready = db.writes.find((w) => w.table === "calendar_plans" && (w.value as { status?: string }).status === "ready")!.value as Record<string, unknown>;
    const after = { ...plan, ...ready };
    // Expected null (written under the current rules); actual "outside": the replan rewrites it.
    expect(replanWhy(written, after as never, { ownDroppedAt: null })).toBeNull();
  });
});
