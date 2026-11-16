// @vitest-environment node
// 20261113101501_trend_past_weeks_close.sql on PGlite: the weekly enqueue
// closes a trend week that is over and has no run going (a stop on the week's
// last day, or retries that crossed Monday), still collects again a week of
// the current week whose run stopped, and still closes a week at three stops.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");
const migration = readFileSync(join(migrations, "20261113101501_trend_past_weeks_close.sql"), "utf8");

const C = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const W = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.clients (id uuid primary key, archived_at timestamptz, exclude_from_reporting boolean, demo_job_id uuid);
    create table public.trend_profiles (client_id uuid primary key);
    create table public.trend_weeks (id uuid primary key, client_id uuid not null, week_start date not null, status text not null, finished_at timestamptz, created_at timestamptz not null default now());
    create table public.report_pipeline_runs (id uuid primary key default gen_random_uuid(), real_id uuid, status text not null);
    create table public.scheduled_jobs (id uuid primary key default gen_random_uuid(), kind text, client_id uuid, dedupe_key text unique, priority int, available_at timestamptz);
    create function public.feed_refresh_weekday(c uuid) returns int language sql as $$ select 1 $$;
  `);
  await db.exec(migration);
  await db.exec(migration);
});
afterAll(async () => { await db.close(); });

const NOW = "2026-11-09T07:10:00Z"; // Monday 9 Nov
const statusOf = async (w: string) => ((await db.query<{ status: string }>("select status from public.trend_weeks where id = $1", [w])).rows[0].status);
const reset = async () => {
  await db.exec("truncate public.clients, public.trend_profiles, public.trend_weeks, public.report_pipeline_runs, public.scheduled_jobs");
  for (const n of [1, 2, 3]) {
    await db.query("insert into public.clients (id) values ($1)", [C(n)]);
    await db.query("insert into public.trend_profiles (client_id) values ($1)", [C(n)]);
  }
};
const week = (id: string, client: string, weekStart: string, status = "running") =>
  db.query("insert into public.trend_weeks (id, client_id, week_start, status, created_at) values ($1, $2, $3, $4, $3::date + interval '1 day')", [id, client, weekStart, status]);
const run = (week: string, status: string) => db.query("insert into public.report_pipeline_runs (real_id, status) values ($1, $2)", [week, status]);

describe("enqueue_trend_refresh_jobs closing", () => {
  it("closes a week that is over, has no run going and stopped fewer than three times", async () => {
    await reset();
    // Last week's run stopped on its last day (Sunday 8 Nov): it can no longer be collected again.
    await week(W(1), C(1), "2026-11-02");
    await run(W(1), "stopped");
    await db.query("select * from public.enqueue_trend_refresh_jobs($1::timestamptz)", [NOW]);
    expect(await statusOf(W(1))).toBe("partial");
  });

  it("closes a past week that never got a run", async () => {
    await reset();
    await week(W(1), C(1), "2026-11-02");
    await db.query("select * from public.enqueue_trend_refresh_jobs($1::timestamptz)", [NOW]);
    expect(await statusOf(W(1))).toBe("partial");
  });

  it("leaves a past week with a run still going", async () => {
    await reset();
    await week(W(1), C(1), "2026-11-02");
    await run(W(1), "running");
    await db.query("select * from public.enqueue_trend_refresh_jobs($1::timestamptz)", [NOW]);
    expect(await statusOf(W(1))).toBe("running");
  });

  it("still collects the current week again after a stop, and closes it only at three stops", async () => {
    await reset();
    await week(W(1), C(1), "2026-11-09");
    await run(W(1), "stopped");
    await week(W(2), C(2), "2026-11-09");
    for (let i = 0; i < 3; i++) await run(W(2), "stopped");
    const due = await db.query<{ due_client: string }>("select * from public.enqueue_trend_refresh_jobs($1::timestamptz)", [NOW]);
    expect(await statusOf(W(1))).toBe("running");
    expect(await statusOf(W(2))).toBe("partial");
    expect(due.rows.map((r) => r.due_client)).toContain(C(1));
    expect(due.rows.map((r) => r.due_client)).not.toContain(C(2));
  });

  it("closes nothing on a dry run", async () => {
    await reset();
    await week(W(1), C(1), "2026-11-02");
    await db.query("select * from public.enqueue_trend_refresh_jobs($1::timestamptz, true)", [NOW]);
    expect(await statusOf(W(1))).toBe("running");
  });
});
