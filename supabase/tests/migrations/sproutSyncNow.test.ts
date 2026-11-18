// @vitest-environment node
// 20261118130000_sprout_sync_now.sql, applied twice to PGlite beside the
// weekly rule as 20261108130000_sprout_auto_onboarding.sql has it: a run a
// person starts is queued once with a key of its own, never while a run is
// queued or running, and the weekly run goes on as before.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migrations = join(functionsDir, "..", "migrations");
const migration = readFileSync(join(migrations, "20261118130000_sprout_sync_now.sql"), "utf8");
// The weekly rule itself, as its own migration declares it: the last section of that file.
const weeklyFile = readFileSync(join(migrations, "20261108130000_sprout_auto_onboarding.sql"), "utf8");
const weekly = weeklyFile.slice(weeklyFile.indexOf("create or replace function public.enqueue_sprout_onboarding_job"));

const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create table public.scheduled_jobs (
  id uuid primary key default gen_random_uuid(), kind text not null, client_id uuid, payload jsonb, dedupe_key text not null unique,
  priority smallint not null default 50, status text not null default 'queued', available_at timestamptz not null default now(),
  created_at timestamptz not null default now(), finished_at timestamptz);
`;

type Answer = { queued: boolean; job_id: string | null; dedupe_key: string | null };
type Job = { id: string; dedupe_key: string; status: string; priority: number; client_id: string | null; kind: string };

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(weekly);
  await db.exec(migration);
  await db.exec(migration);
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.exec("reset role; delete from public.scheduled_jobs"); });

const now = async () => (await db.query<{ a: Answer }>("select public.enqueue_sprout_onboarding_now() as a")).rows[0].a;
const weeklyAt = async (at: string) => (await db.query<{ a: { due: boolean; queued: boolean; dedupe_key: string | null; last_run: string | null } }>("select public.enqueue_sprout_onboarding_job($1::timestamptz) as a", [at])).rows[0].a;
const jobs = async () => (await db.query<Job>("select id, dedupe_key, status, priority, client_id, kind from public.scheduled_jobs order by created_at, dedupe_key")).rows;
const finish = (id: string, status: string, at: string) => db.query("update public.scheduled_jobs set status = $2, finished_at = $3::timestamptz where id = $1", [id, status, at]);

describe("enqueue_sprout_onboarding_now", () => {
  it("leaves the weekly function's text as its own migration has it", () => {
    expect(weekly).toContain("v_due := not v_open and (v_monday or v_last is null or v_last <= v_today - 8);");
    expect(migration).not.toMatch(/function public\.enqueue_sprout_onboarding_job/);
    expect(migration).not.toMatch(/cron\./);
  });

  it("queues one sprout_onboarding job for now, with a key of its own", async () => {
    const answer = await now();
    expect(answer.queued).toBe(true);
    expect(answer.dedupe_key).toMatch(/^sprout_onboarding:now:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z:[0-9a-f]{12}$/);
    const all = await jobs();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: answer.job_id, kind: "sprout_onboarding", client_id: null, status: "queued", priority: 15, dedupe_key: answer.dedupe_key });
    const due = await db.query<{ due: boolean }>("select available_at <= now() as due from public.scheduled_jobs");
    expect(due.rows[0].due).toBe(true);
  });

  it("queues nothing while a run is queued or running, and names that run", async () => {
    const first = await now();
    expect(await now()).toEqual({ queued: false, job_id: first.job_id, dedupe_key: null });
    await db.query("update public.scheduled_jobs set status = 'running'");
    expect(await now()).toEqual({ queued: false, job_id: first.job_id, dedupe_key: null });
    expect(await jobs()).toHaveLength(1);
  });

  it("counts the weekly run and the rest of a run as a run under way", async () => {
    // Monday 9 Nov 2026, 06:00 UTC: the weekly run is queued.
    const monday = await weeklyAt("2026-11-09T06:00:00Z");
    expect(monday.queued).toBe(true);
    expect((await now()).queued).toBe(false);
    // It finishes and leaves the rest of its brands to a run a minute later.
    const [weeklyJob] = await jobs();
    await finish(weeklyJob.id, "done", "2026-11-09T06:02:00Z");
    await db.query("insert into public.scheduled_jobs (kind, client_id, payload, dedupe_key) values ('sprout_onboarding', null, '{\"left\":[\"1\"]}', $1)", [`sprout_onboarding:rest:${weeklyJob.id}`]);
    expect((await now()).queued).toBe(false);
    expect(await jobs()).toHaveLength(2);
  });

  it("queues again once the run before it is over, done or not", async () => {
    const first = await now();
    await finish(first.job_id!, "done", "2026-11-13T10:00:00Z");
    const second = await now();
    expect(second.queued).toBe(true);
    await finish(second.job_id!, "failed", "2026-11-13T10:30:00Z");
    const third = await now();
    expect(third.queued).toBe(true);
    expect(new Set([first.dedupe_key, second.dedupe_key, third.dedupe_key]).size).toBe(3);
  });

  it("lets the service role call it and nobody else", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query("select public.enqueue_sprout_onboarding_now()")).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    expect((await now()).queued).toBe(true);
    await db.exec("reset role");
  });
});

describe("the weekly run after a run a person started", () => {
  it("still runs on Monday after a run on Friday", async () => {
    const friday = await now();
    await finish(friday.job_id!, "done", "2026-11-13T10:00:00Z");
    // Saturday and Sunday: a run finished within 8 days, so nothing is due.
    expect((await weeklyAt("2026-11-14T06:00:00Z")).due).toBe(false);
    expect((await weeklyAt("2026-11-15T06:00:00Z")).due).toBe(false);
    const monday = await weeklyAt("2026-11-16T06:00:00Z");
    expect(monday).toMatchObject({ due: true, queued: true, dedupe_key: "sprout_onboarding:2026-11-16", last_run: "2026-11-13" });
    expect((await jobs()).map((j) => j.dedupe_key)).toContain("sprout_onboarding:2026-11-16");
  });

  it("keeps the weekly run's own key and priority, on the same Monday as a run a person started", async () => {
    const early = await now();
    await finish(early.job_id!, "done", "2026-11-16T05:00:00Z");
    expect((await weeklyAt("2026-11-16T06:00:00Z")).queued).toBe(true);
    const weeklyJob = (await jobs()).find((j) => j.dedupe_key === "sprout_onboarding:2026-11-16")!;
    expect(weeklyJob.priority).toBe(50);
  });

  it("is not queued a second time while a run a person started is under way", async () => {
    await now();
    expect(await weeklyAt("2026-11-16T06:00:00Z")).toMatchObject({ due: false, queued: false });
    expect(await jobs()).toHaveLength(1);
  });

  it("is caught up as before when the run a person started did not finish", async () => {
    const lastMonday = await weeklyAt("2026-11-09T06:00:00Z");
    expect(lastMonday.queued).toBe(true);
    const [weeklyJob] = await jobs();
    await finish(weeklyJob.id, "done", "2026-11-09T06:02:00Z");
    const tried = await now();
    await finish(tried.job_id!, "failed", "2026-11-13T10:00:00Z");
    // A failed run is not a finished one: the 8 days are still counted from 9 Nov.
    expect(await weeklyAt("2026-11-17T06:00:00Z")).toMatchObject({ due: true, queued: true, last_run: "2026-11-09" });
  });

  it("counts the 8 days from a finished run a person started", async () => {
    const started = await now();
    await finish(started.job_id!, "done", "2026-11-11T10:00:00Z");
    // Thursday 19 Nov is 8 days after Wednesday 11 Nov; Wednesday 18 Nov is 7.
    expect((await weeklyAt("2026-11-18T06:00:00Z")).due).toBe(false);
    expect((await weeklyAt("2026-11-19T06:00:00Z")).due).toBe(true);
  });
});
