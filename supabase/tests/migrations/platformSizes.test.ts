// @vitest-environment node
// 20261117150000_platform_sizes.sql, applied twice to PGlite: the sizes a
// design is uploaded in, the record of each weekly read, the job's one
// write and when the job is queued. The table starts with the sizes agreed
// on 17 Nov 2026, a second run of the file never puts a seed over a size
// read since, and a size changes only while the row still holds the size
// the run compared against.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";
import { MAX_EDGE, MIN_EDGE, checkSize, type UploadFormat } from "../../functions/_shared/design/platformSize";
import { asBeforeInput } from "../../functions/_shared/design/sizeFallback";

const migration = readFileSync(join(functionsDir, "..", "migrations", "20261117150000_platform_sizes.sql"), "utf8");
// What the migration builds on: the app's roles, the two access functions, the queue as the earlier migrations leave it, and pg_cron's schedule.
const SETUP = `
create role anon;
create role authenticated;
create role service_role;
grant usage on schema public to anon, authenticated, service_role;
create function public.is_oauth_session() returns boolean language sql stable as 'select false';
create function public.is_moburst_staff() returns boolean language sql stable as 'select true';
create table public.design_requests (id uuid primary key default gen_random_uuid(), platform text, format text);
create table public.canva_finish_jobs (id uuid primary key default gen_random_uuid(), design_request_id uuid, option_index integer, slide_index integer, status text not null default 'queued', input jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());
create table public.scheduled_jobs (
  id uuid primary key default gen_random_uuid(), kind text not null, client_id uuid, dedupe_key text not null unique,
  priority smallint not null default 50, status text not null default 'queued', available_at timestamptz not null default now(), finished_at timestamptz,
  constraint scheduled_jobs_kind_check check (kind in ('feed_refresh', 'dispatch', 'sprout_onboarding', 'moments_list')),
  constraint scheduled_jobs_client_required check (client_id is not null or kind in ('sprout_onboarding', 'moments_list'))
);
create schema cron;
create table cron.job (jobname text primary key, schedule text, command text);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $f$
  insert into cron.job values (p_name, p_schedule, p_command) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning 1::bigint
$f$;
`;
const SEED = [
  ["facebook", "image", 1080, 1350], ["facebook", "story", 1080, 1920],
  ["instagram", "carousel", 1080, 1350], ["instagram", "image", 1080, 1350], ["instagram", "story", 1080, 1920],
  ["linkedin", "image", 1200, 1200], ["x", "image", 1600, 900],
];

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(migration);
  await db.exec(migration);
});
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec("delete from public.platform_size_reads; delete from public.scheduled_jobs; delete from public.platform_sizes; delete from public.platform_size_outcomes; delete from public.canva_finish_jobs; delete from public.design_requests;");
  await db.exec(migration);
});

async function as<T>(role: "anon" | "authenticated" | "service_role", sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`set role ${role}`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}
type SizeRow = { platform: string; format: string; width: number; height: number; source: string; previous_width: number | null; pending_width: number | null; pending_height: number | null; checked: boolean };
const sizes = async () => (await db.query<SizeRow>("select platform, format, width, height, source, previous_width, pending_width, pending_height, checked_at is not null as checked from public.platform_sizes order by platform, format")).rows;
const one = async (platform: string, format: string) => (await sizes()).find((r) => r.platform === platform && r.format === format)!;
const record = async (read: unknown) => (await as<{ out: { id: string; changed: number } }>("service_role", "select public.record_platform_size_read($1::jsonb) as out", [JSON.stringify(read)]))[0].out;
const run = (rows: unknown[], over: Record<string, unknown> = {}) => ({ ok: true, source: "https://example.test/guide", source_updated: "2026-11-02", error: null, rows, ...over });

describe("the sizes table", () => {
  it("starts with the sizes agreed on 17 Nov 2026, each one a size the app can make", async () => {
    const rows = await sizes();
    expect(rows.map((r) => [r.platform, r.format, r.width, r.height])).toEqual(SEED);
    for (const r of rows) {
      expect(r.source).toBe("seed");
      expect(checkSize({ width: r.width, height: r.height }, r.format as UploadFormat).ok).toBe(true);
    }
  });

  it("never puts a seed over a size read since, when the file is run again", async () => {
    await db.exec("update public.platform_sizes set width = 1080, height = 1440, source = 'guide' where platform = 'instagram' and format = 'image'");
    await db.exec(migration);
    expect(await one("instagram", "image")).toMatchObject({ width: 1080, height: 1440, source: "guide" });
    expect(await sizes()).toHaveLength(SEED.length);
  });

  it("holds the code's own bounds, so no writer can store a size outside them", async () => {
    expect(migration).toContain(`width between ${MIN_EDGE} and ${MAX_EDGE} and height between ${MIN_EDGE} and ${MAX_EDGE}`);
    await expect(db.exec(`update public.platform_sizes set width = ${MIN_EDGE - 1} where platform = 'x'`)).rejects.toThrow(/platform_sizes_edges/);
    await expect(db.exec(`update public.platform_sizes set height = ${MAX_EDGE + 1} where platform = 'x'`)).rejects.toThrow(/platform_sizes_edges/);
    await expect(db.exec("update public.platform_sizes set pending_width = 10, pending_height = 10 where platform = 'x'")).rejects.toThrow(/platform_sizes_pending/);
    await expect(db.exec("insert into public.platform_sizes (platform, format, width, height) values ('x', 'poster', 1080, 1080)")).rejects.toThrow(/platform_sizes_format/);
  });

  it("lets staff read and nobody but the service role write", async () => {
    expect(await as("authenticated", "select 1 from public.platform_sizes")).toHaveLength(SEED.length);
    await expect(as("anon", "select 1 from public.platform_sizes")).rejects.toMatchObject({ code: "42501" });
    await expect(as("authenticated", "update public.platform_sizes set width = 1000")).rejects.toMatchObject({ code: "42501" });
    await expect(as("authenticated", "insert into public.platform_size_reads (ok) values (true)")).rejects.toMatchObject({ code: "42501" });
    await expect(as("authenticated", "select public.record_platform_size_read('{}'::jsonb)")).rejects.toMatchObject({ code: "42501" });
    await expect(as("anon", "select public.enqueue_platform_sizes_job()")).rejects.toMatchObject({ code: "42501" });
    await expect(as("authenticated", "select public.design_size_refused(gen_random_uuid(), 'x')")).rejects.toMatchObject({ code: "42501" });
    await expect(as("authenticated", "select public.note_platform_size_outcome('x', 'image', 1600, 900, 'drawn')")).rejects.toMatchObject({ code: "42501" });
    await expect(as("authenticated", "insert into public.platform_size_outcomes (platform, format, width, height) values ('x', 'image', 1, 1)")).rejects.toMatchObject({ code: "42501" });
    for (const table of ["platform_sizes", "platform_size_reads", "platform_size_outcomes"]) {
      const { rows } = await db.query<{ policyname: string }>("select policyname from pg_policies where schemaname = 'public' and tablename = $1 and permissive = 'RESTRICTIVE' order by policyname", [table]);
      expect(rows.map((r) => r.policyname)).toEqual(["OAuth sessions cannot delete", "OAuth sessions cannot insert", "OAuth sessions cannot update"]);
      const { rows: rls } = await db.query<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where oid = 'public.${table}'::regclass`);
      expect(rls).toEqual([{ relrowsecurity: true }]);
    }
  });

  it("adds the request's own size as an empty column", async () => {
    await db.exec("insert into public.design_requests (platform, format) values ('LinkedIn', 'image')");
    const { rows } = await db.query<{ upload_size: unknown }>("select upload_size from public.design_requests");
    expect(rows).toEqual([{ upload_size: null }]);
  });
});

describe("the job's one write", () => {
  const ig = { platform: "instagram", format: "image" };

  it("changes a size, keeps the one before it and records the run", async () => {
    const out = await record(run([{ ...ig, outcome: "changed", from: [1080, 1350], to: [1080, 1440], read: [[1080, 1440]] }]));
    expect(out.changed).toBe(1);
    expect(await one("instagram", "image")).toMatchObject({ width: 1080, height: 1440, source: "guide", previous_width: 1080, checked: true });
    const { rows } = await db.query<{ ok: boolean; source_updated: string; rows: Array<{ outcome: string }> }>("select ok, source_updated, rows from public.platform_size_reads");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ok: true, source_updated: "2026-11-02" });
    expect(rows[0].rows[0].outcome).toBe("changed");
    // No other row moved.
    expect((await sizes()).filter((r) => r.source === "guide")).toHaveLength(1);
  });

  it("changes nothing when the row no longer holds the size the run compared against", async () => {
    const out = await record(run([{ ...ig, outcome: "changed", from: [1440, 1800], to: [1080, 1440] }]));
    expect(out.changed).toBe(0);
    expect(await one("instagram", "image")).toMatchObject({ width: 1080, height: 1350, source: "seed" });
  });

  it("holds a far different size as pending, and changes to it only when it is confirmed", async () => {
    await record(run([{ ...ig, outcome: "held", from: [1080, 1350], to: [1080, 1080] }]));
    expect(await one("instagram", "image")).toMatchObject({ width: 1080, height: 1350, pending_width: 1080, pending_height: 1080, source: "seed" });
    // A confirmation of another size than the pending one changes nothing.
    expect((await record(run([{ ...ig, outcome: "confirmed", from: [1080, 1350], to: [1200, 1200] }]))).changed).toBe(0);
    expect(await one("instagram", "image")).toMatchObject({ width: 1080, height: 1350, pending_width: 1080 });
    expect((await record(run([{ ...ig, outcome: "confirmed", from: [1080, 1350], to: [1080, 1080] }]))).changed).toBe(1);
    expect(await one("instagram", "image")).toMatchObject({ width: 1080, height: 1080, pending_width: null, pending_height: null, previous_width: 1080, source: "guide" });
  });

  it("clears a pending size when the size in use is read again", async () => {
    await record(run([{ ...ig, outcome: "held", from: [1080, 1350], to: [1080, 1080] }]));
    await record(run([{ ...ig, outcome: "same", from: [1080, 1350] }]));
    expect(await one("instagram", "image")).toMatchObject({ width: 1080, height: 1350, pending_width: null, pending_height: null, checked: true });
  });

  it("leaves a refused row, and every row of a run that failed, exactly as it was", async () => {
    const before = await sizes();
    await record(run([{ ...ig, outcome: "refused", reason: "edge", from: [1080, 1350], read: [[320, 320]] }]));
    expect(await sizes()).toEqual(before);
    // A failed run is recorded with its reason and applies nothing, whatever its rows say.
    await record(run([{ ...ig, outcome: "changed", from: [1080, 1350], to: [1080, 1440] }], { ok: false, error: "The guide answered 503." }));
    expect(await sizes()).toEqual(before);
    const { rows } = await db.query<{ ok: boolean; error: string | null }>("select ok, error from public.platform_size_reads order by read_at");
    expect(rows.map((r) => r.ok)).toEqual([true, false]);
    expect(rows[1].error).toBe("The guide answered 503.");
  });

  it("writes nothing at all when a size is outside the table's bounds", async () => {
    await expect(record(run([{ ...ig, outcome: "changed", from: [1080, 1350], to: [100, 100] }]))).rejects.toThrow(/platform_sizes_edges/);
    expect(await one("instagram", "image")).toMatchObject({ width: 1080, height: 1350 });
    expect((await db.query("select 1 from public.platform_size_reads")).rows).toHaveLength(0);
  });

  it("clears runs older than 400 days", async () => {
    await record(run([]));
    await db.exec("update public.platform_size_reads set read_at = now() - interval '401 days'");
    await record(run([]));
    expect((await db.query("select 1 from public.platform_size_reads")).rows).toHaveLength(1);
  });
});

describe("a held size", () => {
  const ig = { platform: "instagram", format: "image" };
  const held = () => record(run([{ ...ig, outcome: "held", from: [1080, 1350], to: [1080, 1080] }]));
  const refusedRead = () => record(run([{ ...ig, outcome: "refused", reason: "not_read", from: [1080, 1350] }]));

  it("is neither confirmed nor cleared by a refused read or a failed run, and is dropped after three refused reads", async () => {
    await held();
    await refusedRead();
    await record(run([{ ...ig, outcome: "refused", from: [1080, 1350] }], { ok: false, error: "The guide answered 503." }));
    await record(run([], { ok: false, error: "The guide answered 503." }));
    await refusedRead();
    expect(await one("instagram", "image")).toMatchObject({ width: 1080, height: 1350, pending_width: 1080, pending_height: 1080 });
    // Still confirmable by the next read that gives it.
    await refusedRead();
    expect(await one("instagram", "image")).toMatchObject({ width: 1080, height: 1350, pending_width: null, pending_height: null });
    // Dropped: a confirmation of it now changes nothing.
    expect((await record(run([{ ...ig, outcome: "confirmed", from: [1080, 1350], to: [1080, 1080] }]))).changed).toBe(0);
  });

  it("starts its count again when it is held again, and is replaced by another far size", async () => {
    await held();
    await refusedRead();
    await refusedRead();
    await held();
    await refusedRead();
    await refusedRead();
    expect(await one("instagram", "image")).toMatchObject({ pending_width: 1080, pending_height: 1080 });
    await record(run([{ ...ig, outcome: "held", from: [1080, 1350], to: [1200, 1200] }]));
    expect(await one("instagram", "image")).toMatchObject({ pending_width: 1200, pending_height: 1200 });
    expect((await record(run([{ ...ig, outcome: "confirmed", from: [1080, 1350], to: [1080, 1080] }]))).changed).toBe(0);
  });
});

describe("a size the image model refuses", () => {
  const stored = { anchor: "left", width: 0.3, top: 0.05, left: 0.06 };
  const input = (over: Record<string, unknown> = {}) => ({
    logo_path: "c1/logo.png", copy: ["Hello"], placement: { anchor: "left", width: 0.2683, top: 0.0559, left: 0.0537 }, as_before: { placement: stored },
    generate: { brand_name: "Acme", platform: "LinkedIn", concept: "a desk", refs: ["a.jpg"], size: { width: 1216, height: 1216 }, deliver: { width: 1200, height: 1200, platform: "linkedin", format: "image" } },
    ...over,
  });
  const addJob = async (request: string | null, option: number | null, slide: number | null, inp: unknown, status = "queued") =>
    (await db.query<{ id: string }>("insert into public.canva_finish_jobs (design_request_id, option_index, slide_index, status, input) values ($1, $2, $3, $4, $5::jsonb) returning id", [request, option, slide, status, JSON.stringify(inp)])).rows[0].id;
  const inputOf = async (id: string) => (await db.query<{ input: Record<string, any> }>("select input from public.canva_finish_jobs where id = $1", [id])).rows[0].input;
  const refused = async (job: string) => (await as<{ n: number }>("service_role", "select public.design_size_refused($1, $2) as n", [job, "Image model 400: size"]))[0].n;
  const outcomes = async () => (await db.query<{ platform: string; format: string; width: number; height: number; drawn: boolean; refused: boolean; confirmed: boolean; refused_reason: string | null }>("select platform, format, width, height, drawn_at is not null as drawn, refused_at is not null as refused, refusal_confirmed_at is not null as confirmed, refused_reason from public.platform_size_outcomes order by platform, format, width")).rows;

  it("makes every slide of the carousel's option as before in one statement, so all end in one size", async () => {
    const request = (await db.query<{ id: string }>("insert into public.design_requests (platform, format) values ('LinkedIn', 'Carousel') returning id")).rows[0].id;
    await db.query("update public.design_requests set upload_size = $2::jsonb where id = $1", [request, JSON.stringify({ platform: "linkedin", format: "image", width: 1200, height: 1200 })]);
    const cover = await addJob(request, 0, 0, input(), "running");
    const slides = [await addJob(request, 0, 1, input({ copy: ["Two"] })), await addJob(request, 0, 2, input({ copy: ["Three"] }))];
    // Another request's job is not touched.
    const other = await addJob((await db.query<{ id: string }>("insert into public.design_requests default values returning id")).rows[0].id, 0, 0, input());

    expect(await refused(cover)).toBe(3);
    for (const [id, copy] of [[cover, ["Hello"]], [slides[0], ["Two"]], [slides[1], ["Three"]]] as const) {
      const now = await inputOf(id);
      // The same change the worker makes to the job in hand.
      expect(now).toEqual(asBeforeInput(input({ copy })));
      expect(now.generate.size).toBeUndefined();
      expect(now.generate.deliver).toBeUndefined();
      expect(now.placement).toEqual(stored);
    }
    expect((await inputOf(other)).generate.deliver).toEqual({ width: 1200, height: 1200, platform: "linkedin", format: "image" });
    // The request no longer carries the size: an option started later is made as before too.
    expect((await db.query("select upload_size from public.design_requests where id = $1", [request])).rows).toEqual([{ upload_size: null }]);
    // Nothing is recorded against the size by the fallback itself: that takes the redraw (the next test).
    expect(await outcomes()).toEqual([]);
    expect(await one("linkedin", "image")).toMatchObject({ width: 1200, height: 1200 });
    // Once: no job carries the size any more.
    expect(await refused(cover)).toBe(0);
    expect(await refused(slides[0])).toBe(0);
  });

  it("keeps a Story on its page, leaves a finished job alone and answers nothing for a job with no size", async () => {
    const story = await addJob(null, null, null, input({ as_before: { placement: stored, size: { width: 1152, height: 2048 } }, generate: { ...input().generate, size: { width: 1152, height: 2048 }, surface: "story", deliver: { width: 1080, height: 1920, platform: "instagram", format: "story" } } }));
    expect(await refused(story)).toBe(1);
    expect((await inputOf(story)).generate).toMatchObject({ size: { width: 1152, height: 2048 }, surface: "story" });
    expect((await inputOf(story)).generate.deliver).toBeUndefined();
    const done = await addJob(null, null, null, input(), "done");
    expect(await refused(done)).toBe(0);
    expect((await inputOf(done)).generate.deliver).toBeDefined();
    const plain = await addJob(null, null, null, { generate: { brand_name: "Acme" }, placement: stored });
    expect(await refused(plain)).toBe(0);
    expect(await refused("00000000-0000-4000-8000-0000000000aa")).toBe(0);
  });

  it("is recorded with the size asked, when and what the model said, and switches the row off at once", async () => {
    const note = (width: number, height: number, outcome: string, reason: string | null = null) => as("service_role", "select public.note_platform_size_outcome('x', 'image', $1, $2, $3, $4)", [width, height, outcome, reason]);
    const usable = async () => (await db.query<{ usable: boolean }>("select usable from public.platform_sizes where platform = 'x'")).rows[0].usable;
    await note(1600, 900, "drawn");
    expect(await outcomes()).toMatchObject([{ platform: "x", width: 1600, height: 900, drawn: true, refused: false, confirmed: false }]);
    expect(await usable()).toBe(true);
    // A refusal of a size that is not the one in use leaves the row alone.
    await note(1200, 675, "refusal_confirmed", "Image model 400");
    expect(await usable()).toBe(true);
    await note(1600, 900, "refusal_confirmed", "Image model 400: size");
    expect((await outcomes()).find((o) => o.width === 1600)).toMatchObject({ drawn: true, refused: true, confirmed: true, refused_reason: "Image model 400: size" });
    expect(await usable()).toBe(false);
    expect((await sizes()).filter((r) => r.platform !== "x")).toHaveLength(SEED.length - 1);
    // Nothing for an outcome it does not know, or a size with no row.
    await note(1600, 900, "refused");
    await note(1600, 900, "made_up");
    await as("service_role", "select public.note_platform_size_outcome(null, 'image', 1600, 900, 'drawn', null)");
    expect(await outcomes()).toHaveLength(2);
  });

  it("is tried again after the next run that read the guide and still found it listed, never on a failed run", async () => {
    await as("service_role", "select public.note_platform_size_outcome('x', 'image', 1600, 900, 'refusal_confirmed', 'Image model 400')");
    const retried = { platform: "x", format: "image", outcome: "retried", from: [1600, 900] };
    await record(run([retried], { ok: false, error: "The guide answered 503." }));
    expect((await db.query("select usable from public.platform_sizes where platform = 'x'")).rows).toEqual([{ usable: false }]);
    await record(run([retried]));
    expect((await db.query("select usable, width, height from public.platform_sizes where platform = 'x'")).rows).toEqual([{ usable: true, width: 1600, height: 900 }]);
    // The refusal no longer counts; what the model said stays for diagnosis.
    expect(await outcomes()).toMatchObject([{ confirmed: false, refused: true, refused_reason: "Image model 400" }]);
  });

  it("is taken back by the weekly write, whether or not the guide was read", async () => {
    // LinkedIn changed from 1200x1200 to 1200x628 earlier; the model refuses 1200x628.
    await record(run([{ platform: "linkedin", format: "image", outcome: "changed", from: [1200, 1200], to: [1200, 628] }]));
    const back = { platform: "linkedin", format: "image", outcome: "reverted", reason: "model_refused", from: [1200, 628], to: [1200, 1200] };
    expect((await record(run([back], { ok: false, error: "The guide answered 503." }))).changed).toBe(1);
    expect(await one("linkedin", "image")).toMatchObject({ width: 1200, height: 1200, previous_width: null });
    // X has no size before its own: no request reads the row.
    expect((await record(run([{ platform: "x", format: "image", outcome: "unusable", reason: "model_refused", from: [1600, 900] }], { ok: false, error: "x" }))).changed).toBe(1);
    expect((await db.query("select usable, width, height from public.platform_sizes where platform = 'x'")).rows).toEqual([{ usable: false, width: 1600, height: 900 }]);
    // A new size from the guide makes the row usable again.
    await record(run([{ platform: "x", format: "image", outcome: "changed", from: [1600, 900], to: [1600, 1000] }]));
    expect((await db.query("select usable, width, height from public.platform_sizes where platform = 'x'")).rows).toEqual([{ usable: true, width: 1600, height: 1000 }]);
  });
});

describe("when the job is queued", () => {
  const enqueue = async (at: string, dry = false) => (await as<{ out: { due: boolean; queued: boolean } }>("service_role", "select public.enqueue_platform_sizes_job($1::timestamptz, $2) as out", [at, dry]))[0].out;
  const jobs = async () => (await db.query<{ kind: string; client_id: string | null; dedupe_key: string; status: string }>("select kind, client_id, dedupe_key, status from public.scheduled_jobs order by dedupe_key")).rows;
  const finish = (status: string, at: string) => db.query("update public.scheduled_jobs set status = $1, finished_at = $2::timestamptz where kind = 'platform_sizes' and status in ('queued', 'running')", [status, at]);

  it("queues the first run on the first morning, whatever the day, with no client", async () => {
    // Wednesday 18 Nov 2026.
    expect(await enqueue("2026-11-18T05:30:00Z")).toMatchObject({ due: true, queued: true });
    expect(await jobs()).toEqual([{ kind: "platform_sizes", client_id: null, dedupe_key: "platform_sizes:2026-11-18", status: "queued" }]);
    // Never a second one while it is open, and a dry run queues nothing.
    expect(await enqueue("2026-11-18T05:31:00Z")).toMatchObject({ due: false, queued: false });
  });

  it("then runs on Mondays, and catches up the day after a Monday that failed", async () => {
    await enqueue("2026-11-18T05:30:00Z");
    await finish("done", "2026-11-18T05:31:00Z");
    expect(await enqueue("2026-11-19T05:30:00Z")).toMatchObject({ due: false });
    expect(await enqueue("2026-11-22T05:30:00Z")).toMatchObject({ due: false });
    // Monday 23 Nov.
    expect(await enqueue("2026-11-23T05:30:00Z", true)).toMatchObject({ due: true, queued: false });
    expect(await enqueue("2026-11-23T05:30:00Z")).toMatchObject({ due: true, queued: true });
    await finish("failed", "2026-11-23T06:00:00Z");
    // Tuesday to Wednesday: the last finished run is under 8 days old; from Thursday 26 Nov it is 8.
    expect(await enqueue("2026-11-24T05:30:00Z")).toMatchObject({ due: false });
    expect(await enqueue("2026-11-26T05:30:00Z")).toMatchObject({ due: true, queued: true });
  });

  it("keeps every kind the queue already allowed, and the kinds that already had no client", async () => {
    await db.exec("insert into public.scheduled_jobs (kind, client_id, dedupe_key) values ('sprout_onboarding', null, 'a'), ('moments_list', null, 'b'), ('feed_refresh', gen_random_uuid(), 'c')");
    await expect(db.exec("insert into public.scheduled_jobs (kind, client_id, dedupe_key) values ('feed_refresh', null, 'd')")).rejects.toThrow(/scheduled_jobs_client_required/);
    await expect(db.exec("insert into public.scheduled_jobs (kind, client_id, dedupe_key) values ('made_up', gen_random_uuid(), 'e')")).rejects.toThrow(/scheduled_jobs_kind_check/);
  });

  it("is called by pg_cron every day at 05:30 UTC, on one line however often the file runs", async () => {
    const { rows } = await db.query<{ jobname: string; schedule: string; command: string }>("select jobname, schedule, command from cron.job");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ jobname: "platform-sizes-enqueue", schedule: "30 5 * * *" });
    expect(rows[0].command).toContain("public.enqueue_platform_sizes_job()");
  });
});
