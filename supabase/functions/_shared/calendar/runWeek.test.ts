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
}));
vi.mock("../anthropic.ts", () => ({ anthropicMessages: m.anthropic }));
vi.mock("../competitive/ownedSource.ts", () => ({ collectOwnedCompetitive: m.owned }));
vi.mock("../voice/load.ts", async (original) => ({
  ...(await original<typeof import("../voice/load.ts")>()),
  loadClientVoice: async () => ({ brand: "Pay The Pyper", preferences: [], social: null, briefTone: null }),
  activePreferences: m.activePreferences,
  consolidateMemory: m.consolidateMemory,
  buildVoiceProfile: m.buildVoiceProfile,
}));

import { retryWait, runVoiceProfile, runWeekPlan, runWeekRevise, type WeekJob } from "./runWeek";

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
      const rows = tables[table] ?? [];
      // deno-lint-ignore no-explicit-any
      const q: any = {};
      for (const name of ["select", "eq", "neq", "in", "gte", "lte", "lt", "order", "limit", "not", "is", "or", "range", "contains"]) q[name] = () => q;
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

afterEach(() => vi.clearAllMocks());
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

  it("finishes a week with nothing to post (a rate under one a week) without a model call", async () => {
    // Two Facebook posts in the last 8 weeks: 0.25 a week, and the week of 26 Oct is not one of its weeks.
    const posts = ["2026-09-01T14:00:00Z", "2026-09-29T14:00:00Z"].map((publishedAt, i) => ({ postId: `p${i}`, channel: "facebook", type: "photo", publishedAt, message: "A post", engagementTotal: 3 }));
    m.owned.mockResolvedValue({ coverage: "complete", profiles: [{ network: "facebook" }], posts });
    const db = fakeDb({ calendar_plans: [plan], clients: [CLIENT] });
    const out = await runWeekPlan(db, job(), NOW);
    expect(out).toMatchObject({ status: "done", result: { posts: 0, quiet_week: true } });
    expect(m.anthropic).not.toHaveBeenCalled();
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
