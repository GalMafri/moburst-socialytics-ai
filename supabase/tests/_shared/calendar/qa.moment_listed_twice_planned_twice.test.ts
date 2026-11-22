// P27-03: every weekly list re-lists the next five weeks and rows are only ever added (unique key+date, never
// replaced or cleaned). A moment a later list dates differently, or names slightly differently, becomes a second
// moment: the week keeps both, so the planner gets the same holiday twice (one on a stale date).
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ anthropic: vi.fn(), owned: vi.fn() }));
vi.mock("../../../functions/_shared/anthropic.ts", () => ({ anthropicMessages: m.anthropic }));
vi.mock("../../../functions/_shared/competitive/ownedSource.ts", () => ({ collectOwnedCompetitive: m.owned }));
vi.mock("../../../functions/_shared/voice/load.ts", async (original) => ({
  ...(await original<typeof import("../../../functions/_shared/voice/load.ts")>()),
  loadClientVoice: async () => ({ brand: "Acme", preferences: [], social: null, briefTone: null }),
}));
import { runWeekMoments } from "../../../functions/_shared/calendar/runMoments";

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
const CLIENT = { id: "c1", name: "Acme", timezone: "America/New_York", geo: "US", content_pillars: [{ name: "Holiday Gifting" }] };
const base = { last_year_date: null, country: "US", category: "cultural_commercial", hashtags: [], aliases: [], terms: [] };
const keep = (key: string) => ({ key, keep: true, reason: "fits", fit: "Gifting is what your shoppers come to you for.", pillars: ["Holiday Gifting"], posts: [] });

async function run(moments: unknown[], answers: unknown[]) {
  m.anthropic.mockResolvedValue({ text: JSON.stringify({ moments: answers }), stopReason: "end_turn", raw: {} });
  const db = fakeDb({ calendar_plans: [{ id: "p1", client_id: "c1", week_start: WEEK, status: "queued" }], clients: [CLIENT], moment_lists: [{ country: "US", week_start: WEEK }, { country: "GLOBAL", week_start: WEEK }], moments });
  await runWeekMoments(db, { id: "j", kind: "week_moments", client_id: "c1", occurrence: `${WEEK}T00:00:00Z`, attempts: 1, max_attempts: 3 } as any, NOW);
  return ((db.writes.find((w) => w.table === "calendar_plans")?.value as any)?.moments?.kept ?? []) as Array<{ key: string; date: string }>;
}

describe("P27-03 a moment listed twice is planned twice", () => {
  it("keeps one date for a moment two weekly lists dated differently", async () => {
    const kept = await run([
      { ...base, key: "us:singles-day", name: "Singles Day", date: "2026-11-05", link: "https://x.test/old", listed_for: "2026-10-05" },
      { ...base, key: "us:singles-day", name: "Singles Day", date: "2026-11-06", link: "https://x.test/new", listed_for: "2026-10-26" },
    ], [keep("us:singles-day")]);
    expect(kept.map((k) => k.date)).toHaveLength(1); // actual: ["2026-11-05", "2026-11-06"]
  });

  it("keeps one moment for a holiday two weekly lists named slightly differently", async () => {
    const kept = await run([
      { ...base, key: "us:veterans-day-sale", name: "Veterans Day Sale", date: "2026-11-06", link: "https://x.test/a", listed_for: "2026-10-05" },
      { ...base, key: "us:veterans-day-sales", name: "Veterans Day Sales", date: "2026-11-06", link: "https://x.test/b", listed_for: "2026-10-26" },
    ], [keep("us:veterans-day-sale"), keep("us:veterans-day-sales")]);
    expect(kept).toHaveLength(1); // actual: 2
  });
});
