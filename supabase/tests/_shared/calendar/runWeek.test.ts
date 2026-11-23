// The weekly calendar runs itself (Lital, 19 Oct 2026): a week is planned
// for any client, with or without posts, competitors or a setting, and the
// monthly voice job keeps the preference memory short.

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  anthropic: vi.fn(),
  owned: vi.fn(),
  activePreferences: vi.fn(),
  consolidateMemory: vi.fn(),
  buildVoiceProfile: vi.fn(),
  // deno-lint-ignore no-explicit-any
  social: null as any,
}));
vi.mock("../../../functions/_shared/anthropic.ts", () => ({ anthropicMessages: m.anthropic }));
vi.mock("../../../functions/_shared/competitive/ownedSource.ts", () => ({ collectOwnedCompetitive: m.owned }));
vi.mock("../../../functions/_shared/voice/load.ts", async (original) => ({
  ...(await original<typeof import("../../../functions/_shared/voice/load.ts")>()),
  loadClientVoice: async () => ({ brand: "Pay The Pyper", preferences: [], social: m.social, briefTone: null }),
  activePreferences: m.activePreferences,
  consolidateMemory: m.consolidateMemory,
  buildVoiceProfile: m.buildVoiceProfile,
}));

import { accountsFacts, gatherEvidence, ownPosts, retryWait, runVoiceProfile, runWeekPlan, runWeekRevise, type WeekJob } from "../../../functions/_shared/calendar/runWeek";
import { assetRule } from "../../../functions/_shared/calendar/weekPlan";

// The model is mocked; the key only has to exist.
vi.stubGlobal("Deno", { env: { get: (name: string) => (name === "ANTHROPIC_API_KEY" ? "test" : undefined) } });

const NOW = new Date("2026-10-19T07:15:00Z");
const CLIENT = { id: "ptp", name: "Pay The Pyper", timezone: "America/New_York", primary_platforms: ["Instagram", "Facebook"], posting_rhythm: null, content_pillars: [{ name: "Beer League Truths" }], geo: "US", language: "en" };

/** A stand-in for the service client: each table answers with its rows, and every write is recorded. */
function fakeDb(tables: Record<string, unknown[]>) {
  const writes: Array<{ table: string; op: string; value: unknown }> = [];
  const db = {
    writes,
    rpc: async () => ({ data: false, error: null }),
    from(table: string) {
      let rows = tables[table] ?? [];
      // deno-lint-ignore no-explicit-any
      const q: any = {};
      for (const name of ["select", "neq", "in", "gte", "lte", "lt", "order", "limit", "not", "or", "range", "contains"]) q[name] = () => q;
      // An equality filter keeps the rows that have the column and match it; rows without the column stay.
      q.eq = (column: string, value: unknown) => { rows = rows.filter((r) => !(column in (r as Record<string, unknown>)) || (r as Record<string, unknown>)[column] === value); return q; };
      // A column that must be null drops the rows where it is set (a removed term has removed_at).
      q.is = (column: string, value: unknown) => { if (value === null) rows = rows.filter((r) => (r as Record<string, unknown>)[column] == null); return q; };
      for (const op of ["update", "insert", "upsert", "delete"]) q[op] = (value: unknown) => { writes.push({ table, op, value }); return q; };
      q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
      q.single = q.maybeSingle;
      q.then = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve({ data: rows, error: null, count: rows.length }).then(ok, fail);
      return q;
    },
  };
  return db;
}

const job = (over: Partial<WeekJob> = {}): WeekJob => ({ id: "j", kind: "week_plan", client_id: "ptp", occurrence: "2026-10-26T00:00:00Z", attempts: 1, max_attempts: 3, ...over });
/** A plan whose dated moments were judged (week_moments) and kept none. */
const plan = { id: "plan-1", client_id: "ptp", week_start: "2026-10-26", status: "queued", requested_by: null, moments: { kept: [], dropped: [] } };
/** A moment the judge kept and code checked (moments.ts JudgedMoment). */
const HALLOWEEN = {
  key: "us:halloween", name: "Halloween", date: "2026-10-31", last_year_date: "2025-10-31", country: "US", category: "cultural_commercial",
  link: "https://www.timeanddate.com/holidays/us/halloween", hashtags: ["#Halloween"], aliases: [], terms: [],
  fit: "Costume reels are where captains already show up.", pillars: ["Beer League Truths"], posts: ["ig9"], companies: 0,
  history: { id: "ig9", platform: "Instagram", format: "reel", date: "2025-10-31", link: null, metric: "engagement", value: 23, median: 10, multiple: 2.1, sample: 6, thin: false },
};

afterEach(() => { vi.clearAllMocks(); m.social = null; });
afterAll(() => vi.unstubAllGlobals());

describe("runWeekPlan", () => {
  it("plans a client with no posts, no competitors and no setting, and never fails for want of a rhythm", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic.mockResolvedValue({ text: JSON.stringify({ posts: [{ date: "2026-10-27", platform: "Instagram", copy: "Captains, this one is for you.", reason_type: "performance", evidence_ids: [] }] }), raw: {} });
    const db = fakeDb({ calendar_plans: [plan], clients: [CLIENT] });
    const out = await runWeekPlan(db, job(), NOW);
    expect(out.reason ?? null).toBeNull();
    expect(out.status).toBe("done");
    const inserted = db.writes.find((w) => w.table === "calendar_posts" && w.op === "insert")?.value as Array<Record<string, unknown>>;
    // The one Instagram post, and the Story every Instagram post gets when Sprout shows no Story history.
    expect(inserted.map((r) => r.format ?? null)).toEqual([null, "Story"]);
    expect(inserted[0].reasons).toEqual([expect.objectContaining({ type: "performance", test: false })]);
    // With no footage uploaded, the planner is told not to plan ideas that need filming.
    expect(m.anthropic.mock.calls[0][0].body.messages[0].content).toContain("don't plan ideas that need a specific person on camera");
    const ready = db.writes.filter((w) => w.table === "calendar_plans" && w.op === "update").map((w) => w.value as Record<string, unknown>).find((v) => v.status === "ready");
    expect(ready?.rhythm).toEqual(expect.objectContaining({ applied: expect.any(Array), learned: expect.any(Array), sources: expect.any(Object) }));
  });

  it("waits for the week's dated moments, queuing them once, and plans without them when their job ended without them", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic.mockResolvedValue({ text: JSON.stringify({ posts: [{ date: "2026-10-27", platform: "Instagram", copy: "Captains.", reason_type: "performance", evidence_ids: [] }] }), raw: {} });
    const unjudged = { ...plan, moments: null };
    const first = fakeDb({ calendar_plans: [unjudged], clients: [CLIENT] });
    expect(await runWeekPlan(first, job({ priority: 15 } as Partial<WeekJob>), NOW)).toMatchObject({ status: "queued", deferred: true, reason: "Waiting for the week's dated moments." });
    expect(first.writes.filter((w) => w.table === "scheduled_jobs")).toEqual([{ table: "scheduled_jobs", op: "upsert", value: expect.objectContaining({ kind: "week_moments", client_id: "ptp", dedupe_key: "week_moments:ptp:2026-10-26", occurrence: "2026-10-26T00:00:00Z", priority: 15 }) }]);
    expect(m.anthropic).not.toHaveBeenCalled();

    // Still running: wait again, queue nothing.
    const running = fakeDb({ calendar_plans: [unjudged], clients: [CLIENT], scheduled_jobs: [{ kind: "week_moments", client_id: "ptp", dedupe_key: "week_moments:ptp:2026-10-26", status: "running" }] });
    expect(await runWeekPlan(running, job(), NOW)).toMatchObject({ status: "queued", deferred: true });
    expect(running.writes.filter((w) => w.table === "scheduled_jobs")).toEqual([]);

    // Out of tries: the week is planned with no moments, and no seasonal post.
    const failed = fakeDb({ calendar_plans: [unjudged], clients: [CLIENT], scheduled_jobs: [{ kind: "week_moments", client_id: "ptp", dedupe_key: "week_moments:ptp:2026-10-26", status: "failed" }] });
    expect((await runWeekPlan(failed, job(), NOW)).status).toBe("done");
    expect(m.anthropic.mock.calls[0][0].body.messages[0].content).toContain("no post is seasonal");
  });

  it("puts a moments job that failed before this plan job was created back in the queue once, and waits for it", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic.mockResolvedValue({ text: JSON.stringify({ posts: [{ date: "2026-10-27", platform: "Instagram", copy: "Captains.", reason_type: "performance", evidence_ids: [] }] }), raw: {} });
    const unjudged = { ...plan, moments: null };
    const key = "week_moments:ptp:2026-10-26";
    // The moments job gave up on 12 Oct; this week's plan job was created on 19 Oct.
    const older = fakeDb({ calendar_plans: [unjudged], clients: [CLIENT], scheduled_jobs: [{ kind: "week_moments", client_id: "ptp", dedupe_key: key, status: "failed", finished_at: "2026-10-12T07:00:00Z" }] });
    expect(await runWeekPlan(older, job({ created_at: "2026-10-19T07:00:00Z" } as Partial<WeekJob>), NOW)).toMatchObject({ status: "queued", deferred: true, reason: "Waiting for the week's dated moments." });
    expect(m.anthropic).not.toHaveBeenCalled();
    expect(older.writes.filter((w) => w.table === "scheduled_jobs")).toEqual([{ table: "scheduled_jobs", op: "update", value: expect.objectContaining({ status: "queued", attempts: 0 }) }]);

    // A failure during this plan job's own run still plans without moments, and queues nothing.
    const during = fakeDb({ calendar_plans: [unjudged], clients: [CLIENT], scheduled_jobs: [{ kind: "week_moments", client_id: "ptp", dedupe_key: key, status: "failed", finished_at: "2026-10-19T07:10:00Z" }] });
    expect((await runWeekPlan(during, job({ created_at: "2026-10-19T07:00:00Z" } as Partial<WeekJob>), NOW)).status).toBe("done");
    expect(during.writes.filter((w) => w.table === "scheduled_jobs")).toEqual([]);
  });

  // The weekly Trends collection runs on the client's feed weekday; on a Monday
  // it was still collecting when the plans ran, so Monday-feed clients were
  // planned from week-old trends (9 Nov 2026: Buzznow, European Wax Center, Yangra).
  it("waits while the client's trend collection is under way, at most two hours from when it began", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic.mockResolvedValue({ text: JSON.stringify({ posts: [{ date: "2026-10-27", platform: "Instagram", copy: "Captains.", reason_type: "performance", evidence_ids: [] }] }), raw: {} });
    const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();
    const waiting = { status: "queued", deferred: true, reason: "Waiting for the client's trends." };

    // Queued, not started yet.
    const queued = fakeDb({ calendar_plans: [plan], clients: [CLIENT], scheduled_jobs: [{ kind: "trend_refresh", client_id: "ptp", status: "queued", created_at: minutesAgo(5) }] });
    expect(await runWeekPlan(queued, job(), NOW)).toMatchObject(waiting);
    // Its week is collecting.
    const collecting = fakeDb({ calendar_plans: [plan], clients: [CLIENT], trend_weeks: [{ client_id: "ptp", status: "running", created_at: minutesAgo(30) }] });
    expect(await runWeekPlan(collecting, job(), NOW)).toMatchObject(waiting);
    expect(m.anthropic).not.toHaveBeenCalled();

    // Begun more than two hours ago: the plan goes on with the newest finished week.
    const stalled = fakeDb({ calendar_plans: [plan], clients: [CLIENT], trend_weeks: [{ client_id: "ptp", status: "running", created_at: minutesAgo(121) }], scheduled_jobs: [{ kind: "trend_refresh", client_id: "ptp", status: "queued", created_at: minutesAgo(130) }] });
    expect((await runWeekPlan(stalled, job(), NOW)).status).toBe("done");
    // Another client's collection, or a finished week, holds nothing.
    const others = fakeDb({ calendar_plans: [plan], clients: [CLIENT], trend_weeks: [{ client_id: "ptp", status: "done", created_at: minutesAgo(10) }, { client_id: "bader", status: "running", created_at: minutesAgo(10) }], scheduled_jobs: [{ kind: "trend_refresh", client_id: "bader", status: "running", created_at: minutesAgo(10) }] });
    expect((await runWeekPlan(others, job(), NOW)).status).toBe("done");
  });

  it("cites the moments the week kept as M items, words a seasonal post from them, and notes a seasonal post without one", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic.mockResolvedValue({ text: JSON.stringify({ posts: [
      { date: "2026-10-30", platform: "Instagram", copy: "Costume night on the ice.", reason_type: "seasonal", evidence_ids: ["M1"], fit: "Spooky." },
      { date: "2026-10-27", platform: "Instagram", copy: "Vote for your captain.", reason_type: "seasonal", evidence_ids: [], moment: "Election Day" },
    ] }), raw: {} });
    const db = fakeDb({ calendar_plans: [{ ...plan, moments: { kept: [HALLOWEEN], dropped: [] } }], clients: [CLIENT] });
    expect((await runWeekPlan(db, job(), NOW)).status).toBe("done");
    expect(m.anthropic.mock.calls[0][0].body.messages[0].content).toContain("M1 [2026-10-31, cultural or commercial moment");
    const inserted = db.writes.find((w) => w.table === "calendar_posts" && w.op === "insert")?.value as Array<Record<string, unknown>>;
    // The seasonal post without a checked moment is dropped; the kept one has its Story beside it.
    expect(inserted.filter((r) => r.format !== "Story").map((r) => r.copy)).toEqual(["Costume night on the ice."]);
    expect(inserted[0].reasons).toEqual([expect.objectContaining({
      type: "seasonal", label: "Halloween, Oct 31. Your Instagram reel for it last year got 2.1x your usual engagement. Costume reels are where captains already show up.",
      evidence: [expect.objectContaining({ id: "M1", kind: "moment", key: "us:halloween", category: "cultural_commercial" })],
    })]);
    const ready = db.writes.filter((w) => w.table === "calendar_plans" && w.op === "update").map((w) => w.value as Record<string, unknown>).find((v) => v.status === "ready");
    expect((ready?.evidence as Record<string, unknown>).dropped_seasonal).toEqual([expect.objectContaining({ date: "2026-10-27", platform: "Instagram", why: "seasonal post without a checked moment" })]);
  });

  it("queues the voice profile early when a platform that had too few posts for a voice of its own reaches 5", async () => {
    const posts = (channel: string, n: number) => Array.from({ length: n }, (_, i) => ({ postId: `${channel}${i}`, channel, type: "photo", publishedAt: new Date(NOW.getTime() - (i * 5 + 3) * 86400_000).toISOString(), message: "Captains, this one is for you and your whole team.", engagementTotal: 3 }));
    m.owned.mockResolvedValue({ coverage: "complete", profiles: [{ network: "instagram" }, { network: "tiktok" }], posts: [...posts("instagram", 8), ...posts("tiktok", 5)] });
    m.anthropic.mockResolvedValue({ text: JSON.stringify({ posts: [{ date: "2026-10-27", platform: "Instagram", copy: "Captains, this one is for you.", reason_type: "performance", evidence_ids: [] }] }), raw: {} });
    m.social = { built_at: "2026-10-05T00:00:00Z", post_count: 11, platforms: {}, examples: {}, thin: { TikTok: 3 } };
    const db = fakeDb({ calendar_plans: [plan], clients: [CLIENT] });
    expect((await runWeekPlan(db, job(), NOW)).status).toBe("done");
    expect(db.writes.filter((w) => w.table === "scheduled_jobs").map((w) => w.value)).toEqual([expect.objectContaining({ kind: "voice_profile", client_id: "ptp", dedupe_key: "voice_profile:ptp:2026-10-19" })]);
    // Nothing thin, nothing queued.
    m.social = { ...m.social, thin: { TikTok: 3 } };
    m.owned.mockResolvedValue({ coverage: "complete", profiles: [{ network: "instagram" }], posts: posts("instagram", 8) });
    const quiet = fakeDb({ calendar_plans: [plan], clients: [CLIENT] });
    await runWeekPlan(quiet, job(), NOW);
    expect(quiet.writes.filter((w) => w.table === "scheduled_jobs")).toEqual([]);
  });

  it("plans the week with no trend evidence when nothing is stored yet, and never reads the monthly report's trend strings", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic.mockResolvedValue({ text: JSON.stringify({ posts: [{ date: "2026-10-27", platform: "Instagram", copy: "Captains, this one is for you.", reason_type: "performance", evidence_ids: [] }] }), raw: {} });
    // The latest report still carries the old trend strings; the planner no longer reads them.
    const report = { id: "r1", created_at: "2026-10-01T00:00:00Z", report_data: [{ ai_analysis: { instagram_trends_analysis: { opportunities_for_client: ["Old report trend about carousels"] } } }] };
    const db = fakeDb({ calendar_plans: [plan], clients: [CLIENT], reports: [report] });
    const out = await runWeekPlan(db, job(), NOW);
    expect(out.status).toBe("done");
    const ready = db.writes.filter((w) => w.table === "calendar_plans" && w.op === "update").map((w) => w.value as Record<string, unknown>).find((v) => v.status === "ready");
    const evidence = ready?.evidence as { items: Array<{ kind: string }>; sources: Record<string, unknown> };
    expect(evidence.sources.trends).toBe("none");
    expect(evidence.items.filter((i) => i.kind === "trend")).toEqual([]);
    expect(m.anthropic.mock.calls[0][0].body.messages[0].content).not.toContain("Old report trend");
  });

  it("plans from the stored themes: the prompt names the theme and the post keeps it as its reason", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic.mockResolvedValue({ text: JSON.stringify({ posts: [{ date: "2026-10-27", platform: "Instagram", copy: "Captains, this one is for you.", reason_type: "trend", evidence_ids: ["N1"], fit: "Captains live this every week." }] }), raw: {} });
    const db = fakeDb({
      calendar_plans: [plan], clients: [CLIENT],
      trend_weeks: [{ id: "w1", week_start: "2026-10-19", status: "done" }],
      trend_themes: [{ id: "th1", week_id: "w1", position: 0, title: "Captain POV skits", post_ids: ["tp1"], dismissed_at: null }],
      trend_posts: [{ id: "tp1", week_id: "w1", platform: "tiktok", url: "https://t/1", author: "@benchpro", text: "POV: you are the captain", posted_at: "2026-10-14T09:00:00+00:00", format: "short_video", fit: 88, engagement: 5400, likes: 4000, comments: 300, shares: 20, saves: 80, views: 90000, kept: true, tripwire: false }],
    });
    const out = await runWeekPlan(db, job(), NOW);
    expect(out.status).toBe("done");
    const themed = m.anthropic.mock.calls[0][0].body.messages[0].content as string;
    expect(themed).toContain('Theme "Captain POV skits".');
    // The planner reads the theme and the post's place, never its caption or who posted it (copy sources, 17 Nov 2026).
    expect(themed).toContain("N1 [TikTok short_video, 2026-10-14] Lesson: not summarized");
    expect(themed).not.toContain("POV: you are the captain");
    expect(themed).not.toContain("@benchpro");
    const inserted = db.writes.find((w) => w.table === "calendar_posts" && w.op === "insert")?.value as Array<Record<string, unknown>>;
    expect(inserted[0].reasons).toEqual([expect.objectContaining({
      type: "trend", label: 'Inspired by "Captain POV skits": @benchpro\'s TikTok short video from Oct 14. Captains live this every week.',
      // The stored value is what anyone can count on the post (likes, comments and shares), never the team's weighted score.
      evidence: [expect.objectContaining({ id: "N1", kind: "trend", theme: "Captain POV skits", link: "https://t/1", metric: "engagement", value: 4320 })],
    })]);
    expect(JSON.stringify(inserted)).not.toContain("5400");
    const ready = db.writes.filter((w) => w.table === "calendar_plans" && w.op === "update").map((w) => w.value as Record<string, unknown>).find((v) => v.status === "ready");
    expect((ready?.evidence as { sources: Record<string, unknown> }).sources.trends).toBe("themes");
  });

  it("suggests the profile's hashtags for the platforms the week posts on, and nothing for a client without a profile", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic.mockResolvedValue({ text: JSON.stringify({ posts: [{ date: "2026-10-27", platform: "Instagram", copy: "Captains, this one is for you.", reason_type: "performance", evidence_ids: [] }] }), raw: {} });
    // The team's posting setting puts three platforms in the week's slots.
    const client = { ...CLIENT, primary_platforms: ["Instagram", "TikTok", "LinkedIn"], posting_rhythm: { instagram: 2, tiktok: 1, linkedin: 1 } };
    const tag = (platform: string, term: string, source = "lifecycle") => ({ client_id: "ptp", kind: "hashtag", platform, term, reason: "r", source, removed_at: null });
    const db = fakeDb({
      calendar_plans: [plan], clients: [client],
      trend_terms: [tag("instagram", "#beerleague"), tag("tiktok", "#hockeytok"), { client_id: "ptp", kind: "topic", platform: null, term: "beer league hockey", reason: "r", source: "lifecycle", removed_at: null }],
    });
    expect((await runWeekPlan(db, job(), NOW)).status).toBe("done");
    const prompt = m.anthropic.mock.calls[0][0].body.messages[0].content as string;
    expect(prompt).toContain("- Instagram: #beerleague");
    expect(prompt).toContain("- TikTok: #hockeytok");
    // LinkedIn is in this week's slots but the profile has no LinkedIn hashtags: no line. A topic is never a hashtag.
    expect(prompt).toContain("- LinkedIn: 1 post");
    expect(prompt).not.toContain("- LinkedIn: #");
    expect(prompt).not.toContain("beer league hockey");

    // A client with no trend profile: no hashtag lines, and the rest of the prompt is the same.
    m.anthropic.mockClear();
    await runWeekPlan(fakeDb({ calendar_plans: [plan], clients: [client] }), job(), NOW);
    const bare = m.anthropic.mock.calls[0][0].body.messages[0].content as string;
    expect(bare).not.toContain("- Instagram: #");
    expect(bare).not.toContain("- TikTok: #");
    expect(bare).not.toContain("Hashtags the brand's space uses");
    expect(prompt.replace(/\n\nHashtags the brand's space uses[^\n]*\n- Instagram: #beerleague\n- TikTok: #hockeytok/, "")).toBe(bare);
  });

  it("plans from the client's content strategy, people's versions included, and gives a client without one today's prompt", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic.mockResolvedValue({ text: JSON.stringify({ posts: [{ date: "2026-10-27", platform: "Instagram", copy: "Captains, this one is for you.", reason_type: "performance", evidence_ids: [] }] }), raw: {} });
    const strategy = { client_id: "ptp", sections: { goals: "Grow saves on Instagram.", avoid: "Office photos." }, platforms: [], pillars: [], written_at: "2026-11-02T10:00:00Z" };
    await runWeekPlan(fakeDb({ calendar_plans: [plan], clients: [CLIENT], content_strategies: [strategy], content_strategy_edits: [{ client_id: "ptp", section_key: "avoid", text: "Anything that mocks other apps." }] }), job(), NOW);
    const prompt = m.anthropic.mock.calls[0][0].body.messages[0].content as string;
    expect(prompt).toContain("Grow saves on Instagram.");
    expect(prompt).toContain("Anything that mocks other apps.");
    expect(prompt).not.toContain("Office photos.");

    m.anthropic.mockClear();
    await runWeekPlan(fakeDb({ calendar_plans: [plan], clients: [CLIENT] }), job(), NOW);
    const bare = m.anthropic.mock.calls[0][0].body.messages[0].content as string;
    expect(bare).not.toContain("content strategy");
    // With a strategy, the prompt gains its section, and the rule on what a post may point to names it as the client's own material. Nothing else moves.
    const pointing = { pillars: true, strategy: true };
    expect(prompt).toContain(assetRule(CLIENT.name, pointing));
    expect(prompt.replace(/\n\nThe client's content strategy[\s\S]*?evidence rules here win wherever the strategy differs from them\./, "").replace(assetRule(CLIENT.name, pointing), assetRule(CLIENT.name, { pillars: true }))).toBe(bare);
  });

  it("plans as before when the strategy cannot be read", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic.mockResolvedValue({ text: JSON.stringify({ posts: [{ date: "2026-10-27", platform: "Instagram", copy: "Captains.", reason_type: "performance", evidence_ids: [] }] }), raw: {} });
    const db = fakeDb({ calendar_plans: [plan], clients: [CLIENT] });
    const from = db.from.bind(db);
    db.from = (table: string) => {
      if (table !== "content_strategies") return from(table);
      // deno-lint-ignore no-explicit-any
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: { message: "relation does not exist" } }) };
      return q;
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await runWeekPlan(db, job(), NOW)).status).toBe("done");
    expect(m.anthropic.mock.calls[0][0].body.messages[0].content).not.toContain("content strategy");
    warn.mockRestore();
  });

  it("sends the week to be tried again when the profile can't be read, saying why in plain words", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    const db = fakeDb({ calendar_plans: [plan], clients: [CLIENT] });
    const from = db.from.bind(db);
    db.from = (table: string) => {
      if (table !== "trend_terms") return from(table);
      // deno-lint-ignore no-explicit-any
      const q: any = { select: () => q, eq: () => q, is: () => Promise.resolve({ data: null, error: { message: "boom" } }) };
      return q;
    };
    const out = await runWeekPlan(db, job(), NOW);
    // Like the trend themes, a read that fails sends the week to be tried again, with the reason in words.
    expect(out).toMatchObject({ status: "queued", reason: "Could not read what trends track: boom" });
    expect(m.anthropic).not.toHaveBeenCalled();
  });

  it("never plans an empty week: a client posting less than weekly still gets one post on its main platform", async () => {
    // Two Facebook posts in the last 8 weeks: 0.25 a week, and the week of 26 Oct is not one of its spread weeks.
    const posts = ["2026-09-01T14:00:00Z", "2026-09-29T14:00:00Z"].map((publishedAt, i) => ({ postId: `p${i}`, channel: "facebook", type: "photo", publishedAt, message: "A post", engagementTotal: 3 }));
    m.owned.mockResolvedValue({ coverage: "complete", profiles: [{ network: "facebook" }], posts });
    m.anthropic.mockRejectedValue(new Error("stop after the prompt"));
    const db = fakeDb({ calendar_plans: [plan], clients: [CLIENT] });
    await runWeekPlan(db, job(), NOW);
    expect(m.anthropic).toHaveBeenCalled();
    expect(JSON.stringify(m.anthropic.mock.calls[0])).toContain("Facebook");
  });

  it("closes a week that is over quietly, never as a failure", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    const db = fakeDb({ calendar_plans: [{ ...plan, week_start: "2026-10-05" }], clients: [CLIENT] });
    const out = await runWeekPlan(db, job({ occurrence: "2026-10-05T00:00:00Z" }), NOW);
    expect(out.status).toBe("skipped");
    expect(db.writes).toContainEqual(expect.objectContaining({ table: "calendar_plans", value: expect.objectContaining({ status: "expired" }) }));
    expect(m.anthropic).not.toHaveBeenCalled();
  });

  it("tries a plan that didn't finish again with growing waits, never ending it as failed", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic.mockRejectedValue(new Error("Anthropic 529 overloaded"));
    for (const [attempts, minutes] of [[1, 10], [2, 60], [3, 360], [4, 1440], [9, 1440]]) {
      const db = fakeDb({ calendar_plans: [plan], clients: [CLIENT] });
      const out = await runWeekPlan(db, job({ attempts }), NOW);
      expect(out).toMatchObject({ status: "queued", reason: "Anthropic 529 overloaded", available_at: new Date(NOW.getTime() + minutes * 60_000).toISOString() });
      const statuses = db.writes.filter((w) => w.table === "calendar_plans").map((w) => (w.value as { status?: string }).status).filter(Boolean);
      expect(statuses).not.toContain("failed");
      expect(statuses.at(-1)).toBe("queued");
    }
  });

  it("waits before running again after a run that stopped without finishing", async () => {
    const stopped = { ...plan, status: "planning", claimed_at: "2026-10-19T06:00:00Z" };
    const db = fakeDb({ calendar_plans: [stopped], clients: [CLIENT] });
    const out = await runWeekPlan(db, job({ attempts: 2 }), NOW);
    expect(out).toMatchObject({ status: "queued", available_at: new Date(NOW.getTime() + 60 * 60_000).toISOString() });
    expect(db.writes).toContainEqual(expect.objectContaining({ table: "calendar_plans", value: expect.objectContaining({ claimed_at: null, status: "queued" }) }));
    expect(m.anthropic).not.toHaveBeenCalled();
  });
});

// "Stop planning" (Lital, 3 Nov 2026): once a person stops a week's plan
// (calendar_stop_plan sets it canceled), its run asks nothing more of the
// model and writes nothing, however far it got. The database also refuses
// posts for a stopped plan (calendar_posts_plan_open), for a run that is
// between its check and its write.
describe("a plan a person stopped", () => {
  const PLANNED = { text: JSON.stringify({ posts: [{ date: "2026-10-27", platform: "Instagram", copy: "Captains, this one is for you.", reason_type: "performance", evidence_ids: [] }] }), raw: {} };
  const planWrites = (db: ReturnType<typeof fakeDb>) => db.writes.filter((w) => w.table === "calendar_plans").map((w) => w.value as Record<string, unknown>);
  const postInserts = (db: ReturnType<typeof fakeDb>) => db.writes.filter((w) => w.table === "calendar_posts" && w.op === "insert");

  it("is skipped by its job with no model call and no write", async () => {
    const db = fakeDb({ calendar_plans: [{ ...plan, status: "canceled" }], clients: [CLIENT] });
    expect(await runWeekPlan(db, job(), NOW)).toEqual({ status: "skipped", reason: "A person stopped this week's plan." });
    expect(m.anthropic).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });

  it("starts no model call when it was stopped while the run gathered the evidence", async () => {
    const stopped = { ...plan };
    m.owned.mockImplementation(async () => { stopped.status = "canceled"; return { coverage: "not_connected", profiles: [], posts: [] }; });
    m.anthropic.mockResolvedValue(PLANNED);
    const db = fakeDb({ calendar_plans: [stopped], clients: [CLIENT] });
    expect((await runWeekPlan(db, job(), NOW)).status).toBe("skipped");
    expect(m.anthropic).not.toHaveBeenCalled();
    expect(postInserts(db)).toEqual([]);
    expect(planWrites(db).some((v) => v.status === "ready" || v.status === "queued")).toBe(false);
  });

  it("writes nothing when it was stopped during the model call", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    const stopped = { ...plan };
    m.anthropic.mockImplementation(async () => { stopped.status = "canceled"; return PLANNED; });
    const db = fakeDb({ calendar_plans: [stopped], clients: [CLIENT] });
    expect(await runWeekPlan(db, job(), NOW)).toEqual({ status: "skipped", reason: "A person stopped this week's plan." });
    expect(postInserts(db)).toEqual([]);
    expect(planWrites(db).some((v) => v.status === "ready" || v.status === "queued")).toBe(false);
  });

  it("is never put back in the queue by a run that fails after the stop", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    const stopped = { ...plan };
    m.anthropic.mockImplementation(async () => { stopped.status = "canceled"; throw new Error("Anthropic 500"); });
    const db = fakeDb({ calendar_plans: [stopped], clients: [CLIENT] });
    expect((await runWeekPlan(db, job(), NOW)).status).toBe("skipped");
    expect(planWrites(db).some((v) => v.status === "queued")).toBe(false);
  });

  it("is never claimed, made ready or put back by a run that started before the stop", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic.mockResolvedValue(PLANNED);
    const db = fakeDb({ calendar_plans: [plan], clients: [CLIENT] });
    const guarded: string[] = [];
    const from = db.from.bind(db);
    // Every write to the plan names the stop in its filter, so the database leaves a stopped plan as it is.
    db.from = (table: string) => {
      const q = from(table);
      if (table !== "calendar_plans") return q;
      const update = q.update;
      q.update = (value: unknown) => {
        const chain = update(value);
        const neq = chain.neq;
        let named = false;
        chain.neq = (column: string, v: unknown) => { if (column === "status" && v === "canceled") named = true; return neq(column, v); };
        const then = chain.then;
        chain.then = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => { guarded.push(`${JSON.stringify(Object.keys(value as object))}:${named}`); return then(ok, fail); };
        return chain;
      };
      return q;
    };
    expect((await runWeekPlan(db, job(), NOW)).status).toBe("done");
    expect(guarded.length).toBeGreaterThan(0);
    expect(guarded.filter((g) => g.endsWith(":false"))).toEqual([]);
  });

  it("stops a revision waiting on a plan that was removed", async () => {
    const removed = { ...plan, status: "canceled", revisions: [], pending_revision: { note: "Less formal", by: "u1", at: "2026-10-19T07:00:00Z", scope: "untouched" } };
    const db = fakeDb({ calendar_plans: [removed], clients: [CLIENT], calendar_posts: [] });
    expect((await runWeekRevise(db, job({ kind: "week_revise" }), NOW)).status).toBe("skipped");
    expect(m.anthropic).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });

  it("writes no revision once the plan was removed during the model call", async () => {
    const ready = { ...plan, status: "ready", revisions: [], pending_revision: { note: "Less formal", by: "u1", at: "2026-10-19T07:00:00Z", scope: "untouched" } };
    const post = { id: "p1", post_key: "k1", post_date: "2026-10-27", platform: "Instagram", format: "Reel", pillar: null, copy: "Old copy", hashtags: [], cta: null, visual_direction: null, reasons: [], touched_at: null, plan_id: "plan-1" };
    m.anthropic.mockImplementation(async () => { ready.status = "canceled"; return { text: JSON.stringify({ posts: [{ id: "p1", copy: "New copy" }] }), raw: {} }; });
    const db = fakeDb({ calendar_plans: [ready], clients: [CLIENT], calendar_posts: [post] });
    expect((await runWeekRevise(db, job({ kind: "week_revise" }), NOW)).status).toBe("skipped");
    expect(db.writes.filter((w) => w.table === "calendar_posts")).toEqual([]);
    expect(planWrites(db).some((v) => "revisions" in v)).toBe(false);
  });
});

describe("a week's Stories", () => {
  const DAY = 86400_000;
  const weekly = Array.from({ length: 16 }, (_, i) => ({ postId: `p${i}`, channel: "instagram", type: "photo", publishedAt: new Date(NOW.getTime() - (i * 4 + 3) * DAY).toISOString(), message: "A post", engagementTotal: 3 }));
  // 26 Instagram Stories in the last 90 days: 2 a week.
  const stories = Array.from({ length: 26 }, (_, i) => ({ channel: "instagram", publishedAt: new Date(NOW.getTime() - (1 + i * 3) * DAY).toISOString() }));
  const client = { ...CLIENT, posting_rhythm: { instagram: 3, facebook: 1 } };
  const reply = { posts: [
    { date: "2026-10-29", platform: "Instagram", format: "Carousel", posting_time: "17:00", copy: "Thursday post", reason_type: "performance", evidence_ids: [] },
    { date: "2026-10-27", platform: "Instagram", format: "Reel", posting_time: "17:00", copy: "Tuesday post", reason_type: "performance", evidence_ids: [] },
    { date: "2026-10-28", platform: "Instagram", format: "Story", posting_time: "12:00", copy: "Wednesday post", reason_type: "performance", evidence_ids: [] },
    { date: "2026-10-26", platform: "Facebook", format: "Image", posting_time: "9:00", copy: "Facebook post", reason_type: "performance", evidence_ids: [] },
  ] };
  const inserted = (db: ReturnType<typeof fakeDb>) => db.writes.find((w) => w.table === "calendar_posts" && w.op === "insert")?.value as Array<Record<string, unknown>>;

  it("adds Stories to the soonest Instagram posts, as many as the client's own Stories a week, with no extra model call", async () => {
    m.owned.mockResolvedValue({ coverage: "complete", profiles: [{ network: "instagram" }], posts: weekly, stories });
    m.anthropic.mockResolvedValue({ text: JSON.stringify(reply), raw: {} });
    const db = fakeDb({ calendar_plans: [plan], clients: [client] });
    expect((await runWeekPlan(db, job(), NOW)).status).toBe("done");
    expect(m.anthropic).toHaveBeenCalledTimes(1);
    expect(m.owned.mock.calls[0][3]).toEqual({ fields: ["is_boosted"], stories: true });
    const rows = inserted(db);
    const made = rows.filter((r) => r.format === "Story");
    // Tuesday's and Wednesday's posts are the soonest on Instagram; the model's Story is a single image.
    expect(made.map((r) => r.copy)).toEqual(["Tuesday post", "Wednesday post"]);
    expect(rows.find((r) => r.copy === "Wednesday post" && r.format !== "Story")?.format).toBe("image");
    for (const st of made) {
      expect(rows.find((r) => r.post_key === st.story_of)).toMatchObject({ copy: st.copy, post_date: st.post_date, platform: "Instagram" });
      expect(st).toMatchObject({ plan_id: "plan-1", client_id: "ptp", source: "plan", reasons: [{ type: "story", label: "Pay The Pyper posted 26 Instagram Stories in the last 90 days." }] });
    }
    const ready = db.writes.filter((w) => w.table === "calendar_plans" && w.op === "update").map((w) => w.value as Record<string, unknown>).find((v) => v.status === "ready");
    expect((ready?.rhythm as Record<string, unknown>).stories).toEqual({ stories: 26, average: 2.02, perWeek: 2 });
  });

  // Lital, 3 Nov 2026 (decision 3): every Instagram client gets Stories; only its own Story history sets another rate.
  it("gives a client that posted no Story in 90 days one Story with each Instagram post, and never on Facebook", async () => {
    m.owned.mockResolvedValue({ coverage: "complete", profiles: [{ network: "instagram" }], posts: weekly, stories: [] });
    m.anthropic.mockResolvedValue({ text: JSON.stringify(reply), raw: {} });
    const db = fakeDb({ calendar_plans: [plan], clients: [client] });
    await runWeekPlan(db, job(), NOW);
    const made = inserted(db).filter((r) => r.format === "Story");
    expect(made.map((r) => r.copy).sort()).toEqual(["Thursday post", "Tuesday post", "Wednesday post"]);
    expect(made.every((r) => r.platform === "Instagram")).toBe(true);
    for (const st of made) expect(st.reasons).toEqual([{ type: "story", label: "One Story with each Instagram post." }]);
    expect(m.anthropic).toHaveBeenCalledTimes(1);
  });

  it("leaves Stories already on the calendar out of the week's feed posts", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic.mockResolvedValue({ text: JSON.stringify({ posts: [{ date: "2026-10-27", platform: "Instagram", copy: "The one Instagram post", reason_type: "performance", evidence_ids: [] }] }), raw: {} });
    const existingStory = { post_date: "2026-10-27", platform: "Instagram", format: "Story", copy: "A Story someone added", plan_id: null };
    const db = fakeDb({ calendar_plans: [plan], clients: [{ ...CLIENT, posting_rhythm: { instagram: 1, facebook: 0 } }], calendar_posts: [existingStory] });
    // The week has nothing written yet: only the posts around it are read back.
    const from = db.from.bind(db);
    db.from = (table: string) => {
      const q = from(table);
      if (table === "calendar_posts") q.select = (_cols: string, opts?: { head?: boolean }) => { if (opts?.head) q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null, count: 0 }).then(ok); return q; };
      return q;
    };
    expect((await runWeekPlan(db, job(), NOW)).status).toBe("done");
    expect(m.anthropic.mock.calls[0][0].body.messages[0].content).not.toContain("A Story someone added");
    expect(inserted(db).filter((r) => r.format !== "Story").map((r) => r.copy)).toEqual(["The one Instagram post"]);
    // Sprout does not read this client: its Instagram post gets one Story.
    expect(inserted(db).filter((r) => r.format === "Story").map((r) => r.copy)).toEqual(["The one Instagram post"]);
  });
});

describe("gatherEvidence hashtags", () => {
  const row = (platform: string, term: string, source: string, removed_at: string | null = null) => ({ client_id: "ptp", kind: "hashtag", platform, term, reason: "r", source, removed_at });

  it("gives each platform's active hashtags with the team's own first, the rest in term order, removed ones left out, at most 10", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    const life = Array.from({ length: 12 }, (_, i) => row("tiktok", `#life${i + 1}`, "lifecycle"));
    const db = fakeDb({
      clients: [CLIENT],
      trend_terms: [
        row("instagram", "#ig1", "lifecycle"), row("instagram", "#igTeam", "person"), row("instagram", "#igGone", "lifecycle", "2026-10-20T00:00:00Z"),
        life[0], life[1], row("tiktok", "#tkTeamA", "person"), ...life.slice(2), row("tiktok", "#tkTeamB", "person"),
        row("linkedin", "#li1", "lifecycle"), row("linkedin", "#liGone", "person", "2026-10-21T00:00:00Z"),
      ],
    });
    const got = await gatherEvidence(db, CLIENT, NOW, { week: "2026-10-26" });
    expect(got.hashtags.instagram).toEqual(["#igTeam", "#ig1"]);
    expect(got.hashtags.tiktok).toEqual(["#tkTeamA", "#tkTeamB", ...life.slice(0, 8).map((r) => r.term)]);
    expect(got.hashtags.linkedin).toEqual(["#li1"]);
  });

  it("is empty for every platform when the client has no trend profile", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    const got = await gatherEvidence(fakeDb({ clients: [CLIENT] }), CLIENT, NOW, { week: "2026-10-26" });
    expect(got.hashtags).toEqual({ instagram: [], tiktok: [], linkedin: [] });
  });
});

describe("gatherEvidence fallback rates", () => {
  it("hands over the rhythm's fallbacks: the tracked competitors' median per platform, and every tracked company's once read", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    const tok = (i: number) => ({ postId: `t${i}`, companyId: "9", companyName: "BenchApp", channel: "tiktok", publishedAt: `2026-10-0${i + 5}T12:00:00Z`, message: "A post", engagementTotal: 5 });
    const posts = [0, 1, 2, 3].map(tok);
    const snapshot = {
      client_id: "ptp", fetched_at: "2026-10-18T00:00:00Z",
      payload: { window: { start: "2026-10-05", end: "2026-10-18" }, socialPosts: posts },
      feed_window: { start: "2026-10-05", end: "2026-10-18" }, client_company_id: null, posts,
    };
    const db = fakeDb({ clients: [CLIENT], rivaliq_snapshots: [snapshot], competitor_sets: [{ id: "s1" }], competitors: [{ name: "BenchApp", rivaliq_company_id: "9" }] });
    const got = await gatherEvidence(db, CLIENT, NOW, { week: "2026-10-26" });
    // Four TikTok posts over a two-week feed: two a week. The client posts nowhere, so its primary platforms needed every tracked company's rates too.
    expect(got.fallbackRates).toEqual({ competitors: { TikTok: 2 }, allTracked: { TikTok: 2 } });
  });

  it("leaves every tracked company's rates unread when the client's own posting gives each platform a rate", async () => {
    const weekly = Array.from({ length: 16 }, (_, i) => ({ postId: `p${i}`, channel: "instagram", type: "photo", publishedAt: new Date(NOW.getTime() - (i * 4 + 3) * 86400_000).toISOString(), message: "A post", engagementTotal: 3 }));
    m.owned.mockResolvedValue({ coverage: "complete", profiles: [{ network: "instagram" }], posts: weekly });
    const got = await gatherEvidence(fakeDb({ clients: [CLIENT] }), CLIENT, NOW, { week: "2026-10-26" });
    expect(got.fallbackRates).toEqual({ competitors: {}, allTracked: null });
  });
});

describe("runWeekRevise", () => {
  const ready = { ...plan, status: "ready", revisions: [], pending_revision: { note: "Less formal", by: "u1", at: "2026-10-19T07:00:00Z", scope: "untouched" } };
  const post = { id: "p1", post_key: "k1", post_date: "2026-10-27", platform: "Instagram", format: "Reel", pillar: null, copy: "Old copy", hashtags: [], cta: null, visual_direction: null, reasons: [], touched_at: null, plan_id: "plan-1" };

  it("keeps a revision that didn't finish waiting and tries it again later", async () => {
    m.anthropic.mockRejectedValue(new Error("Anthropic 500"));
    const db = fakeDb({ calendar_plans: [ready], clients: [CLIENT], calendar_posts: [post] });
    const out = await runWeekRevise(db, job({ kind: "week_revise", attempts: 3 }), NOW);
    expect(out).toMatchObject({ status: "queued", available_at: new Date(NOW.getTime() + 360 * 60_000).toISOString() });
    // The revision is still waiting: nothing recorded it as done or failed.
    expect(db.writes.some((w) => (w.value as { pending_revision?: unknown }).pending_revision === null)).toBe(false);
  });

  it("rewrites with the client's content strategy", async () => {
    m.anthropic.mockResolvedValue({ text: JSON.stringify({ posts: [{ id: "p1", copy: "New copy" }] }), raw: {} });
    const strategy = { client_id: "ptp", sections: { positioning: "Built around the captain's week." }, platforms: [], pillars: [], written_at: "2026-11-02T10:00:00Z" };
    const db = fakeDb({ calendar_plans: [ready], clients: [CLIENT], calendar_posts: [post], content_strategies: [strategy] });
    await runWeekRevise(db, job({ kind: "week_revise" }), NOW);
    expect(m.anthropic.mock.calls[0][0].body.messages[0].content).toContain("Built around the captain's week.");
  });

  // The rewrite client notes ask for has no person (client notes design,
  // section 9). It never touches a post a person approved, scheduled to
  // Sprout, had a design requested or made for, edited or moved: all of
  // those answer yes to calendar_post_worked (src/test/calendarPostWorked.test.ts).
  // Nor a post a person's own revision rewrote.
  describe("a rewrite nobody asked for", () => {
    const posts = [
      { ...post, id: "p1", post_key: "k1", copy: "Untouched copy" },
      { ...post, id: "p2", post_key: "k2", copy: "Copy from a person's revision" },
      { ...post, id: "p3", post_key: "k3", copy: "Copy someone worked on" },
    ];
    const earlier = [{ note: "Warmer", by: "u1", at: "2026-10-18T09:00:00Z", scope: "untouched", rewritten: 1, replaced: [{ id: "p2", copy: "Old copy" }] }];
    const run = async (by: string | null) => {
      m.anthropic.mockResolvedValue({ text: JSON.stringify({ posts: posts.map((p) => ({ id: p.id, copy: `New ${p.id}` })) }), raw: {} });
      const db = fakeDb({ calendar_plans: [{ ...ready, revisions: earlier, pending_revision: { note: "Follow what Pay The Pyper told the team in its newest notes.", by, at: "2026-10-19T07:00:00Z", scope: "untouched" } }], clients: [CLIENT], calendar_posts: posts });
      const asked: string[] = [];
      // calendar_post_worked says yes for k3 only.
      db.rpc = async (_name: string, args: { p_key: string }) => { asked.push(args.p_key); return { data: args.p_key === "k3", error: null }; };
      const out = await runWeekRevise(db, job({ kind: "week_revise" }), NOW);
      const prompt = m.anthropic.mock.calls[0][0].body.messages[0].content as string;
      const done = db.writes.find((w) => (w.value as { pending_revision?: unknown }).pending_revision === null)?.value as { revisions: Array<Record<string, unknown>> };
      return { out, prompt, asked, entry: done.revisions.at(-1)! };
    };

    it("rewrites only the posts nobody worked on, and keeps what a person's own revision rewrote", async () => {
      const { out, prompt, asked, entry } = await run(null);
      // k1 is asked again right before its rewrite is written (QA 22 Nov 2026: a design started during the call keeps its copy).
      expect(asked.sort()).toEqual(["k1", "k1", "k2", "k3"]);
      // Only p1 is sent to be rewritten; the others are shown as the week's other posts.
      expect(prompt).toContain("- [p1] ");
      expect(prompt).not.toContain("- [p2] ");
      expect(prompt).not.toContain("- [p3] ");
      expect(entry.kept).toEqual(["p2", "p3"]);
      expect(out).toMatchObject({ status: "done", result: { rewritten: 1 } });
    });

    it("lets a person's own revision rewrite what an earlier one did", async () => {
      const { prompt, entry } = await run("u2");
      expect(prompt).toContain("- [p2] ");
      expect(prompt).not.toContain("- [p3] ");
      expect(entry.kept).toEqual(["p3"]);
    });
  });

  describe("a planned Story", () => {
    const feed = { ...post, id: "p1", post_key: "k1", platform: "Instagram", format: "Reel", copy: "Old copy", story_of: null };
    const story = { ...post, id: "s1", post_key: "k-story", platform: "Instagram", format: "Story", copy: "Old copy", story_of: "k1" };
    const run = async (workedKeys: string[]) => {
      m.anthropic.mockResolvedValue({ text: JSON.stringify({ posts: [{ id: "p1", copy: "New copy" }, { id: "s1", copy: "A Story rewritten as a feed post" }] }), raw: {} });
      const db = fakeDb({ calendar_plans: [ready], clients: [CLIENT], calendar_posts: [feed, story] });
      db.rpc = async (_name: string, args: { p_key: string }) => ({ data: workedKeys.includes(args.p_key), error: null });
      await runWeekRevise(db, job({ kind: "week_revise" }), NOW);
      const prompt = m.anthropic.mock.calls[0][0].body.messages[0].content as string;
      const updates = db.writes.filter((w) => w.table === "calendar_posts" && w.op === "update").map((w) => w.value as Record<string, unknown>);
      return { prompt, updates };
    };

    it("is never rewritten as a feed post, and follows its post's new copy when nobody worked on it", async () => {
      const { prompt, updates } = await run([]);
      expect(prompt).toContain("- [p1] ");
      expect(prompt).not.toContain("- [s1] ");
      expect(updates).toEqual([expect.objectContaining({ copy: "New copy", hashtags: [] }), { copy: "New copy" }]);
    });

    it("keeps its copy when someone worked on it", async () => {
      const { updates } = await run(["k-story"]);
      expect(updates).toEqual([expect.objectContaining({ copy: "New copy" })]);
    });
  });

  it("closes a revision quietly once its week is over", async () => {
    const db = fakeDb({ calendar_plans: [{ ...ready, week_start: "2026-10-05" }], clients: [CLIENT] });
    const out = await runWeekRevise(db, job({ kind: "week_revise", occurrence: "2026-10-05T00:00:00Z" }), NOW);
    expect(out.status).toBe("skipped");
    const closed = db.writes.find((w) => (w.value as { pending_revision?: unknown }).pending_revision === null)?.value as { revisions: Array<Record<string, unknown>> };
    expect(closed.revisions.at(-1)).toMatchObject({ note: "Less formal", expired: true, rewritten: 0 });
    expect(closed.revisions.at(-1)).not.toHaveProperty("failed");
  });
});

describe("retryWait", () => {
  it("waits 10 minutes, an hour, six hours, then a day", () => {
    expect([1, 2, 3, 4, 12].map((n) => retryWait(n) / 60_000)).toEqual([10, 60, 360, 1440, 1440]);
    expect(retryWait(0)).toBe(10 * 60_000);
  });
});

describe("runVoiceProfile", () => {
  const prefs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
  const run = () => runVoiceProfile(fakeDb({ clients: [CLIENT] }), job({ kind: "voice_profile" }), NOW);

  it("merges the preference memory when it has more than eight active entries", async () => {
    m.owned.mockResolvedValue({ coverage: "complete", profiles: [], posts: [] });
    m.buildVoiceProfile.mockResolvedValue({ post_count: 4, platforms: { Instagram: {} } });
    m.activePreferences.mockResolvedValue(prefs(9));
    m.consolidateMemory.mockResolvedValue({ before: 9, after: 5 });
    expect(await run()).toMatchObject({ status: "done", result: { memory: { before: 9, after: 5 } } });
    m.activePreferences.mockResolvedValue(prefs(8));
    await run();
    expect(m.consolidateMemory).toHaveBeenCalledTimes(1);
  });

  it("never fails the voice job when the merge fails", async () => {
    m.owned.mockResolvedValue({ coverage: "complete", profiles: [], posts: [] });
    m.buildVoiceProfile.mockResolvedValue({ post_count: 4, platforms: {} });
    m.activePreferences.mockResolvedValue(prefs(12));
    m.consolidateMemory.mockRejectedValue(new Error("The memory merge returned nothing usable; nothing was changed."));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await run()).status).toBe("done");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("the report findings a week is planned from (report insights, 3 Nov 2026)", () => {
  it("reads a report's checked insights and recommendations when it has them, and its own fields otherwise, field by field", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    const ai = { sprout_performance_analysis: { key_insights: ["The model's own insight."], pillar_alignment: { recommendations: ["The model's own recommendation."] } }, competitive_takeaways: ["Rival Co posts a Reel a day."] };
    const report = { id: "r9", created_at: "2026-11-09T00:00:00Z", report_data: [{ ai_analysis: ai }] };
    const insights = { report_table: "reports", report_id: "r9", confirmed_at: "2026-11-09T01:00:00Z", facts: [], fields: { kind: "social", summary: null, insights: [{ text: "Impressions rose 26.5% to 12,400.", facts: ["F1"] }], recommendations: [{ text: "Post the next video on LinkedIn.", facts: ["F3"] }] } };
    const reportFindings = async (tables: Record<string, unknown[]>) => (await gatherEvidence(fakeDb({ clients: [CLIENT], reports: [report], ...tables }), CLIENT, NOW)).evidence.filter((e) => e.kind === "report").map((e) => e.text);
    // The insights carry no takeaways: the report's own stay.
    expect(await reportFindings({ report_insights: [insights] })).toEqual(["Impressions rose 26.5% to 12,400.", "Post the next video on LinkedIn.", "Rival Co posts a Reel a day."]);
    // Code wrote no recommendations (the facts in its own words): the report's own stay.
    expect(await reportFindings({ report_insights: [{ ...insights, fields: { ...insights.fields, recommendations: null } }] })).toEqual(["Impressions rose 26.5% to 12,400.", "The model's own recommendation.", "Rival Co posts a Reel a day."]);
    expect(await reportFindings({})).toEqual(["The model's own insight.", "The model's own recommendation.", "Rival Co posts a Reel a day."]);
  });

  it("plans from the report's own fields when its insights can't be read, and never fails for them", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const report = { id: "r9", created_at: "2026-11-09T00:00:00Z", report_data: [{ ai_analysis: { sprout_performance_analysis: { key_insights: ["The model's own insight."] } } }] };
    const base = fakeDb({ clients: [CLIENT], reports: [report] });
    const db = { ...base, from: (table: string) => (table === "report_insights" ? (() => { throw new Error("relation report_insights does not exist"); })() : base.from(table)) };
    const gathered = await gatherEvidence(db, CLIENT, NOW);
    expect(gathered.evidence.filter((e) => e.kind === "report").map((e) => e.text)).toEqual(["The model's own insight."]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// Copy sources, 17 Nov 2026. Every brand and person below is invented.
describe("display names the client's Sprout account lists with decorations", () => {
  const NORTHWIND = { id: "nw", name: "Northwind Law", timezone: "UTC", primary_platforms: ["LinkedIn", "Facebook"], posting_rhythm: null, content_pillars: [], geo: "US", language: "en" };
  const NAMES = [{ name: "Dana Reed ★★★★★", plain: "Dana Reed" }, { name: "Harbor Wax - Smooth Skin Studio", plain: "Harbor Wax" }];
  // What the accounts step stores: each decorated name with its plain form. Anything else in the list is not a name.
  const STEP = { client_id: "nw", step: "accounts", result: { display_names: [...NAMES, "Dana Reed ★★★★★", 7, { name: "no plain form" }] } };
  /** The client's rows as the one-account rule leaves them: one parked on each of two days, one that stays, one a person switched off. */
  const ROWS = [
    { client_id: "nw", sprout_profile_id: 1, is_active: false, parked_at: "2026-11-14T09:00:00.000Z" }, { client_id: "nw", sprout_profile_id: 2, is_active: false, parked_at: "2026-11-16T09:00:00.000Z" },
    { client_id: "nw", sprout_profile_id: 3, is_active: true, parked_at: null }, { client_id: "nw", sprout_profile_id: 4, is_active: false, parked_at: null },
    // Added back by a person: active, with its record still on it. Not a parked account now.
    { client_id: "nw", sprout_profile_id: 5, is_active: true, parked_at: "2026-11-17T09:00:00.000Z" },
  ];
  const sproutPost = { postId: "s1", channel: "linkedin", type: "photo", publishedAt: "2026-11-10T12:00:00Z", message: "Welcome Dana Reed ★★★★★ to the firm.", engagementTotal: 9 };
  // A platform Sprout does not cover for this client, from the weekly feed.
  const feed = [{ payload: { client_company_id: "77", socialPosts: [
    { postId: "f1", companyId: "77", companyName: "Northwind Law", channel: "facebook", type: "photo", publishedAt: "2026-11-11T12:00:00Z", message: "Lunch with Harbor Wax - Smooth Skin Studio today.", engagementTotal: 4 },
    { postId: "f2", companyId: "88", companyName: "Another Firm", channel: "facebook", type: "photo", publishedAt: "2026-11-11T12:00:00Z", message: "Not the client's.", engagementTotal: 4 },
  ] } }];
  const AT = new Date("2026-11-17T07:15:00Z");

  it("reads the names the accounts step stored, pairs only, and the last time an account was parked from the parked rows", async () => {
    expect(await accountsFacts(fakeDb({ client_lifecycle_steps: [STEP], sprout_profiles: ROWS }), "nw")).toEqual({ names: NAMES, ownDroppedAt: "2026-11-16T09:00:00.000Z" });
    expect(await accountsFacts(fakeDb({}), "nw")).toEqual({ names: [], ownDroppedAt: null });
    expect(await accountsFacts(fakeDb({ client_lifecycle_steps: [{ client_id: "nw", step: "accounts", result: { display_names: "x" } }], sprout_profiles: [{ client_id: "nw", is_active: false, parked_at: "not a date" }] }), "nw")).toEqual({ names: [], ownDroppedAt: null });
  });

  // The parked time must not depend on the step's stored result: a failed run clears it.
  it("still knows when an account was parked when the accounts step's result is gone, and still knows the names when the rows cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await accountsFacts(fakeDb({ client_lifecycle_steps: [{ client_id: "nw", step: "accounts", result: null }], sprout_profiles: ROWS }), "nw")).toEqual({ names: [], ownDroppedAt: "2026-11-16T09:00:00.000Z" });
    expect(await accountsFacts(fakeDb({ sprout_profiles: ROWS }), "nw")).toEqual({ names: [], ownDroppedAt: "2026-11-16T09:00:00.000Z" });
    expect(warn).not.toHaveBeenCalled();
    const base = fakeDb({ client_lifecycle_steps: [STEP], sprout_profiles: ROWS });
    const rowsDown = { ...base, from: (table: string) => (table === "sprout_profiles" ? (() => { throw new Error("gone"); })() : base.from(table)) };
    expect(await accountsFacts(rowsDown, "nw")).toEqual({ names: NAMES, ownDroppedAt: null });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("writes them plainly in the client's own posts, from Sprout and from the feed", async () => {
    m.owned.mockResolvedValue({ coverage: "complete", profiles: [{ network: "linkedin" }], posts: [sproutPost] });
    const got = await ownPosts(fakeDb({ client_lifecycle_steps: [STEP] }), NORTHWIND, feed, AT);
    expect(got.posts.map((p) => [p.id, p.platform, p.text])).toEqual([
      ["s1", "LinkedIn", "Welcome Dana Reed to the firm."],
      ["f1", "Facebook", "Lunch with Harbor Wax today."],
    ]);
    expect(got.names).toEqual(NAMES);
  });

  it("leaves the posts as they were when the step's row cannot be read, and warns", async () => {
    m.owned.mockResolvedValue({ coverage: "complete", profiles: [{ network: "linkedin" }], posts: [sproutPost] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const base = fakeDb({ client_lifecycle_steps: [STEP] });
    // deno-lint-ignore no-explicit-any
    const failing: any = { select: () => failing, eq: () => failing, maybeSingle: async () => ({ data: null, error: { message: "permission denied" } }) };
    const db = { ...base, from: (table: string) => (table === "client_lifecycle_steps" ? failing : base.from(table)) };
    const got = await ownPosts(db, NORTHWIND, feed, AT);
    expect(got.posts.map((p) => p.text)).toEqual(["Welcome Dana Reed ★★★★★ to the firm.", "Lunch with Harbor Wax - Smooth Skin Studio today."]);
    expect(got.names).toEqual([]);
    expect(warn).toHaveBeenCalled();
    // A read that throws is the same: no change.
    const thrown = { ...base, from: (table: string) => (table === "client_lifecycle_steps" ? (() => { throw new Error("gone"); })() : base.from(table)) };
    expect((await ownPosts(thrown, NORTHWIND, feed, AT)).posts[0].text).toBe("Welcome Dana Reed ★★★★★ to the firm.");
    warn.mockRestore();
  });

  it("hands the names to the voice profile, so what it stores is plain too", async () => {
    m.owned.mockResolvedValue({ coverage: "complete", profiles: [{ network: "linkedin" }], posts: [sproutPost] });
    m.buildVoiceProfile.mockResolvedValue({ post_count: 1, platforms: {} });
    m.activePreferences.mockResolvedValue([]);
    const db = fakeDb({ clients: [NORTHWIND], client_lifecycle_steps: [STEP] });
    expect((await runVoiceProfile(db, job({ kind: "voice_profile", client_id: "nw" }), AT)).status).toBe("done");
    const [, clientId, posts, , opts] = m.buildVoiceProfile.mock.calls[0];
    expect(clientId).toBe("nw");
    expect(posts.map((p: { text: string }) => p.text)).toEqual(["Welcome Dana Reed to the firm."]);
    expect(opts).toEqual({ names: NAMES, by: { actor: "schedule", executionId: expect.any(String) } });
  });

  it("saves a planned post and a rewritten post with the names written plainly", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic.mockResolvedValue({ text: JSON.stringify({ posts: [{ date: "2026-11-24", platform: "LinkedIn", copy: "Five years of Dana Reed ★★★★★ at Northwind.", cta: "Meet Dana Reed ★★★★★", reason_type: "performance", evidence_ids: [] }] }), raw: {} });
    const weekPlan = { id: "plan-nw", client_id: "nw", week_start: "2026-11-23", status: "queued", requested_by: null, moments: { kept: [], dropped: [] } };
    const db = fakeDb({ calendar_plans: [weekPlan], clients: [NORTHWIND], client_lifecycle_steps: [STEP] });
    expect((await runWeekPlan(db, job({ client_id: "nw", occurrence: "2026-11-23T00:00:00Z" }), AT)).status).toBe("done");
    const inserted = db.writes.find((w) => w.table === "calendar_posts" && w.op === "insert")?.value as Array<Record<string, unknown>>;
    expect(inserted[0]).toMatchObject({ copy: "Five years of Dana Reed at Northwind.", cta: "Meet Dana Reed" });

    m.anthropic.mockResolvedValue({ text: JSON.stringify({ posts: [{ id: "p1", copy: "Thank you, Dana Reed ★★★★★." }] }), raw: {} });
    const ready = { ...weekPlan, status: "ready", revisions: [], pending_revision: { note: "Warmer", by: "u1", at: "2026-11-17T07:00:00Z", scope: "untouched" } };
    const post = { id: "p1", post_key: "k1", post_date: "2026-11-24", platform: "LinkedIn", format: "image", pillar: null, copy: "Old copy", hashtags: [], cta: null, visual_direction: null, reasons: [], touched_at: null, plan_id: "plan-nw" };
    const revise = fakeDb({ calendar_plans: [ready], clients: [NORTHWIND], calendar_posts: [post], client_lifecycle_steps: [STEP] });
    expect((await runWeekRevise(revise, job({ kind: "week_revise", client_id: "nw", occurrence: "2026-11-23T00:00:00Z" }), AT)).status).toBe("done");
    expect(revise.writes.filter((w) => w.table === "calendar_posts" && w.op === "update").map((w) => (w.value as { copy: string }).copy)).toEqual(["Thank you, Dana Reed."]);
  });
});

// Copy sources, 17 Nov 2026: an outside post gives the subject only, and every post is checked
// before it is saved. Every company, person and caption below is invented.
describe("the copy checks in a run", () => {
  const LEDGER = { id: "led", name: "Ledger Lane", timezone: "UTC", primary_platforms: ["LinkedIn"], posting_rhythm: { linkedin: 3 }, content_pillars: [{ name: "Month-end" }], geo: "US", language: "en", website_url: "https://www.ledgerlane.example/" };
  // Longer than the 220 characters a piece of evidence keeps of a post.
  const CAPTION = "New video: how a small firm closed its books in three days instead of three weeks. 0:00 Why month-end drags 1:45 The checklist we use 4:10 What to automate first 7:30 Questions from owners. Hosted by Priya Nand, with every template we mention linked in the first comment below.";
  const trends = {
    trend_weeks: [{ id: "w1", week_start: "2026-10-19", status: "done" }],
    trend_themes: [{ id: "th1", week_id: "w1", position: 0, title: "Month-end in days", post_ids: ["tp1"], dismissed_at: null, why_it_matters: "Owners lose a week to it.", angle: "Show the three habits." }],
    trend_posts: [{ id: "tp1", week_id: "w1", platform: "linkedin", url: "https://t/1", author: "@booksfast", text: CAPTION, lesson: "A number in the first line earns the click.", posted_at: "2026-10-14T09:00:00+00:00", format: "long_video", fit: 88, engagement: 5400, likes: 4000, comments: 300, shares: 20, kept: true, tripwire: false }],
  };
  const weekPlan = { id: "plan-led", client_id: "led", week_start: "2026-10-26", status: "queued", requested_by: null, moments: { kept: [], dropped: [] } };
  const planJob = () => job({ client_id: "led" });
  const CLEAN = { date: "2026-10-27", platform: "LinkedIn", format: "text", copy: "Three habits keep our clients' numbers ready by day three.", reason_type: "trend", evidence_ids: ["N1"], fit: "Owners want their week back." };
  const RETOLD = { date: "2026-10-28", platform: "LinkedIn", format: "text", copy: "Here is how a small firm closed its books in three days.\nStep by step.", reason_type: "trend", evidence_ids: ["N1"], fit: "Owners want their week back." };
  const CHAPTERS = { date: "2026-10-28", platform: "LinkedIn", format: "video", copy: "Our walkthrough.\n0:00 Intro\n2:10 The close", reason_type: "performance", evidence_ids: [] };
  const SECOND = { date: "2026-10-29", platform: "LinkedIn", format: "text", copy: "Reconcile weekly and month-end stops being an event.", reason_type: "performance", evidence_ids: [] };
  const reply = (...posts: unknown[]) => ({ text: JSON.stringify({ posts }), raw: { usage: { input_tokens: 100, output_tokens: 50 } } });
  const world = (extra: Record<string, unknown[]> = {}) => fakeDb({ calendar_plans: [weekPlan], clients: [LEDGER], ...trends, ...extra });
  const readyOf = (db: ReturnType<typeof fakeDb>) => db.writes.filter((w) => w.table === "calendar_plans" && w.op === "update").map((w) => w.value as Record<string, unknown>).find((v) => v.status === "ready")!;
  const insertedOf = (db: ReturnType<typeof fakeDb>) => (db.writes.find((w) => w.table === "calendar_posts" && w.op === "insert")?.value ?? []) as Array<Record<string, unknown>>;
  const promptOf = (call: number) => m.anthropic.mock.calls[call][0].body.messages[0].content as string;

  it("stamps the rules a plan was written under, and asks once when every post passes", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic.mockResolvedValue(reply(CLEAN, SECOND));
    const db = world();
    expect((await runWeekPlan(db, planJob(), NOW)).status).toBe("done");
    expect(m.anthropic).toHaveBeenCalledTimes(1);
    const evidence = readyOf(db).evidence as Record<string, unknown>;
    expect(evidence.rules).toBe(1);
    expect(evidence).not.toHaveProperty("dropped_copy");
    expect(insertedOf(db).map((r) => r.copy)).toEqual([CLEAN.copy, SECOND.copy]);
    // The planner read the trend in the team's words, never its caption or its author.
    expect(promptOf(0)).toContain('Theme "Month-end in days". Why it matters: Owners lose a week to it. Angle for Ledger Lane: Show the three habits.\nN1 [LinkedIn long_video, 2026-10-14] Lesson: A number in the first line earns the click.');
    for (const hidden of ["closed its books", "Priya Nand", "@booksfast", "0:00"]) expect(promptOf(0)).not.toContain(hidden);
    // The whole caption is kept for the check only: the plan stores the excerpt it always stored, and no list of outside posts.
    expect(CAPTION.length).toBeGreaterThan(220);
    expect(JSON.stringify(readyOf(db))).not.toContain("linked in the first comment below");
    expect(evidence).not.toHaveProperty("outside");
  });

  it("asks once more for a refused post, with the kept posts as already on the calendar and without the outside post it borrowed from", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic.mockResolvedValueOnce(reply(CLEAN, RETOLD)).mockResolvedValueOnce(reply({ ...SECOND, test: true }));
    const db = world();
    const out = await runWeekPlan(db, planJob(), NOW);
    expect(out.status).toBe("done");
    expect(m.anthropic).toHaveBeenCalledTimes(2);
    expect(promptOf(0)).toContain("N1 [");
    expect(promptOf(0)).not.toContain("Already on the calendar this week");
    // The second prompt: the post that passed is on the calendar, and N1 is no longer offered.
    expect(promptOf(1)).toContain(`Already on the calendar this week (keep them; don't repeat their topics, and count them toward the platform's posts):\n- 2026-10-27 LinkedIn: ${CLEAN.copy}`);
    expect(promptOf(1)).not.toContain("N1 [");
    expect(promptOf(1)).not.toContain("Industry trends this week");
    expect(promptOf(1)).not.toContain("closed its books");
    expect(insertedOf(db).map((r) => r.copy)).toEqual([CLEAN.copy, SECOND.copy]);
    const evidence = readyOf(db).evidence as Record<string, unknown>;
    expect(evidence.rules).toBe(1);
    // The refused post was replaced: nothing is listed as dropped.
    expect(evidence).not.toHaveProperty("dropped_copy");
    // Both calls are counted.
    expect(readyOf(db)).toMatchObject({ input_tokens: 200, output_tokens: 100 });
  });

  // What the planner was given of the client's own material is what a post may point to (this client has pillars and no strategy).
  it("lets a post point to the pillars or the voice section the planner was given, and never to a strategy the client does not have", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic.mockResolvedValue(reply(
      { ...CLEAN, evidence_ids: [], copy: "Join our month-end clinic.", refers_to: { what: "event", evidence_id: "pillars" } },
      { ...SECOND, copy: "Download our close checklist.", refers_to: { what: "guide", evidence_id: "voice" } },
    ));
    const given = world();
    expect((await runWeekPlan(given, planJob(), NOW)).status).toBe("done");
    expect(m.anthropic).toHaveBeenCalledTimes(1);
    expect(insertedOf(given).map((r) => r.copy)).toEqual(["Join our month-end clinic.", "Download our close checklist."]);
    expect(promptOf(0)).toContain('or "notes", "pillars" or "voice" for the part');

    m.anthropic.mockReset();
    const pointing = { ...CLEAN, evidence_ids: [], copy: "Read our strategy page.", refers_to: { what: "page", evidence_id: "strategy" } };
    m.anthropic.mockResolvedValueOnce(reply(pointing, SECOND)).mockResolvedValue(reply(pointing));
    const notGiven = world();
    expect((await runWeekPlan(notGiven, planJob(), NOW)).status).toBe("done");
    expect(insertedOf(notGiven).map((r) => r.copy)).toEqual([SECOND.copy]);
    expect((readyOf(notGiven).evidence as Record<string, unknown>).dropped_copy).toEqual([{ date: "2026-10-27", platform: "LinkedIn", copy: "Read our strategy page.", why: "points to something the client's evidence does not show" }]);
  });

  it("drops a post refused twice, lists it on the plan, and never makes a third call", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic.mockResolvedValueOnce(reply(CLEAN, RETOLD)).mockResolvedValue(reply(CHAPTERS));
    const db = world();
    expect((await runWeekPlan(db, planJob(), NOW)).status).toBe("done");
    expect(m.anthropic).toHaveBeenCalledTimes(2);
    expect(insertedOf(db).map((r) => r.copy)).toEqual([CLEAN.copy]);
    const evidence = readyOf(db).evidence as Record<string, unknown>;
    expect(evidence.dropped_copy).toEqual([{ date: "2026-10-28", platform: "LinkedIn", copy: "Our walkthrough.", why: "lists video chapter times" }]);
    expect(evidence.rules).toBe(1);
  });

  it("lists the first refusal when the second reply holds nothing", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic.mockResolvedValueOnce(reply(CLEAN, RETOLD)).mockResolvedValue({ text: "Sorry, nothing more.", raw: {} });
    const db = world();
    expect((await runWeekPlan(db, planJob(), NOW)).status).toBe("done");
    expect(insertedOf(db).map((r) => r.copy)).toEqual([CLEAN.copy]);
    expect((readyOf(db).evidence as Record<string, unknown>).dropped_copy).toEqual([{ date: "2026-10-28", platform: "LinkedIn", copy: "Here is how a small firm closed its books in three days.", why: "shares wording with N1" }]);
  });

  it("asks a reply with nothing usable again as it was, and tries the week later when both calls give no post", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic.mockResolvedValueOnce({ text: "not json", raw: {} }).mockResolvedValueOnce(reply(CLEAN));
    const db = world();
    expect((await runWeekPlan(db, planJob(), NOW)).status).toBe("done");
    expect(m.anthropic).toHaveBeenCalledTimes(2);
    expect(promptOf(1)).toBe(promptOf(0));

    // Every post refused, twice: the week is tried again later, never saved with a refused post and never failed.
    m.anthropic.mockReset();
    m.anthropic.mockResolvedValue(reply(RETOLD));
    const refusedTwice = world();
    const out = await runWeekPlan(refusedTwice, planJob(), NOW);
    expect(out).toMatchObject({ status: "queued", reason: "The planner's reply had no usable posts." });
    expect(m.anthropic).toHaveBeenCalledTimes(2);
    expect(insertedOf(refusedTwice)).toEqual([]);
    // The second call no longer offered the outside post the first reply borrowed from.
    expect(promptOf(1)).not.toContain("N1 [");
  });

  it("counts the client's own handles, its own posts and its own site as its own", async () => {
    const ownPost = { postId: "o1", channel: "linkedin", type: "photo", publishedAt: new Date(NOW.getTime() - 5 * 86400_000).toISOString(), message: "Our partner @tallybooks made this possible. Book a call at calendly.example/ledgerlane", engagementTotal: 9 };
    m.owned.mockResolvedValue({ coverage: "complete", profiles: [{ network: "linkedin" }], posts: [ownPost] });
    m.anthropic.mockResolvedValue(reply(
      { ...CLEAN, copy: "Thanks to @tallybooks and @ledger.lane for the push. More at ledgerlane.example and calendly.example/ledgerlane", evidence_ids: [] },
      { ...SECOND, copy: "Follow @ledgerlane_official for the weekly close." },
    ));
    const db = world({ sprout_profiles: [{ client_id: "led", native_name: "@Ledger.Lane", is_active: true }], client_public_profiles: [{ client_id: "led", handle: "ledgerlane_official", source: "website" }] });
    expect((await runWeekPlan(db, planJob(), NOW)).status).toBe("done");
    expect(m.anthropic).toHaveBeenCalledTimes(1);
    expect(insertedOf(db)).toHaveLength(2);
  });

  describe("in a revision", () => {
    const stored = { type: "trend", label: "x", evidence: [{ id: "N1", kind: "trend", text: "New video: how a small firm closed its books in three days instead of three weeks.", company: "@booksfast", theme: "Month-end in days", platform: "LinkedIn", format: "long_video" }], test: false };
    const post = (id: string, copy: string, over: Record<string, unknown> = {}) => ({ id, post_key: `k-${id}`, post_date: "2026-10-27", platform: "LinkedIn", format: "text", pillar: null, copy, hashtags: [], cta: null, visual_direction: null, reasons: [stored], touched_at: null, plan_id: "plan-led", story_of: null, ...over });
    const revising = (scope: string, by: string | null = "u1") => ({ ...weekPlan, status: "ready", revisions: [], pending_revision: { note: "Shorter", by, at: "2026-10-19T07:00:00Z", scope } });
    const reviseJob = () => job({ kind: "week_revise", client_id: "led" });
    const entryOf = (db: ReturnType<typeof fakeDb>) => (db.writes.find((w) => (w.value as { pending_revision?: unknown }).pending_revision === null)?.value as { revisions: Array<Record<string, unknown>> }).revisions.at(-1)!;
    const updatesOf = (db: ReturnType<typeof fakeDb>) => db.writes.filter((w) => w.table === "calendar_posts" && w.op === "update").map((w) => (w.value as { copy: string }).copy);

    it("finishes when every post is refused, records why, and leaves the posts as they were", async () => {
      m.anthropic.mockResolvedValue(reply({ id: "p1", copy: "How a small firm closed its books in three days, shorter." }, { id: "p2", copy: "Chapters:\n0:00 Intro\n1:20 The close" }));
      const db = fakeDb({ calendar_plans: [revising("untouched", null)], clients: [LEDGER], calendar_posts: [post("p1", "Old copy one"), post("p2", "Old copy two")] });
      const out = await runWeekRevise(db, reviseJob(), NOW);
      expect(out).toMatchObject({ status: "done", result: { rewritten: 0 } });
      // A rewrite from a note is one call: nothing is asked again.
      expect(m.anthropic).toHaveBeenCalledTimes(1);
      expect(updatesOf(db)).toEqual([]);
      expect(entryOf(db)).toMatchObject({ rewritten: 0, scope: "untouched", refused: [{ id: "p1", why: "shares wording with N1", kind: "borrowed" }, { id: "p2", why: "lists video chapter times", kind: "chapters" }] });
      // The prompt says why each post is planned by its subject, never by who posted the outside post.
      expect(promptOf(0)).toContain('Why it\'s planned: Trend theme "Month-end in days"');
      expect(promptOf(0)).not.toContain("@booksfast");
    });

    it("still tries a reply that held no post at all again later", async () => {
      m.anthropic.mockResolvedValue({ text: "not json", raw: {} });
      const db = fakeDb({ calendar_plans: [revising("untouched")], clients: [LEDGER], calendar_posts: [post("p1", "Old copy one")] });
      expect(await runWeekRevise(db, reviseJob(), NOW)).toMatchObject({ status: "queued", reason: "The rewrite's reply had no usable posts." });
    });

    it("lets a rewrite keep a link and a handle its post already carried, and records no refusal", async () => {
      m.anthropic.mockResolvedValue(reply({ id: "p1", copy: "Shorter: register at eventhall.io/close with @tallybooks." }));
      const db = fakeDb({ calendar_plans: [revising("untouched")], clients: [LEDGER], calendar_posts: [post("p1", "Join the month-end clinic. Register at eventhall.io/close with our partner @tallybooks.", { reasons: [] })] });
      expect(await runWeekRevise(db, reviseJob(), NOW)).toMatchObject({ status: "done", result: { rewritten: 1 } });
      expect(entryOf(db)).not.toHaveProperty("refused");
    });

    // A person's note is the person's instruction: what they wrote in it is the client's own for that revision.
    describe("a person's note", () => {
      const NOTE = "Add the sign-up link eventhall.io/close and thank @tallybooks";
      const noted = (by: string | null) => ({ ...revising("untouched", by), pending_revision: { note: NOTE, by, at: "2026-10-19T07:00:00Z", scope: "untouched" } });
      const plain = () => [post("p1", "Join the month-end clinic.", { reasons: [] }), post("p2", "Reconcile weekly.", { post_date: "2026-10-28", reasons: [] })];

      it("lets the rewrite use a link and a handle the person wrote in the note", async () => {
        m.anthropic.mockResolvedValue(reply({ id: "p1", copy: "Join the month-end clinic. Sign up at eventhall.io/close. Thanks, @tallybooks." }, { id: "p2", copy: "Reconcile weekly.", cta: "Sign up: https://www.eventhall.io/close" }));
        const db = fakeDb({ calendar_plans: [noted("u1")], clients: [LEDGER], calendar_posts: plain() });
        expect(await runWeekRevise(db, reviseJob(), NOW)).toMatchObject({ status: "done", result: { rewritten: 2 } });
        expect(updatesOf(db)).toEqual(["Join the month-end clinic. Sign up at eventhall.io/close. Thanks, @tallybooks.", "Reconcile weekly."]);
        expect(entryOf(db)).not.toHaveProperty("refused");
      });

      it("still keeps a post whose new copy carries a link or a handle the person did not write, and records which check it was", async () => {
        m.anthropic.mockResolvedValue(reply({ id: "p1", copy: "Sign up at eventhall.io/close." }, { id: "p2", copy: "Reconcile weekly. More at otherhall.io." }));
        const db = fakeDb({ calendar_plans: [noted("u1")], clients: [LEDGER], calendar_posts: plain() });
        expect(await runWeekRevise(db, reviseJob(), NOW)).toMatchObject({ status: "done", result: { rewritten: 1 } });
        expect(updatesOf(db)).toEqual(["Sign up at eventhall.io/close."]);
        expect(entryOf(db)).toMatchObject({ rewritten: 1, by: "u1", refused: [{ id: "p2", why: "links to otherhall.io, which is not the client's", kind: "link" }] });
      });

      it("is the only note that counts: the same words from the app's own run add nothing", async () => {
        m.anthropic.mockResolvedValue(reply({ id: "p1", copy: "Sign up at eventhall.io/close." }, { id: "p2", copy: "Thanks, @tallybooks." }));
        const db = fakeDb({ calendar_plans: [noted(null)], clients: [LEDGER], calendar_posts: plain() });
        expect(await runWeekRevise(db, reviseJob(), NOW)).toMatchObject({ status: "done", result: { rewritten: 0 } });
        expect(entryOf(db)).toMatchObject({ refused: [{ id: "p1", kind: "link" }, { id: "p2", kind: "handle" }] });
      });
    });

    it("asks once more for a refused post that is written fresh, for that post only and without the outside post it borrowed from", async () => {
      m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
      m.anthropic
        .mockResolvedValueOnce(reply({ id: "e1", copy: "Reconcile weekly.", evidence_ids: [] }, { id: "e2", copy: "See how a small firm closed its books in three days.", evidence_ids: ["N1"] }))
        .mockResolvedValueOnce(reply({ id: "e2", copy: "Close in days, not weeks: three habits.", evidence_ids: [] }, { id: "e1", copy: "Not asked for again" }));
      const db = fakeDb({ calendar_plans: [revising("empty", null)], clients: [LEDGER], ...trends, calendar_posts: [post("e1", "", { reasons: [] }), post("e2", "", { post_date: "2026-10-28", reasons: [] })] });
      expect(await runWeekRevise(db, reviseJob(), NOW)).toMatchObject({ status: "done", result: { rewritten: 2 } });
      expect(m.anthropic).toHaveBeenCalledTimes(2);
      expect(promptOf(0)).toContain("- [e1] ");
      expect(promptOf(0)).toContain("N1 [");
      // The second call: only the refused post, the first one's new copy among the week's other posts, and no N1.
      expect(promptOf(1)).toContain("- [e2] ");
      expect(promptOf(1)).not.toContain("- [e1] ");
      expect(promptOf(1)).toContain("- 2026-10-27 LinkedIn: Reconcile weekly.");
      expect(promptOf(1)).not.toContain("N1 [");
      expect(updatesOf(db)).toEqual(["Reconcile weekly.", "Close in days, not weeks: three habits."]);
      expect(entryOf(db)).toMatchObject({ rewritten: 2, input_tokens: 200, output_tokens: 100 });
      expect(entryOf(db)).not.toHaveProperty("refused");
    });

    it("leaves a post refused twice as it was, and lists it", async () => {
      m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
      m.anthropic.mockResolvedValue(reply({ id: "e2", copy: "See how a small firm closed its books in three days.", evidence_ids: ["N1"] }));
      const db = fakeDb({ calendar_plans: [revising("empty", null)], clients: [LEDGER], ...trends, calendar_posts: [post("e2", "", { reasons: [] })] });
      expect(await runWeekRevise(db, reviseJob(), NOW)).toMatchObject({ status: "done", result: { rewritten: 0 } });
      expect(m.anthropic).toHaveBeenCalledTimes(2);
      expect(updatesOf(db)).toEqual([]);
      expect(entryOf(db)).toMatchObject({ rewritten: 0, refused: [{ id: "e2", why: "shares wording with N1", kind: "borrowed" }] });
    });
  });
});

// Copy sources, 17 Nov 2026: the app writes again, by itself, the upcoming posts that were
// written from an outside post, carry time codes, or were planned before the client's accounts
// changed (scope "replan"). Every company and caption below is invented.
describe("a replan", () => {
  const TALLY = { id: "tal", name: "Tally Books", timezone: "UTC", primary_platforms: ["Instagram"], posting_rhythm: { instagram: 4 }, content_pillars: [{ name: "Month-end" }], geo: "US", language: "en" };
  const NOTE = "Write these posts again from the client's own material.";
  const trendRef = { id: "N1", kind: "trend", text: "New video: how a small firm closed its books in three days.", company: "@booksfast", theme: "Month-end in days", platform: "Instagram", format: "reel" };
  const fromTrend = [{ type: "trend", label: "x", evidence: [trendRef], test: false }];
  const fromOwn = [{ type: "performance", label: "x", evidence: [{ id: "P1", kind: "own", text: "Our checklist", platform: "Instagram", format: "carousel", multiple: 2, metric: "impressions" }], test: false }];
  const post = (id: string, copy: string, reasons: unknown, over: Record<string, unknown> = {}) => ({ id, post_key: `k-${id}`, post_date: "2026-10-27", platform: "Instagram", format: "image", pillar: "Month-end", copy, hashtags: ["#old"], cta: "Old cta", visual_direction: "Old visual", reasons, touched_at: null, plan_id: "plan-tal", story_of: null, ...over });
  const posts = () => [
    post("t1", "Borrowed from a trend.", fromTrend),
    post("o1", "From our own checklist.", fromOwn),
    post("c1", "Our walkthrough.\n0:00 Intro\n2:10 The close", fromOwn),
    post("w1", "Borrowed, then designed.", fromTrend),
    post("r1", "Borrowed, then rewritten by a person's revision.", fromTrend),
    post("s1", "Borrowed from a trend.", [{ type: "story", label: "One Story with each Instagram post." }], { format: "Story", story_of: "k-t1", hashtags: [] }),
  ];
  const earlier = [{ note: "Warmer", by: "u1", at: "2026-10-13T09:00:00Z", scope: "untouched", done_at: "2026-10-13T09:02:00Z", rewritten: 1, replaced: [{ id: "r1", copy: "Old" }] }];
  const planRow = (over: Record<string, unknown> = {}) => ({
    id: "plan-tal", client_id: "tal", week_start: "2026-10-26", status: "ready", requested_by: null, moments: { kept: [], dropped: [] }, ready_at: "2026-10-12T07:20:00Z",
    evidence: { items: [], sources: { trends: "themes" } }, revisions: earlier, pending_revision: { note: NOTE, by: null, at: "2026-10-19T07:00:00Z", scope: "replan" }, ...over,
  });
  const reviseJob = () => job({ kind: "week_revise", client_id: "tal" });
  const reply = (...ps: unknown[]) => ({ text: JSON.stringify({ posts: ps }), raw: { usage: { input_tokens: 10, output_tokens: 5 } } });
  const world = (plan: Record<string, unknown>, extra: Record<string, unknown[]> = {}) => {
    const db = fakeDb({ calendar_plans: [plan], clients: [TALLY], calendar_posts: posts(), ...extra });
    // calendar_post_worked says yes for the designed post only.
    db.rpc = async (_name: string, args: { p_key?: string }) => ({ data: args?.p_key === "k-w1", error: null });
    return db;
  };
  const planUpdate = (db: ReturnType<typeof fakeDb>) => db.writes.find((w) => (w.value as { pending_revision?: unknown }).pending_revision === null)?.value as { revisions: Array<Record<string, unknown>>; evidence?: Record<string, unknown> };
  const postUpdates = (db: ReturnType<typeof fakeDb>) => db.writes.filter((w) => w.table === "calendar_posts" && w.op === "update").map((w) => w.value as Record<string, unknown>);
  const promptOf = (call: number) => m.anthropic.mock.calls[call][0].body.messages[0].content as string;

  it("writes again only the posts with a reason to be, keeps what people worked on, rebuilds reasons, and stamps the plan", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic.mockResolvedValue(reply(
      { id: "t1", copy: "Three habits that close the month by day three.", cta: "Save this", hashtags: ["#monthend"], reason_type: "performance", evidence_ids: [], fit: "Owners want their week back." },
      { id: "c1", copy: "Our walkthrough of the close, start to finish.", evidence_ids: [] },
      { id: "o1", copy: "Not asked for" }, { id: "w1", copy: "Not asked for" }, { id: "r1", copy: "Not asked for" },
    ));
    const db = world(planRow());
    const out = await runWeekRevise(db, reviseJob(), NOW);
    expect(out).toMatchObject({ status: "done", result: { rewritten: 3 } });
    expect(m.anthropic).toHaveBeenCalledTimes(1);
    // The post written from a trend and the one with time codes are asked for; the client's own post, the worked one, the person's and the Story are not.
    const prompt = promptOf(0);
    for (const id of ["t1", "c1"]) expect(prompt).toContain(`- [${id}] `);
    for (const id of ["o1", "w1", "r1", "s1"]) expect(prompt).not.toContain(`- [${id}] `);
    // Its earlier copy and reason are left out, and the note is the replan's.
    expect(prompt).toContain(`The note: "${NOTE}"`);
    expect(prompt).toContain("Write each of these posts again from the evidence.");
    expect(prompt).not.toContain("Current copy:");
    expect(prompt).not.toContain("Why it's planned:");
    expect(prompt).not.toContain("Borrowed from a trend.");
    expect(prompt).not.toContain("0:00");
    // The posts it keeps are shown as the week's other posts.
    expect(prompt).toContain("- 2026-10-27 Instagram: From our own checklist.");
    const updates = postUpdates(db);
    expect(updates).toEqual([
      // Reasons are rebuilt from what the new copy cites: nothing outside any more.
      expect.objectContaining({ copy: "Three habits that close the month by day three.", cta: "Save this", hashtags: ["#monthend"], reasons: [expect.objectContaining({ type: "performance", fit: "Owners want their week back.", test: false })] }),
      expect.objectContaining({ copy: "Our walkthrough of the close, start to finish.", reasons: [expect.objectContaining({ type: "performance" })] }),
      // The Story follows its post's new copy.
      { copy: "Three habits that close the month by day three." },
    ]);
    expect(JSON.stringify(updates)).not.toContain("@booksfast");
    const done = planUpdate(db);
    expect(done.revisions.at(-1)).toMatchObject({ scope: "replan", by: null, note: NOTE, rewritten: 3, kept: ["w1", "r1"] });
    // What was replaced is kept on the revision, old copy and old reason.
    expect((done.revisions.at(-1)!.replaced as Array<Record<string, unknown>>).map((r) => [r.id, r.copy])).toEqual([["t1", "Borrowed from a trend."], ["c1", "Our walkthrough.\n0:00 Intro\n2:10 The close"], ["s1", "Borrowed from a trend."]]);
    expect((done.revisions.at(-1)!.replaced as Array<{ reasons: unknown }>)[0].reasons).toEqual(fromTrend);
    // The plan is under the current rules now, with the rest of what it stored kept.
    expect(done.evidence).toEqual({ items: [], sources: { trends: "themes" }, rules: 1 });
  });

  it("writes again every untouched post of a client whose own account was parked after the week was planned", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic.mockResolvedValue(reply({ id: "o1", copy: "New from our own." }));
    // The plan is under the current rules already; the parking came after it was made ready.
    // The record is on the parked row itself; the accounts step's result is not needed for it.
    const db = world(planRow({ evidence: { rules: 1 } }), { sprout_profiles: [{ client_id: "tal", sprout_profile_id: 10, is_active: false, parked_at: "2026-10-15T09:00:00.000Z" }] });
    await runWeekRevise(db, reviseJob(), NOW);
    const prompt = promptOf(0);
    for (const id of ["t1", "o1", "c1"]) expect(prompt).toContain(`- [${id}] `);
    for (const id of ["w1", "r1", "s1"]) expect(prompt).not.toContain(`- [${id}] `);

    // Parked before the week was planned: the week already followed it, and under the current rules nothing is left to write again.
    m.anthropic.mockClear();
    const followed = world(planRow({ evidence: { rules: 1 } }), { sprout_profiles: [{ client_id: "tal", sprout_profile_id: 10, is_active: false, parked_at: "2026-10-10T09:00:00.000Z" }] });
    expect(await runWeekRevise(followed, reviseJob(), NOW)).toMatchObject({ status: "done", result: { rewritten: 0 } });
    expect(m.anthropic).not.toHaveBeenCalled();
    // A replan with nothing to write still closes, and still stamps the plan.
    expect(planUpdate(followed).revisions.at(-1)).toMatchObject({ scope: "replan", rewritten: 0 });
    expect(planUpdate(followed).evidence).toEqual({ rules: 1 });
  });

  it("leaves a post refused twice with the copy it had, lists it, and does not ask for the week again", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic
      .mockResolvedValueOnce(reply({ id: "t1", copy: "Chapters:\n0:00 Intro\n1:20 The close" }, { id: "c1", copy: "Our walkthrough of the close, start to finish.", evidence_ids: [] }))
      .mockResolvedValueOnce(reply({ id: "t1", copy: "0:00 Still a chapter list" }));
    const db = world(planRow());
    expect(await runWeekRevise(db, reviseJob(), NOW)).toMatchObject({ status: "done", result: { rewritten: 1 } });
    expect(m.anthropic).toHaveBeenCalledTimes(2);
    // The second call asks for the refused post only.
    expect(promptOf(1)).toContain("- [t1] ");
    expect(promptOf(1)).not.toContain("- [c1] ");
    expect(postUpdates(db).map((u) => u.copy)).toEqual(["Our walkthrough of the close, start to finish."]);
    const done = planUpdate(db);
    expect(done.revisions.at(-1)).toMatchObject({ scope: "replan", rewritten: 1, refused: [{ id: "t1", why: "lists video chapter times", kind: "chapters" }] });
    expect(done.evidence).toMatchObject({ rules: 1 });
  });
});

describe("runVoiceProfile and the client's lifecycle", () => {
  const HARBOR = { id: "hw", name: "Harbor Wax", timezone: "UTC", primary_platforms: ["Instagram"], posting_rhythm: null, content_pillars: [], geo: "US", language: "en" };
  const voiceJob = () => job({ kind: "voice_profile", client_id: "hw" });
  it("has the lifecycle look at the client a minute after a profile is built, and never fails for a look that was not queued", async () => {
    m.owned.mockResolvedValue({ coverage: "complete", profiles: [], posts: [] });
    m.buildVoiceProfile.mockResolvedValue({ post_count: 4, platforms: {} });
    m.activePreferences.mockResolvedValue([]);
    const db = fakeDb({ clients: [HARBOR] });
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    db.rpc = async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data: null, error: null }; };
    const before = Date.now();
    expect((await runVoiceProfile(db, voiceJob(), NOW)).status).toBe("done");
    expect(calls).toEqual([{ name: "lifecycle_enqueue", args: { p_client: "hw", p_priority: 30, p_at: expect.any(String) } }]);
    const at = Date.parse(String(calls[0].args.p_at));
    expect(at).toBeGreaterThanOrEqual(before + 60_000);
    expect(at).toBeLessThanOrEqual(Date.now() + 60_000);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const refusing = fakeDb({ clients: [HARBOR] });
    refusing.rpc = async () => ({ data: null, error: { message: "permission denied" } }) as never;
    expect((await runVoiceProfile(refusing, voiceJob(), NOW)).status).toBe("done");
    const throwing = fakeDb({ clients: [HARBOR] });
    throwing.rpc = async () => { throw new Error("network"); };
    expect((await runVoiceProfile(throwing, voiceJob(), NOW)).status).toBe("done");
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("queues no look when the profile was not built", async () => {
    m.owned.mockResolvedValue({ coverage: "complete", profiles: [], posts: [] });
    m.buildVoiceProfile.mockRejectedValue(new Error("The voice profile reply could not be read."));
    const db = fakeDb({ clients: [HARBOR] });
    const calls: string[] = [];
    db.rpc = async (name: string) => { calls.push(name); return { data: null, error: null }; };
    expect((await runVoiceProfile(db, voiceJob(), NOW)).status).toBe("queued");
    expect(calls).toEqual([]);
  });
});
