// P27-02: a week stopped before its moments were judged (week_moments ends "skipped": "A person stopped this week's plan")
// and then planned again with "Plan next week" never gets its seasonal moments: the planning job reads the skipped
// moments job as final and plans the week without moments, never asking for them again.
import { afterAll, describe, expect, it, vi } from "vitest";
import { runWeekMoments } from "../../../functions/_shared/calendar/runMoments";
import { runWeekPlan } from "../../../functions/_shared/calendar/runWeek";

vi.stubGlobal("Deno", { env: { get: (n: string) => (n === "ANTHROPIC_API_KEY" ? "test" : undefined) } });
afterAll(() => vi.unstubAllGlobals());

function fakeDb(tables: Record<string, unknown[]>) {
  const writes: Array<{ table: string; op: string; value: unknown }> = [];
  return { writes, from(table: string) {
    let rows = (tables[table] ?? []) as Array<Record<string, unknown>>;
    const q: any = {};
    for (const n of ["select", "neq", "gte", "lte", "lt", "order", "limit", "not", "or", "range", "contains"]) q[n] = () => q;
    q.eq = (c: string, v: unknown) => { rows = rows.filter((r) => !(c in r) || r[c] === v); return q; };
    q.in = (c: string, vs: unknown[]) => { rows = rows.filter((r) => !(c in r) || vs.includes(r[c])); return q; };
    q.is = () => q;
    for (const op of ["update", "insert", "upsert", "delete"]) q[op] = (value: unknown) => { writes.push({ table, op, value }); return q; };
    q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    q.then = (ok: any, fail?: any) => Promise.resolve({ data: rows, error: null, count: rows.length }).then(ok, fail);
    return q;
  } };
}

const WEEK = "2026-11-09";
const NOW = new Date("2026-11-04T09:00:00Z");
const CLIENT = { id: "c1", name: "Acme", timezone: "UTC", geo: "US", content_pillars: [] };
const job = (kind: string, over: Record<string, unknown> = {}) => ({ id: kind, kind, client_id: "c1", occurrence: `${WEEK}T00:00:00Z`, attempts: 1, max_attempts: 3, ...over }) as any;

describe("P27-02 a week planned again after Stop planning", () => {
  it("asks for the week's moments again instead of planning it without them", async () => {
    // Step 1 (P27 side): the moments job ran while the plan was stopped, and ended skipped without saving moments.
    const stopped = await runWeekMoments(fakeDb({ calendar_plans: [{ id: "p1", client_id: "c1", week_start: WEEK, status: "canceled" }] }), job("week_moments"), NOW);
    expect(stopped).toMatchObject({ status: "skipped" });

    // Step 2: "Plan next week" re-queued the canceled plan (calendar_request_week); its planning job runs.
    const db = fakeDb({
      calendar_plans: [{ id: "p1", client_id: "c1", week_start: WEEK, status: "queued", moments: null, claimed_at: null }],
      clients: [CLIENT],
      scheduled_jobs: [
        { kind: "week_moments", client_id: "c1", dedupe_key: `week_moments:c1:${WEEK}`, status: "skipped", finished_at: "2026-11-03T10:00:00Z" },
        // A trend collection in flight, only so the run stops right after the moments check and says what it waits for.
        { kind: "trend_refresh", client_id: "c1", status: "queued", created_at: "2026-11-04T08:59:00Z" },
      ],
    });
    const out = await runWeekPlan(db, job("week_plan", { created_at: "2026-11-04T08:58:00Z" }), NOW);
    // Expected: waits for the week's moments (re-queued). Actual: moves on to trends; the week is planned with no moments.
    expect(out.reason).toBe("Waiting for the week's dated moments.");
  });
});
