// The seasonal moments' jobs (Lital, 3 Nov 2026): a country's list made once
// by web search, a client's week judged only after code's filter, and a
// removal that teaches the memory. The model and Sprout are fakes.

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ anthropic: vi.fn(), owned: vi.fn(), learn: vi.fn(), preferences: [] as Array<{ pattern_description: string }> }));
vi.mock("../../../functions/_shared/anthropic.ts", () => ({ anthropicMessages: m.anthropic }));
vi.mock("../../../functions/_shared/competitive/ownedSource.ts", () => ({ collectOwnedCompetitive: m.owned }));
vi.mock("../../../functions/_shared/voice/load.ts", async (original) => ({
  ...(await original<typeof import("../../../functions/_shared/voice/load.ts")>()),
  loadClientVoice: async () => ({ brand: "Moburst", preferences: m.preferences, social: null, briefTone: null }),
  learnFromSignal: m.learn,
}));

import { runMomentFeedback, runMomentsList, runWeekMoments } from "../../../functions/_shared/calendar/runMoments";
import type { WeekJob } from "../../../functions/_shared/calendar/runWeek";

vi.stubGlobal("Deno", { env: { get: (name: string) => (name === "ANTHROPIC_API_KEY" ? "test" : undefined) } });

const NOW = new Date("2026-11-01T08:00:00Z");
const WEEK = "2026-11-02";
const MOBURST = { id: "mob", name: "Moburst", timezone: "America/New_York", geo: "US", language: "en", content_pillars: [{ name: "App Growth", description: "Paid social and ASO for apps" }], brand_identity: { tone_of_voice: "Confident" }, brief_text: "A mobile growth agency." };
const ELECTION = {
  key: "us:election-day", name: "Election Day", date: "2026-11-03", last_year_date: "2025-11-04", country: "US", category: "civic_political",
  link: "https://www.usa.gov/election-day", hashtags: ["#ElectionDay"], aliases: [], terms: ["election", "voting", "politics"],
};
const KINDNESS = { key: "global:world-kindness-day", name: "World Kindness Day", date: "2026-11-13", last_year_date: "2025-11-13", country: "GLOBAL", category: "awareness_day", link: "https://x.test/k", hashtags: [], aliases: [], terms: [] };
const LISTS = [{ country: "US", week_start: WEEK }, { country: "GLOBAL", week_start: WEEK }];
const PLAN = { id: "plan-9", client_id: "mob", week_start: WEEK, status: "queued" };

/** A stand-in for the service client that applies equality and list filters on the columns its rows have, and records every write. */
function fakeDb(tables: Record<string, unknown[]>) {
  const writes: Array<{ table: string; op: string; value: unknown }> = [];
  const db = {
    writes,
    from(table: string) {
      let rows = (tables[table] ?? []) as Array<Record<string, unknown>>;
      // deno-lint-ignore no-explicit-any
      const q: any = {};
      for (const name of ["select", "neq", "gte", "lte", "lt", "order", "limit", "not", "or", "range", "contains"]) q[name] = () => q;
      q.eq = (c: string, v: unknown) => { rows = rows.filter((r) => !(c in r) || r[c] === v); return q; };
      q.in = (c: string, vs: unknown[]) => { rows = rows.filter((r) => !(c in r) || vs.includes(r[c])); return q; };
      q.is = (c: string, v: unknown) => { if (v === null) rows = rows.filter((r) => r[c] == null); return q; };
      for (const op of ["update", "insert", "upsert", "delete"]) q[op] = (value: unknown) => { writes.push({ table, op, value }); return q; };
      q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
      q.single = q.maybeSingle;
      q.then = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve({ data: rows, error: null, count: rows.length }).then(ok, fail);
      return q;
    },
  };
  return db;
}

const job = (over: Partial<WeekJob> = {}): WeekJob => ({ id: "j", kind: "week_moments", client_id: "mob", occurrence: `${WEEK}T00:00:00Z`, attempts: 1, max_attempts: 3, ...over });
const saved = (db: ReturnType<typeof fakeDb>) => (db.writes.find((w) => w.table === "calendar_plans" && w.op === "update")?.value as { moments: Record<string, unknown> } | undefined)?.moments;
const sproutPost = (over: Record<string, unknown>) => ({ postId: "p", channel: "linkedin", type: "text", publishedAt: "2025-11-04T15:00:00Z", message: "App growth tips", engagementTotal: 10, ...over });

afterEach(() => { vi.clearAllMocks(); m.preferences = []; });
afterAll(() => vi.unstubAllGlobals());

describe("week_moments", () => {
  it("drops Election Day for Moburst before any model call when nothing of Moburst's own is about elections", async () => {
    m.owned.mockResolvedValue({ coverage: "complete", posts: [sproutPost({ postId: "a" }), sproutPost({ postId: "b", message: "Ad auctions this week" })] });
    const db = fakeDb({ calendar_plans: [PLAN], clients: [MOBURST], moment_lists: LISTS, moments: [ELECTION] });
    const out = await runWeekMoments(db, job(), NOW);
    expect(out).toMatchObject({ status: "done", result: { kept: 0, judged: false } });
    expect(m.anthropic).not.toHaveBeenCalled();
    expect(saved(db)).toMatchObject({ kept: [], dropped: [expect.objectContaining({ key: "us:election-day", why: "sensitive" })] });
  });

  it("keeps Election Day for a client that posted on it last year, once the judge cites that post and code checks it", async () => {
    m.owned.mockResolvedValue({ coverage: "complete", posts: [
      sproutPost({ postId: "e1", message: "Get out and vote. #ElectionDay", engagementTotal: 40 }),
      ...["a", "b", "c", "d"].map((id) => sproutPost({ postId: id })),
    ] });
    m.anthropic.mockResolvedValue({ text: JSON.stringify({ moments: [{ key: "us:election-day", keep: true, reason: "fits", fit: "Your audience follows civic life closely.", pillars: [], posts: ["O1"] }] }), stopReason: "end_turn", raw: { usage: { input_tokens: 900, output_tokens: 120 } } });
    const db = fakeDb({ calendar_plans: [PLAN], clients: [MOBURST], moment_lists: LISTS, moments: [ELECTION] });
    const out = await runWeekMoments(db, job(), NOW);
    expect(out).toMatchObject({ status: "done", result: { kept: 1, judged: true } });
    // One read of last year's posts around the date, and one judge call with structured output and no sampling settings.
    expect(m.owned.mock.calls[0][2]).toEqual({ start: "2025-10-28", end: "2025-11-11" });
    const body = m.anthropic.mock.calls[0][0].body;
    expect(body).toMatchObject({ model: "claude-sonnet-5-5", output_config: { effort: "medium", format: { type: "json_schema" } } });
    expect(body).not.toHaveProperty("temperature");
    expect(body.messages[0].content).toContain('O1 (LinkedIn text, 2025-11-04');
    expect(saved(db)).toMatchObject({
      model: "claude-sonnet-5-5", input_tokens: 900, output_tokens: 120,
      kept: [expect.objectContaining({ key: "us:election-day", fit: "Your audience follows civic life closely.", posts: ["e1"], history: expect.objectContaining({ id: "e1", platform: "LinkedIn", multiple: 3.7, sample: 5, thin: false }) })],
    });
  });

  it("drops a moment this client removed before, and a category two removals blocked, with no call", async () => {
    const db = fakeDb({
      calendar_plans: [PLAN], clients: [MOBURST], moment_lists: LISTS,
      moments: [{ ...KINDNESS, date: "2026-11-05" }, { ...ELECTION, key: "us:veterans-day", name: "Veterans Day", category: "remembrance_tragedy", date: "2026-11-04" }],
      moment_removals: [
        { client_id: "mob", moment_key: "global:world-kindness-day", category: "awareness_day" },
        { client_id: "mob", moment_key: "us:memorial-day", category: "remembrance_tragedy" },
        { client_id: "mob", moment_key: "us:9-11", category: "remembrance_tragedy" },
      ],
    });
    expect((await runWeekMoments(db, job(), NOW)).status).toBe("done");
    expect(m.anthropic).not.toHaveBeenCalled();
    expect(m.owned).not.toHaveBeenCalled();
    expect(Object.fromEntries((saved(db)!.dropped as Array<{ key: string; why: string }>).map((d) => [d.key, d.why]))).toEqual({ "global:world-kindness-day": "removed", "us:veterans-day": "blocked_category" });
  });

  it("queues the lists its countries need once, waits while they run, and goes on without a list whose job ended", async () => {
    const first = fakeDb({ calendar_plans: [PLAN], clients: [MOBURST] });
    expect(await runWeekMoments(first, job({ priority: 15 }), NOW)).toMatchObject({ status: "queued", deferred: true });
    const queued = first.writes.find((w) => w.table === "scheduled_jobs")?.value as Array<Record<string, unknown>>;
    expect(queued.map((j) => [j.kind, j.client_id, j.dedupe_key, j.payload, j.priority])).toEqual([
      ["moments_list", null, "moments_list:us:2026-11-02", { country: "US" }, 14],
      ["moments_list", null, "moments_list:global:2026-11-02", { country: "GLOBAL" }, 14],
    ]);
    const jobs = (status: string) => [{ dedupe_key: "moments_list:us:2026-11-02", status }, { dedupe_key: "moments_list:global:2026-11-02", status }];
    const running = fakeDb({ calendar_plans: [PLAN], clients: [MOBURST], scheduled_jobs: jobs("running") });
    expect(await runWeekMoments(running, job(), NOW)).toMatchObject({ status: "queued", deferred: true });
    expect(running.writes.filter((w) => w.table === "scheduled_jobs")).toEqual([]);
    const failed = fakeDb({ calendar_plans: [PLAN], clients: [MOBURST], scheduled_jobs: jobs("failed") });
    expect(await runWeekMoments(failed, job(), NOW)).toMatchObject({ status: "done", result: { kept: 0 } });
  });

  it("ends quietly as failed when the judge can't be read and the tries are used", async () => {
    m.owned.mockResolvedValue({ coverage: "complete", posts: [] });
    m.anthropic.mockResolvedValue({ text: "Sorry.", stopReason: "end_turn", raw: {} });
    const db = fakeDb({ calendar_plans: [PLAN], clients: [MOBURST], moment_lists: LISTS, moments: [{ ...KINDNESS, date: "2026-11-05" }] });
    expect((await runWeekMoments(db, job({ attempts: 1 }), NOW)).status).toBe("queued");
    expect((await runWeekMoments(db, job({ attempts: 3 }), NOW)).status).toBe("failed");
    expect(saved(db)).toBeUndefined();
  });
});

describe("moments_list", () => {
  const list = { moments: [
    { name: "Election Day", date: "2026-11-03", last_year_date: "2025-11-04", category: "civic_political", link: "https://www.usa.gov/election-day", hashtags: ["#ElectionDay"], aliases: [], terms: ["election"] },
    { name: "Made-up Day", date: "2026-11-20", category: "awareness_day", link: "" },
  ] };

  it("lists a country's moments with web search, continues a paused turn, and keeps only moments with a link", async () => {
    m.anthropic
      .mockResolvedValueOnce({ text: "", stopReason: "pause_turn", raw: { content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "US holidays November 2026" } }], usage: { input_tokens: 1000, output_tokens: 50, server_tool_use: { web_search_requests: 1 } } } })
      .mockResolvedValueOnce({ text: JSON.stringify(list), stopReason: "end_turn", raw: { usage: { input_tokens: 4000, output_tokens: 900, server_tool_use: { web_search_requests: 2 } } } });
    const db = fakeDb({});
    const out = await runMomentsList(db, job({ kind: "moments_list", client_id: null as unknown as string, payload: { country: "US" } }), NOW);
    expect(out).toMatchObject({ status: "done", result: { country: "US", moments: 1, searches: 3, input_tokens: 5000, output_tokens: 950 } });
    const first = m.anthropic.mock.calls[0][0].body;
    expect(first.tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 8, user_location: { type: "approximate", country: "US" } }]);
    expect(first.messages[0].content).toContain("from 2026-11-02 to 2026-12-06");
    expect(first).not.toHaveProperty("temperature");
    // The paused turn goes back as it came.
    expect(m.anthropic.mock.calls[1][0].body.messages[1]).toEqual({ role: "assistant", content: [expect.objectContaining({ type: "server_tool_use" })] });
    expect(db.writes.find((w) => w.table === "moments")?.value).toEqual([expect.objectContaining({ key: "us:election-day", listed_for: WEEK })]);
    expect(db.writes.find((w) => w.table === "moment_lists")?.value).toMatchObject({ country: "US", week_start: WEEK, through: "2026-12-06", found: 1 });
  });

  it("records a list that found nothing, so the week never waits for it again, and asks the world's list with no location", async () => {
    m.anthropic.mockResolvedValue({ text: '{"moments":[]}', stopReason: "end_turn", raw: {} });
    const db = fakeDb({});
    expect((await runMomentsList(db, job({ kind: "moments_list", payload: { country: "GLOBAL" } }), NOW)).status).toBe("done");
    expect(m.anthropic.mock.calls[0][0].body.tools[0]).not.toHaveProperty("user_location");
    expect(db.writes.find((w) => w.table === "moments")).toBeUndefined();
    expect(db.writes.find((w) => w.table === "moment_lists")?.value).toMatchObject({ country: "GLOBAL", found: 0 });
  });

  it("tries again later when the reply can't be read", async () => {
    m.anthropic.mockResolvedValue({ text: "I could not search.", stopReason: "end_turn", raw: {} });
    expect((await runMomentsList(fakeDb({}), job({ kind: "moments_list", payload: { country: "US" } }), NOW)).status).toBe("queued");
  });
});

describe("moment_feedback", () => {
  it("teaches the memory what a removed seasonal post says", async () => {
    m.learn.mockResolvedValue({ ops: 1 });
    const db = fakeDb({ moment_removals: [{ id: "r1", client_id: "mob", moment_name: "Election Day", category: "civic_political", post_date: "2026-11-03" }] });
    expect(await runMomentFeedback(db, job({ kind: "moment_feedback", payload: { removal_id: "r1" } }), NOW)).toMatchObject({ status: "done", result: { ops: 1 } });
    expect(m.learn).toHaveBeenCalledWith(db, "mob", { kind: "moment_removed", moment: "Election Day", category: "civic_political", date: "2026-11-03" });
  });
});
