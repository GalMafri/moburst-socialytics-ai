// supabase/functions/design-request/week.ts
//
// The week's design button (Lital, 2 Nov 2026: "one button to design a whole
// week's posts, on request only, never automatic"). Spec:
// docs/superpowers/specs/2026-11-02-design-week-button-design.md
//
//   week_preview {client_id, week_start}   staff with write access: what a
//        press would design and roughly what it costs, spending nothing
//        (database reads; credits from the clips recorded so far)
//   week_start {client_id, week_start, estimate}   staff with write access:
//        the week's eligible posts join its running run (made on the first
//        press); a second press adds only posts that became eligible since
//   week_stop {run_id}   staff with write access: posts not started yet are
//        left out; the ones being designed finish
//   week_continue   the system only (the design worker's minute pass): the
//        next posts of every running week start, at the pace weekRules.ts sets
//
// Every post starts through the same path a single post's "Create design"
// takes (index.ts startRequest), naming the person who added it. Free of
// Deno and network imports: index.ts hands in the database, the caller
// checks, the start and the Higgsfield balance, so the actions run against a
// fake database in tests.

import { type PassRun, type PassStart, type PostFacts, type RunPost, WEEK_AT_ONCE, classifyPost, currentCopyOf, keepStarts, mediaOf, mergeIntoRun, planPass, weekCounts } from "../_shared/design/weekRules.ts";
import { planningStalled } from "../_shared/design/requestRules.ts";
import { DESIGN_SETUP_STEPS, designWaitingFor, type DesignStepRow, type DesignWaitingFor } from "../_shared/design/setup.ts";
import { CLIP_CREDIT_FLOOR, creditsPerClip, creditsUsed } from "../_shared/video/credits.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export interface WeekDeps {
  db: Db;
  now: () => Date;
  wait: (ms: number) => Promise<void>;
  /** Moburst staff with write access to the client: their user id. Throws AuthzError otherwise. */
  requireStaff(clientId: string): Promise<string>;
  /** Whether the caller is the project's own system call (the operational secret, no person). */
  isSystem(): Promise<boolean>;
  /** Higgsfield credits on the account, or null when unknown. A read: nothing is spent. */
  balance(): Promise<number | null>;
  /** Start one post the way a single post's button does: its request's id, or filming when its video is filmed instead. */
  startPost(start: PassStart & { batchId: string; settings: Row; post: Row }): Promise<{ requestId: string | null; filming: boolean }>;
  /** Start the week's next posts now, in the background (after a press). */
  wake(): void;
}

export interface Answer { status?: number; body: Record<string, unknown> }

/** How long a press or a stop waits for a pass that holds its week. */
const LEASE_TRIES = 20;
const LEASE_PAUSE_MS = 1000;
const LEASE_SECONDS = 120;
/** Recent video jobs read for what a clip costs. */
const CLIP_SAMPLE = 60;
/** The run's columns screens and answers carry; the estimate stays in the database. */
const RUN_COLUMNS = "id, client_id, week_start, status, posts, requested_by, stopped_by, created_at, updated_at, finished_at";

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const isMonday = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(`${day}T00:00:00Z`).getUTCDay() === 1;

// ── Reading a week ──────────────────────────────────────────────────────────

/** What the rules need about one calendar post (weekRules PostFacts). Asked post by post: a report post's key is JSON text, which an in() filter does not survive. */
async function factsOf(db: Db, clientId: string, post: Row): Promise<PostFacts> {
  const [{ data: requests }, { data: iterations }] = await Promise.all([
    db.from("design_requests").select("status, end_reason, ended_at, created_at, video_route").eq("client_id", clientId).eq("calendar_post_key", post.post_key),
    db.from("post_iterations").select("post_copy, media_urls, created_at, variant_angle, is_selected, archived_at")
      .eq("client_id", clientId).eq("calendar_post_key", post.post_key).order("created_at", { ascending: false }).limit(50),
  ]);
  return {
    post: { post_key: post.post_key, post_date: post.post_date, posting_time: post.posting_time ?? null, format: post.format ?? null, platform: post.platform ?? null },
    requests: requests ?? [],
    ...mediaOf(iterations ?? []),
    copy: currentCopyOf(iterations ?? [], post.copy),
  };
}

/** The week's posts, Monday to Sunday, each with its facts and whether a press would design it. */
async function readWeek(db: Db, client: Row, week: string, now: Date) {
  const { data: posts, error } = await db.from("calendar_posts").select("*").eq("client_id", client.id).gte("post_date", week).lte("post_date", addDays(week, 6)).order("post_date");
  if (error) throw new Error(`Could not read the week's posts: ${error.message}`);
  return Promise.all((posts ?? []).map(async (post: Row) => {
    const facts = await factsOf(db, client.id, post);
    return { post, facts, result: classifyPost(facts, client.timezone, now) };
  }));
}

/** What the client's setup waits for before designs can start, in the lifecycle's own words (_shared/design/setup.ts). */
async function waitingFor(db: Db, clientId: string): Promise<DesignWaitingFor> {
  const { data } = await db.from("client_lifecycle_steps").select("step, status, result").eq("client_id", clientId).in("step", [...DESIGN_SETUP_STEPS]);
  return designWaitingFor((data ?? []) as DesignStepRow[]);
}

async function setUp(db: Db, clientId: string): Promise<Row | null> {
  const { data } = await db.from("design_brand_settings").select("*").eq("client_id", clientId).maybeSingle();
  return data?.confirmed_at ? data : null;
}

async function runningRun(db: Db, clientId: string, week: string): Promise<Row | null> {
  const { data } = await db.from("design_week_runs").select(RUN_COLUMNS).eq("client_id", clientId).eq("week_start", week).eq("status", "running").maybeSingle();
  return data ?? null;
}

/** Credits quoted on every clip and cleaning of the run's videos. */
async function creditsOfRun(db: Db, runId: string): Promise<number> {
  const { data: requests } = await db.from("design_requests").select("id").eq("batch_id", runId);
  const ids = (requests ?? []).map((r: Row) => r.id);
  if (!ids.length) return 0;
  const { data: jobs } = await db.from("canva_finish_jobs").select("state").in("design_request_id", ids);
  return creditsUsed((jobs ?? []).map((j: Row) => j.state));
}

/** A clip's credits, as recorded on the most recent video jobs. */
async function clipCredits(db: Db): Promise<number> {
  const { data: jobs } = await db.from("canva_finish_jobs").select("state").eq("input->>kind", "video").not("design_request_id", "is", null)
    .order("created_at", { ascending: false }).limit(CLIP_SAMPLE);
  return creditsPerClip((jobs ?? []).map((j: Row) => j.state));
}

/** Run the work while holding the week's lease, waiting briefly for a pass that holds it; null when it stayed held. */
async function withLease<T>(d: WeekDeps, runId: string, work: () => Promise<T>, tries = LEASE_TRIES): Promise<T | null> {
  const name = `week:${runId}`;
  const holder = crypto.randomUUID();
  for (let i = 0; ; i++) {
    const { data: got } = await d.db.rpc("claim_worker_lease", { p_name: name, p_holder: holder, p_seconds: LEASE_SECONDS });
    if (got) break;
    if (i + 1 >= tries) return null;
    await d.wait(LEASE_PAUSE_MS);
  }
  try {
    return await work();
  } finally {
    await d.db.rpc("release_worker_lease", { p_name: name, p_holder: holder });
  }
}

const notSetUp = async (db: Db, client: Row): Promise<Answer> => ({ body: { code: "not_set_up", waiting_for: await waitingFor(db, client.id), client_name: client.name ?? null } });

async function clientOf(db: Db, clientId: string): Promise<Row | null> {
  const { data } = await db.from("clients").select("id, name, timezone, archived_at").eq("id", clientId).maybeSingle();
  return data ?? null;
}

/** An archived client gets nothing made. */
const archived: Answer = { status: 409, body: { error: "This client is archived." } };

// ── week_preview ────────────────────────────────────────────────────────────

export async function weekPreview(d: WeekDeps, body: Row): Promise<Answer> {
  const clientId = String(body.client_id || "");
  const week = String(body.week_start || "");
  if (!clientId || !isMonday(week)) return { status: 400, body: { error: "client_id and a Monday week_start are required." } };
  await d.requireStaff(clientId);
  const client = await clientOf(d.db, clientId);
  if (!client) return { status: 404, body: { error: "No such client." } };
  if (client.archived_at) return archived;
  if (!(await setUp(d.db, clientId))) return notSetUp(d.db, client);

  const running = await runningRun(d.db, clientId, week);
  const queued = new Set(((running?.posts ?? []) as RunPost[]).filter((p) => p.state === "queued").map((p) => p.post_key));
  const posts = (await readWeek(d.db, client, week, d.now())).filter((p) => !queued.has(p.post.post_key));
  const counts = weekCounts(posts.map((p) => ({ post_key: p.post.post_key, copy: p.facts.copy, result: p.result, platform: p.post.platform })));
  const perClip = await clipCredits(d.db);
  const { data: latest } = await d.db.from("design_week_runs").select("id").eq("client_id", clientId).eq("week_start", week).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return {
    body: {
      client_name: client.name ?? null,
      week_start: week,
      counts,
      credits: counts.video * perClip,
      credits_per_clip: perClip,
      run_id: latest?.id ?? null,
      credits_used: latest ? await creditsOfRun(d.db, latest.id) : null,
    },
  };
}

// ── week_start ──────────────────────────────────────────────────────────────

/** The estimate staff were shown at the press, kept as numbers only. */
function estimateOf(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, number> = {};
  for (const k of ["posts", "single", "story", "carousel", "video", "credits", "minutes"]) {
    const n = Number((raw as Row)[k]);
    if (Number.isFinite(n) && n >= 0) out[k] = Math.round(n * 100) / 100;
  }
  return Object.keys(out).length ? out : null;
}

export async function weekStart(d: WeekDeps, body: Row): Promise<Answer> {
  const clientId = String(body.client_id || "");
  const week = String(body.week_start || "");
  if (!clientId || !isMonday(week)) return { status: 400, body: { error: "client_id and a Monday week_start are required." } };
  const userId = await d.requireStaff(clientId);
  const client = await clientOf(d.db, clientId);
  if (!client) return { status: 404, body: { error: "No such client." } };
  if (client.archived_at) return archived;
  if (!(await setUp(d.db, clientId))) return notSetUp(d.db, client);

  const now = d.now();
  const eligible = (await readWeek(d.db, client, week, now))
    .flatMap((p) => (p.result.in ? [{ post_key: p.post.post_key, kind: p.result.kind, postAt: p.result.postAt }] : []));

  const addTo = async (run: Row): Promise<Answer> => {
    const merged = await withLease(d, run.id, async () => {
      const current = await runningRun(d.db, clientId, week);
      if (!current) return null;
      const { posts, added } = mergeIntoRun((current.posts ?? []) as RunPost[], eligible, userId, now);
      if (!added.length) return { run: current, added };
      const { data: written } = await d.db.from("design_week_runs").update({ posts, updated_at: now.toISOString() })
        .eq("id", current.id).eq("status", "running").select(RUN_COLUMNS);
      return { run: written?.[0] ?? { ...current, posts }, added };
    });
    // Held by a pass that outlasted the wait: the browser sends the press again quietly.
    if (merged === null) return { status: 503, body: { error: "The week is being updated." } };
    if (merged.added.length) d.wake();
    return { body: merged };
  };

  const running = await runningRun(d.db, clientId, week);
  if (running) return addTo(running);
  if (!eligible.length) return { body: { run: null, added: [] } };

  const { posts, added } = mergeIntoRun([], eligible, userId, now);
  const { data: created, error } = await d.db.from("design_week_runs").insert({
    client_id: clientId, week_start: week, status: "running", posts, estimate: estimateOf(body.estimate), requested_by: userId,
  }).select(RUN_COLUMNS).single();
  if (error) {
    // Two presses at once: the unique index let one through; this press adds to it.
    const raced = await runningRun(d.db, clientId, week);
    if (raced) return addTo(raced);
    throw new Error(`Could not start designing the week: ${error.message}`);
  }
  d.wake();
  return { body: { run: created, added } };
}

// ── week_stop ───────────────────────────────────────────────────────────────

export async function weekStop(d: WeekDeps, body: Row): Promise<Answer> {
  const { data: run } = await d.db.from("design_week_runs").select(RUN_COLUMNS).eq("id", String(body.run_id || "")).maybeSingle();
  if (!run) return { status: 404, body: { error: "No such week." } };
  const userId = await d.requireStaff(run.client_id);
  if (run.status !== "running") return { body: { run } };
  const stopped = await withLease(d, run.id, async () => {
    const { data: current } = await d.db.from("design_week_runs").select(RUN_COLUMNS).eq("id", run.id).maybeSingle();
    if (!current || current.status !== "running") return current;
    const now = d.now().toISOString();
    const posts = ((current.posts ?? []) as RunPost[]).map((p) => (p.state === "queued" ? { ...p, state: "left_out" as const, why: "stopped" as const, waits_for: null } : p));
    const { data: written } = await d.db.from("design_week_runs").update({ status: "stopped", stopped_by: userId, posts, finished_at: now, updated_at: now })
      .eq("id", run.id).eq("status", "running").select(RUN_COLUMNS);
    return written?.[0] ?? current;
  });
  if (stopped === null) return { status: 503, body: { error: "The week is being updated." } };
  return { body: { run: stopped } };
}

// ── week_continue ───────────────────────────────────────────────────────────

/**
 * One pass over every running week: queued posts are checked again and the
 * next ones start (weekRules.ts planPass); a week with nothing queued and
 * nothing being prepared is done. Each week is held under its lease for the
 * pass, so two passes never start the same post.
 */
export async function weekContinue(d: WeekDeps): Promise<Answer> {
  if (!(await d.isSystem())) return { status: 403, body: { error: "Not allowed." } };
  const { data: open } = await d.db.from("design_week_runs").select(RUN_COLUMNS).eq("status", "running").order("created_at").limit(20);
  if (!open?.length) return { body: { runs: 0, started: 0 } };

  const held: Array<{ run: Row; holder: string }> = [];
  for (const run of open) {
    const holder = crypto.randomUUID();
    const { data: got } = await d.db.rpc("claim_worker_lease", { p_name: `week:${run.id}`, p_holder: holder, p_seconds: LEASE_SECONDS });
    if (got) held.push({ run, holder });
  }
  let started = 0;
  try {
    if (!held.length) return { body: { runs: 0, started: 0 } };
    const now = d.now();
    const runs = held.map((h) => h.run);
    const clientIds = [...new Set(runs.map((r) => String(r.client_id)))];

    // Every request being prepared, across clients: week posts take places, and a client planning waits.
    const { data: preparing } = await d.db.from("design_requests").select("id, client_id, stage, status, updated_at, batch_id").eq("status", "preparing").limit(1000);
    const live = (preparing ?? []) as Row[];
    const moving = live.filter((r) => r.batch_id && !planningStalled(r as { status: string; stage: string; updated_at: string }, now)).length;
    const planning = new Set(live.filter((r) => r.stage === "planning" && !planningStalled(r as { status: string; stage: string; updated_at: string }, now)).map((r) => String(r.client_id)));

    const [{ data: clients }, { data: settingsRows }, { data: plans }] = await Promise.all([
      d.db.from("clients").select("id, name, timezone, archived_at").in("id", clientIds),
      d.db.from("design_brand_settings").select("*").in("client_id", clientIds),
      d.db.from("calendar_plans").select("client_id, week_start, pending_revision").in("client_id", clientIds),
    ]);
    const zones = new Map<string, string | null>((clients ?? []).map((c: Row) => [String(c.id), c.timezone ?? null]));
    // A client archived meanwhile gets nothing more made: its queued posts leave, as when its settings are gone.
    const active = new Set((clients ?? []).filter((c: Row) => !c.archived_at).map((c: Row) => String(c.id)));
    const settings = new Map<string, Row>((settingsRows ?? []).filter((s: Row) => s.confirmed_at && active.has(String(s.client_id))).map((s: Row) => [String(s.client_id), s]));
    // Nothing starts while the week's revision is queued or running.
    const revising = new Set((plans ?? []).filter((p: Row) => p.pending_revision).map((p: Row) => `${p.client_id}|${String(p.week_start).slice(0, 10)}`));

    // Each queued post, read again now; a post moved out of the week or off the calendar has left.
    const facts = new Map<string, PostFacts | null>();
    const rows = new Map<string, Row>();
    for (const run of runs) {
      for (const p of (run.posts ?? []) as RunPost[]) {
        if (p.state !== "queued") continue;
        const key = `${run.client_id}|${p.post_key}`;
        const { data: post } = await d.db.from("calendar_posts").select("*").eq("client_id", run.client_id).eq("post_key", p.post_key).maybeSingle();
        const inWeek = post && post.post_date >= run.week_start && post.post_date <= addDays(String(run.week_start).slice(0, 10), 6);
        facts.set(key, inWeek ? await factsOf(d.db, run.client_id, post) : null);
        if (inWeek) rows.set(key, post);
      }
    }
    const videoQueued = runs.some((r) => ((r.posts ?? []) as RunPost[]).some((p) => p.state === "queued" && p.kind === "video"));
    const balance = videoQueued ? await d.balance() : null;

    const pass = planPass({
      now,
      room: Math.max(0, WEEK_AT_ONCE - moving),
      runs: runs.map((r): PassRun => ({ id: r.id, client_id: String(r.client_id), posts: (r.posts ?? []) as RunPost[], revising: revising.has(`${r.client_id}|${String(r.week_start).slice(0, 10)}`) })),
      facts,
      zones,
      planning,
      preparing: new Set(live.map((r) => String(r.id))),
      settings: new Set(settings.keys()),
      // An unread balance does not hold a clip back: the video worker checks it again before the footage.
      clipAffordable: balance === null || balance >= CLIP_CREDIT_FLOOR,
    });

    for (const s of pass.starts) {
      const posts = pass.runs.get(s.runId) ?? [];
      const entry = posts.find((p) => p.post_key === s.post_key);
      try {
        const out = await d.startPost({ ...s, batchId: s.runId, settings: settings.get(s.client_id)!, post: rows.get(`${s.client_id}|${s.post_key}`)! });
        if (entry) Object.assign(entry, { state: out.filming ? "filming" : "started", request_id: out.requestId, started_at: now.toISOString(), waits_for: null, why: null });
        started++;
      } catch (e) {
        // Left queued: the next pass starts it.
        console.error(`[design-request] week ${s.runId} post ${s.post_key}:`, e instanceof Error ? e.message : e);
      }
    }

    for (const run of runs) {
      const posts = pass.runs.get(run.id) ?? [];
      const finished = pass.finished.includes(run.id);
      const at = new Date().toISOString();
      const { data: written } = await d.db.from("design_week_runs")
        .update({ posts, updated_at: at, ...(finished ? { status: "done", finished_at: at } : {}) })
        .eq("id", run.id).eq("status", "running").select("id");
      if (written?.length) continue;
      // Stopped meanwhile: the stop stands, with the posts this pass did start.
      const { data: stored } = await d.db.from("design_week_runs").select("posts").eq("id", run.id).maybeSingle();
      if (stored) await d.db.from("design_week_runs").update({ posts: keepStarts((stored.posts ?? []) as RunPost[], posts), updated_at: at }).eq("id", run.id);
    }
    return { body: { runs: runs.length, started } };
  } finally {
    for (const h of held) await d.db.rpc("release_worker_lease", { p_name: `week:${h.run.id}`, p_holder: h.holder });
  }
}
