// P27-01: a moments reply cut off at max_tokens is recorded as "found nothing" (list) / "every moment unanswered" (judge),
// so the week is planned with no seasonal moments and is never asked again.
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ anthropic: vi.fn(), owned: vi.fn() }));
vi.mock("../../../functions/_shared/anthropic.ts", () => ({ anthropicMessages: m.anthropic }));
vi.mock("../../../functions/_shared/competitive/ownedSource.ts", () => ({ collectOwnedCompetitive: m.owned }));
vi.mock("../../../functions/_shared/voice/load.ts", async (original) => ({
  ...(await original<typeof import("../../../functions/_shared/voice/load.ts")>()),
  loadClientVoice: async () => ({ brand: "Acme", preferences: [], social: null, briefTone: null }),
}));
import { runMomentsList, runWeekMoments } from "../../../functions/_shared/calendar/runMoments";

vi.stubGlobal("Deno", { env: { get: (n: string) => (n === "ANTHROPIC_API_KEY" ? "test" : undefined) } });
afterEach(() => vi.clearAllMocks());
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

const NOW = new Date("2026-11-01T08:00:00Z");
const WEEK = "2026-11-02";
const job = (over: Record<string, unknown> = {}) => ({ id: "j", kind: "moments_list", client_id: null, occurrence: `${WEEK}T00:00:00Z`, attempts: 1, max_attempts: 3, payload: { country: "US" }, ...over }) as any;
const one = (name: string, date: string) => `{"name":"${name}","date":"${date}","last_year_date":null,"category":"cultural_commercial","link":"https://x.test/${date}","hashtags":[],"aliases":[],"terms":[]}`;

describe("P27-01 cut-off moments replies", () => {
  it("does not record a list cut off at max_tokens as a list that found nothing", async () => {
    const cut = `{"moments":[${one("Thanksgiving", "2026-11-26")},${one("Black Friday", "2026-11-27")},{"name":"Cyber Mon`;
    m.anthropic.mockResolvedValue({ text: cut, stopReason: "max_tokens", raw: {} });
    const db = fakeDb({});
    const out = await runMomentsList(db, job(), NOW);
    const list = db.writes.find((w) => w.table === "moment_lists")?.value as { found?: number } | undefined;
    // Expected: tried again (queued) or the complete moments kept. Actual: done, recorded found 0, never listed again.
    expect({ status: out.status, found: list?.found }).not.toEqual({ status: "done", found: 0 });
  });

  it("does not save a judge answer cut off at max_tokens as every moment unanswered", async () => {
    const CLIENT = { id: "c1", name: "Acme", timezone: "America/New_York", geo: "US", content_pillars: [{ name: "Holiday Gifting" }] };
    const THANKS = { key: "us:thanksgiving", name: "Thanksgiving", date: "2026-11-05", last_year_date: null, country: "US", category: "cultural_commercial", link: "https://x.test/t", hashtags: [], aliases: [], terms: [] };
    m.anthropic.mockResolvedValue({ text: '{"moments":[{"key":"us:thanksgiving","keep":true,"reason":"fits","fit":"Your gifting', stopReason: "max_tokens", raw: {} });
    const db = fakeDb({ calendar_plans: [{ id: "p1", client_id: "c1", week_start: WEEK, status: "queued" }], clients: [CLIENT], moment_lists: [{ country: "US", week_start: WEEK }, { country: "GLOBAL", week_start: WEEK }], moments: [THANKS] });
    const out = await runWeekMoments(db, job({ kind: "week_moments", client_id: "c1", payload: {} }), NOW);
    const saved = (db.writes.find((w) => w.table === "calendar_plans" && w.op === "update")?.value as any)?.moments;
    // Expected: asked again / retried. Actual: done, kept [], dropped [{why:"no_answer"}] saved on the plan for good.
    expect(saved?.dropped?.[0]?.why).not.toBe("no_answer");
  });
});
