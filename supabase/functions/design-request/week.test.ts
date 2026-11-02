import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../_shared/lifecycle/fakeDb";
import { AuthzError } from "../_shared/auth/authz";
import { type WeekDeps, weekContinue, weekPreview, weekStart, weekStop } from "./week";

// Tuesday 3 Nov 2026, noon UTC; the week on screen runs Monday 2 to Sunday 8 Nov.
const NOW = new Date("2026-11-03T12:00:00Z");
const WEEK = "2026-11-02";
const STAFF = "person-1";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
const calendarPost = (key: string, over: Row = {}): Row => ({
  id: `id-${key}`, client_id: "c1", post_key: key, post_date: "2026-11-05", posting_time: "9:00 AM", platform: "Instagram", format: "Static",
  copy: `Copy for ${key}`, report_id: null, visual_direction: null, ...over,
});

function world(tables: Record<string, Row[]> = {}): FakeDb {
  const leases = new Map<string, string>();
  return fakeDb({
    clients: [{ id: "c1", name: "Pay The Pyper", timezone: "UTC" }],
    design_brand_settings: [{ client_id: "c1", confirmed_at: "2026-10-20T10:00:00Z", logo_path: "c1/logo.png", placement: {}, background: "#000000", reference_paths: ["c1/a.jpg"] }],
    calendar_posts: [],
    calendar_plans: [{ client_id: "c1", week_start: WEEK, status: "ready", pending_revision: null }],
    design_requests: [],
    post_iterations: [],
    design_week_runs: [],
    canva_finish_jobs: [],
    client_lifecycle_steps: [],
    ...tables,
  }, {
    claim_worker_lease: ({ p_name, p_holder }) => {
      const held = leases.get(p_name);
      if (held && held !== p_holder) return false;
      leases.set(p_name, p_holder);
      return true;
    },
    release_worker_lease: ({ p_name, p_holder }) => { if (leases.get(p_name) === p_holder) leases.delete(p_name); },
  });
}

/** Deps as design-request wires them, with the person and the system faked. */
function deps(db: FakeDb, over: Partial<WeekDeps> = {}): WeekDeps & { started: Row[]; woken: number } {
  const d = {
    started: [] as Row[],
    woken: 0,
    db,
    now: () => NOW,
    wait: async () => {},
    requireStaff: async () => STAFF,
    isSystem: async () => true,
    balance: vi.fn(async () => 500),
    // The single post's path, as far as the week needs it: a request named for who added the post, carrying the week.
    startPost: vi.fn(async (s: Row) => {
      const id = `req-${s.post_key}`;
      db.tables.design_requests.push({ id, client_id: s.client_id, calendar_post_key: s.post_key, status: "preparing", stage: "planning", batch_id: s.batchId, requested_by: s.added_by, post_copy: s.copy, created_at: NOW.toISOString(), updated_at: NOW.toISOString() });
      d.started.push(s);
      return { requestId: id, filming: false };
    }),
    wake: () => { d.woken++; },
    ...over,
  };
  return d as WeekDeps & { started: Row[]; woken: number };
}

const clientUser = async () => { throw new AuthzError(403, "Moburst staff only."); };

describe("week_preview and week_start: who may press", () => {
  it("refuses a client's own user, and writes nothing", async () => {
    const db = world({ calendar_posts: [calendarPost("a")] });
    await expect(weekStart(deps(db, { requireStaff: clientUser }), { client_id: "c1", week_start: WEEK })).rejects.toThrow(AuthzError);
    await expect(weekPreview(deps(db, { requireStaff: clientUser }), { client_id: "c1", week_start: WEEK })).rejects.toThrow(AuthzError);
    expect(db.tables.design_week_runs).toEqual([]);
  });

  it("asks for a Monday", async () => {
    const r = await weekStart(deps(world()), { client_id: "c1", week_start: "2026-11-03" });
    expect(r.status).toBe(400);
  });

  it("answers a client whose design settings don't exist yet with a code and what its setup waits for", async () => {
    const db = world({
      design_brand_settings: [],
      calendar_posts: [calendarPost("a")],
      client_lifecycle_steps: [{ client_id: "c1", step: "design_refs", status: "waiting", result: { waiting_for: "designed_posts" } }],
    });
    expect((await weekPreview(deps(db), { client_id: "c1", week_start: WEEK })).body).toEqual({ code: "not_set_up", waiting_for: "designed_posts", client_name: "Pay The Pyper" });
    expect((await weekStart(deps(db), { client_id: "c1", week_start: WEEK })).body).toMatchObject({ code: "not_set_up" });
    expect(db.tables.design_week_runs).toEqual([]);
    db.tables.client_lifecycle_steps = [{ client_id: "c1", step: "design_refs", status: "done", result: {} }, { client_id: "c1", step: "design_settings", status: "waiting", result: { waiting_for: "logo_file" } }];
    expect((await weekPreview(deps(db), { client_id: "c1", week_start: WEEK })).body).toMatchObject({ waiting_for: "logo_file" });
    db.tables.client_lifecycle_steps = [];
    expect((await weekPreview(deps(db), { client_id: "c1", week_start: WEEK })).body).toMatchObject({ waiting_for: "look" });
  });
});

describe("week_preview", () => {
  it("counts what a press would design and estimates it, spending nothing", async () => {
    const db = world({
      calendar_posts: [
        calendarPost("single"),
        calendarPost("carousel", { format: "Carousel" }),
        calendarPost("video", { format: "Reel" }),
        calendarPost("filmed", { format: "Reel" }),
        calendarPost("designed"),
        calendarPost("text", { format: "Text only" }),
        calendarPost("passed", { post_date: "2026-11-02" }),
        calendarPost("next-week", { post_date: "2026-11-09" }),
      ],
      design_requests: [{ id: "f", client_id: "c1", calendar_post_key: "filmed", status: "needs_filming", created_at: "2026-11-02T08:00:00Z" }],
      post_iterations: [{ client_id: "c1", calendar_post_key: "designed", variant_angle: "Design option 1", media_urls: ["https://x/d.png"], is_selected: true, created_at: "2026-11-02T08:00:00Z" }],
      // Two clips recorded so far: 90 and 110 credits.
      canva_finish_jobs: [
        { design_request_id: "old-1", status: "done", input: { kind: "video" }, state: { credits: [{ what: "footage", job_id: "j1", credits: 90, at: "x" }] }, created_at: "2026-10-30T08:00:00Z" },
        { design_request_id: "old-2", status: "done", input: { kind: "video" }, state: { credits: [{ what: "footage", job_id: "j2", credits: 110, at: "x" }] }, created_at: "2026-10-31T08:00:00Z" },
      ],
    });
    const d = deps(db);
    const r = await weekPreview(d, { client_id: "c1", week_start: WEEK });
    expect(r.body).toMatchObject({ client_name: "Pay The Pyper", counts: { single: 1, carousel: 1, video: 1, copy_waits: 0, filming: 1 }, credits: 100, credits_per_clip: 100, run_id: null, credits_used: null });
    expect(d.balance).not.toHaveBeenCalled();
    expect(d.startPost).not.toHaveBeenCalled();
    expect(db.tables.design_week_runs).toEqual([]);
  });

  it("gives staff the credits a finished week used, from the quote recorded on each clip", async () => {
    const db = world({
      design_week_runs: [{ id: "run-1", client_id: "c1", week_start: WEEK, status: "done", posts: [], requested_by: STAFF, created_at: "2026-11-03T08:00:00Z" }],
      design_requests: [{ id: "req-v", client_id: "c1", calendar_post_key: "v", status: "ready", batch_id: "run-1", created_at: "2026-11-03T08:00:00Z" }],
      canva_finish_jobs: [{ design_request_id: "req-v", status: "done", input: { kind: "video" }, state: { credits: [{ what: "footage", job_id: "j", credits: 100, at: "x" }, { what: "clean", job_id: "k", credits: 45, at: "x" }] }, created_at: "2026-11-03T09:00:00Z" }],
    });
    expect((await weekPreview(deps(db), { client_id: "c1", week_start: WEEK })).body).toMatchObject({ run_id: "run-1", credits_used: 145 });
  });
});

describe("week_start", () => {
  it("queues every eligible post, named for who pressed, keeps the estimate shown, and starts at once", async () => {
    const db = world({ calendar_posts: [calendarPost("a"), calendarPost("b", { post_date: "2026-11-06" }), calendarPost("done")], post_iterations: [{ client_id: "c1", calendar_post_key: "done", variant_angle: "Design option 1", created_at: "x" }] });
    const d = deps(db);
    const r = await weekStart(d, { client_id: "c1", week_start: WEEK, estimate: { posts: 2, single: 2, carousel: 0, video: 0, credits: 0, minutes: 7, note: "ignored" } });
    expect(r.body.added).toEqual(["a", "b"]);
    expect(db.tables.design_week_runs).toHaveLength(1);
    const run = db.tables.design_week_runs[0];
    expect(run).toMatchObject({ client_id: "c1", week_start: WEEK, status: "running", requested_by: STAFF, estimate: { posts: 2, single: 2, carousel: 0, video: 0, credits: 0, minutes: 7 } });
    expect(run.posts.map((p: Row) => [p.post_key, p.state, p.added_by])).toEqual([["a", "queued", STAFF], ["b", "queued", STAFF]]);
    expect(d.woken).toBe(1);
  });

  it("returns the one running week on a double press, adding nothing; a post added later joins it", async () => {
    const db = world({ calendar_posts: [calendarPost("a")] });
    const first = await weekStart(deps(db), { client_id: "c1", week_start: WEEK });
    const second = await weekStart(deps(db, { requireStaff: async () => "person-2" }), { client_id: "c1", week_start: WEEK });
    expect(db.tables.design_week_runs).toHaveLength(1);
    expect((second.body.run as Row).id).toBe((first.body.run as Row).id);
    expect(second.body.added).toEqual([]);
    db.tables.calendar_posts.push(calendarPost("late", { post_date: "2026-11-07" }));
    const third = await weekStart(deps(db, { requireStaff: async () => "person-2" }), { client_id: "c1", week_start: WEEK });
    expect(third.body.added).toEqual(["late"]);
    expect(db.tables.design_week_runs[0].posts.find((p: Row) => p.post_key === "late").added_by).toBe("person-2");
  });

  it("makes no run when nothing in the week needs a design", async () => {
    const db = world({ calendar_posts: [calendarPost("t", { format: "Text only" })] });
    expect((await weekStart(deps(db), { client_id: "c1", week_start: WEEK })).body).toEqual({ run: null, added: [] });
    expect(db.tables.design_week_runs).toEqual([]);
  });
});

describe("week_continue", () => {
  it("is the system's alone", async () => {
    const db = world();
    expect((await weekContinue(deps(db, { isSystem: async () => false }))).status).toBe(403);
  });

  it("starts the soonest post through the single post's path, naming who added it, then waits while the client plans", async () => {
    const db = world({ calendar_posts: [calendarPost("later", { post_date: "2026-11-07" }), calendarPost("sooner", { post_date: "2026-11-04" })] });
    await weekStart(deps(db), { client_id: "c1", week_start: WEEK });
    const d = deps(db);
    await weekContinue(d);
    expect(d.started.map((s) => [s.post_key, s.added_by, s.batchId, s.copy])).toEqual([["sooner", STAFF, db.tables.design_week_runs[0].id, "Copy for sooner"]]);
    const sooner = db.tables.design_week_runs[0].posts.find((p: Row) => p.post_key === "sooner");
    expect(sooner).toMatchObject({ state: "started", request_id: "req-sooner" });
    // The client's request is planning: nothing more starts for it.
    await weekContinue(d);
    expect(d.started).toHaveLength(1);
    // Planned: the next one starts.
    db.tables.design_requests[0].stage = "designing";
    await weekContinue(d);
    expect(d.started.map((s) => s.post_key)).toEqual(["sooner", "later"]);
  });

  it("starts a queued post from its copy as it is when it starts", async () => {
    const db = world({ calendar_posts: [calendarPost("a")] });
    await weekStart(deps(db), { client_id: "c1", week_start: WEEK });
    db.tables.post_iterations.push({ client_id: "c1", calendar_post_key: "a", post_copy: "Edited after the press", media_urls: null, created_at: "2026-11-03T11:00:00Z" });
    const d = deps(db);
    await weekContinue(d);
    expect(d.started[0].copy).toBe("Edited after the press");
  });

  it("starts nothing for a client archived meanwhile, and nothing can be pressed for one", async () => {
    const db = world({ calendar_posts: [calendarPost("a")] });
    await weekStart(deps(db), { client_id: "c1", week_start: WEEK });
    db.tables.clients[0].archived_at = "2026-11-03T11:00:00Z";
    const d = deps(db);
    await weekContinue(d);
    expect(d.started).toEqual([]);
    expect(db.tables.design_week_runs[0]).toMatchObject({ status: "done" });
    expect(db.tables.design_week_runs[0].posts[0]).toMatchObject({ state: "left_out", why: "not_set_up" });
    expect((await weekStart(deps(db), { client_id: "c1", week_start: WEEK })).status).toBe(409);
  });

  it("finishes the week once nothing is queued or being prepared", async () => {
    const db = world({ calendar_posts: [calendarPost("a")] });
    await weekStart(deps(db), { client_id: "c1", week_start: WEEK });
    const d = deps(db);
    await weekContinue(d);
    expect(db.tables.design_week_runs[0].status).toBe("running");
    db.tables.design_requests[0].status = "ready";
    await weekContinue(d);
    expect(db.tables.design_week_runs[0]).toMatchObject({ status: "done" });
    expect(db.tables.design_week_runs[0].finished_at).toBeTruthy();
  });
});

describe("week_stop", () => {
  it("leaves the queued posts out; the ones being designed go on", async () => {
    const db = world({ calendar_posts: [calendarPost("a", { post_date: "2026-11-04" }), calendarPost("b")] });
    await weekStart(deps(db), { client_id: "c1", week_start: WEEK });
    await weekContinue(deps(db));
    const id = db.tables.design_week_runs[0].id;
    const r = await weekStop(deps(db), { run_id: id });
    expect((r.body.run as Row).status).toBe("stopped");
    const run = db.tables.design_week_runs[0];
    expect(run).toMatchObject({ status: "stopped", stopped_by: STAFF });
    expect(run.posts.map((p: Row) => [p.post_key, p.state, p.why ?? null])).toEqual([["a", "started", null], ["b", "left_out", "stopped"]]);
    expect(db.tables.design_requests[0].status).toBe("preparing");
  });

  it("refuses a client's own user", async () => {
    const db = world({ design_week_runs: [{ id: "run-1", client_id: "c1", week_start: WEEK, status: "running", posts: [], requested_by: STAFF }] });
    await expect(weekStop(deps(db, { requireStaff: clientUser }), { run_id: "run-1" })).rejects.toThrow(AuthzError);
    expect(db.tables.design_week_runs[0].status).toBe("running");
  });
});
