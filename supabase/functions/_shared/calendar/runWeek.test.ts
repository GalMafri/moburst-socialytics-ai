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
vi.mock("../anthropic.ts", () => ({ anthropicMessages: m.anthropic }));
vi.mock("../competitive/ownedSource.ts", () => ({ collectOwnedCompetitive: m.owned }));
vi.mock("../voice/load.ts", async (original) => ({
  ...(await original<typeof import("../voice/load.ts")>()),
  loadClientVoice: async () => ({ brand: "Pay The Pyper", preferences: [], social: m.social, briefTone: null }),
  activePreferences: m.activePreferences,
  consolidateMemory: m.consolidateMemory,
  buildVoiceProfile: m.buildVoiceProfile,
}));

import { gatherEvidence, retryWait, runVoiceProfile, runWeekPlan, runWeekRevise, type WeekJob } from "./runWeek";

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
      for (const name of ["select", "eq", "neq", "in", "gte", "lte", "lt", "order", "limit", "not", "or", "range", "contains"]) q[name] = () => q;
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
const plan = { id: "plan-1", client_id: "ptp", week_start: "2026-10-26", status: "queued", requested_by: null };

afterEach(() => { vi.clearAllMocks(); m.social = null; });
afterAll(() => vi.unstubAllGlobals());

describe("runWeekPlan", () => {
  it("plans a client with no posts, no competitors and no setting, and never fails for want of a rhythm", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic.mockResolvedValue({ text: JSON.stringify({ posts: [{ date: "2026-10-27", platform: "Instagram", copy: "Captains, this one is for you.", reason_type: "seasonal", moment: "Playoffs start Oct 27", evidence_ids: [] }] }), raw: {} });
    const db = fakeDb({ calendar_plans: [plan], clients: [CLIENT] });
    const out = await runWeekPlan(db, job(), NOW);
    expect(out.reason ?? null).toBeNull();
    expect(out.status).toBe("done");
    const inserted = db.writes.find((w) => w.table === "calendar_posts" && w.op === "insert")?.value as Array<Record<string, unknown>>;
    expect(inserted).toHaveLength(1);
    expect(inserted[0].reasons).toEqual([expect.objectContaining({ type: "seasonal", moment: "Playoffs start Oct 27", test: false })]);
    // With no footage uploaded, the planner is told not to plan ideas that need filming.
    expect(m.anthropic.mock.calls[0][0].body.messages[0].content).toContain("don't plan ideas that need a specific person on camera");
    const ready = db.writes.filter((w) => w.table === "calendar_plans" && w.op === "update").map((w) => w.value as Record<string, unknown>).find((v) => v.status === "ready");
    expect(ready?.rhythm).toEqual(expect.objectContaining({ applied: expect.any(Array), learned: expect.any(Array), sources: expect.any(Object) }));
  });

  it("queues the voice profile early when a platform that had too few posts for a voice of its own reaches 5", async () => {
    const posts = (channel: string, n: number) => Array.from({ length: n }, (_, i) => ({ postId: `${channel}${i}`, channel, type: "photo", publishedAt: new Date(NOW.getTime() - (i * 5 + 3) * 86400_000).toISOString(), message: "Captains, this one is for you and your whole team.", engagementTotal: 3 }));
    m.owned.mockResolvedValue({ coverage: "complete", profiles: [{ network: "instagram" }, { network: "tiktok" }], posts: [...posts("instagram", 8), ...posts("tiktok", 5)] });
    m.anthropic.mockResolvedValue({ text: JSON.stringify({ posts: [{ date: "2026-10-27", platform: "Instagram", copy: "Captains, this one is for you.", reason_type: "seasonal", moment: "Playoffs start Oct 27", evidence_ids: [] }] }), raw: {} });
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
    m.anthropic.mockResolvedValue({ text: JSON.stringify({ posts: [{ date: "2026-10-27", platform: "Instagram", copy: "Captains, this one is for you.", reason_type: "seasonal", moment: "Playoffs start Oct 27", evidence_ids: [] }] }), raw: {} });
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
    expect(m.anthropic.mock.calls[0][0].body.messages[0].content).toContain('theme "Captain POV skits"');
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
    m.anthropic.mockResolvedValue({ text: JSON.stringify({ posts: [{ date: "2026-10-27", platform: "Instagram", copy: "Captains, this one is for you.", reason_type: "seasonal", moment: "Playoffs start Oct 27", evidence_ids: [] }] }), raw: {} });
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
    m.anthropic.mockResolvedValue({ text: JSON.stringify({ posts: [{ date: "2026-10-27", platform: "Instagram", copy: "Captains, this one is for you.", reason_type: "seasonal", moment: "Playoffs start Oct 27", evidence_ids: [] }] }), raw: {} });
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
    expect(prompt.replace(/\n\nThe client's content strategy[\s\S]*?evidence rules here win wherever the strategy differs from them\./, "")).toBe(bare);
  });

  it("plans as before when the strategy cannot be read", async () => {
    m.owned.mockResolvedValue({ coverage: "not_connected", profiles: [], posts: [] });
    m.anthropic.mockResolvedValue({ text: JSON.stringify({ posts: [{ date: "2026-10-27", platform: "Instagram", copy: "Captains.", reason_type: "seasonal", moment: "Playoffs", evidence_ids: [] }] }), raw: {} });
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
      expect(asked.sort()).toEqual(["k1", "k2", "k3"]);
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
