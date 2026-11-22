// @vitest-environment node
// 20261122131000_calendar_stop_plan_intent.sql, applied twice to PGlite over
// the calendar tables (QA 22 Nov 2026, P56-07): "Stop planning" pressed on a
// plan that finished meanwhile leaves the finished week as it is; "Remove"
// and a caller that names no intent remove it as before.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migration = readFileSync(join(functionsDir, "..", "migrations", "20261122131000_calendar_stop_plan_intent.sql"), "utf8");
const C = "00000000-0000-4000-8000-0000000000c1";
const PLAN = "00000000-0000-4000-8000-0000000000a1";

// The tables as far as calendar_stop_plan needs them; calendar_post_worked stands in for the real rule.
const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create table public.clients (id uuid primary key, timezone text);
create table public.calendar_plans (id uuid primary key, client_id uuid, week_start date, status text, claimed_at timestamptz,
  pending_revision jsonb, revisions jsonb, error text, canceled_at timestamptz, canceled_by uuid, updated_at timestamptz);
create table public.scheduled_jobs (id serial primary key, kind text, client_id uuid, occurrence timestamptz, status text, reason text,
  lease_until timestamptz, finished_at timestamptz, updated_at timestamptz);
create table public.calendar_posts (id serial primary key, client_id uuid, post_key text, platform text, copy text, touched_at timestamptz, plan_id uuid);
create table public.calendar_posts_archive (like public.calendar_posts);
alter table public.calendar_posts_archive add column archived_at timestamptz;
alter table public.calendar_posts_archive add column archive_reason text;
create function public.is_oauth_session() returns boolean language sql as $$ select false $$;
create function public.calendar_post_worked(c uuid, k text, p text, copy text, t timestamptz) returns boolean language sql as $$ select t is not null $$;
-- The function as 20261110100000_calendar_plan_cancel.sql left it (body not needed here).
create function public.calendar_stop_plan(p_plan uuid, p_user uuid default null) returns public.calendar_plans
  language sql as $$ select * from public.calendar_plans where id = p_plan $$;
`;

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(migration);
  await db.exec(migration);
}, 30_000);
afterAll(async () => { await db.close(); });

async function plan(status: string) {
  await db.exec(`
    delete from public.calendar_plans; delete from public.calendar_posts; delete from public.calendar_posts_archive; delete from public.scheduled_jobs; delete from public.clients;
    insert into public.clients (id, timezone) values ('${C}', 'UTC');
    insert into public.calendar_plans (id, client_id, week_start, status) values ('${PLAN}', '${C}', (current_date + 7 - extract(isodow from current_date)::int + 1), '${status}');
    insert into public.calendar_posts (client_id, post_key, platform, copy, touched_at, plan_id) values
      ('${C}', 'a', 'Instagram', 'Written by the plan', null, '${PLAN}'),
      ('${C}', 'b', 'Instagram', 'Edited by a person', now(), '${PLAN}');
    insert into public.scheduled_jobs (kind, client_id, occurrence, status) values ('week_plan', '${C}', (select week_start from public.calendar_plans)::timestamptz, 'running');
  `);
}
const state = async () => {
  const p = await db.query<{ status: string }>("select status from public.calendar_plans");
  const posts = await db.query<{ post_key: string }>("select post_key from public.calendar_posts order by post_key");
  return { status: p.rows[0].status, posts: posts.rows.map((r) => r.post_key) };
};

describe("calendar_stop_plan with the button's intent", () => {
  beforeEach(async () => { await plan("ready"); });

  it("leaves one function, with the intent as its third argument", async () => {
    const { rows } = await db.query<{ args: string }>("select pg_get_function_identity_arguments(p.oid) as args from pg_proc p where p.proname = 'calendar_stop_plan'");
    expect(rows.map((r) => r.args)).toEqual(["p_plan uuid, p_user uuid, p_intent text"]);
  });

  it("'stop' on a plan that finished meanwhile removes nothing and answers the plan as ready", async () => {
    const { rows } = await db.query<{ status: string }>("select (public.calendar_stop_plan($1, null, 'stop')).status", [PLAN]);
    expect(rows[0].status).toBe("ready");
    expect(await state()).toEqual({ status: "ready", posts: ["a", "b"] });
  });

  it("'remove' on a finished plan removes it, keeping the posts a person worked on", async () => {
    await db.query("select public.calendar_stop_plan($1, null, 'remove')", [PLAN]);
    expect(await state()).toEqual({ status: "canceled", posts: ["b"] });
  });

  it("a caller that names no intent, with two arguments, removes it as before", async () => {
    await db.query("select public.calendar_stop_plan(p_plan => $1, p_user => null)", [PLAN]);
    expect(await state()).toEqual({ status: "canceled", posts: ["b"] });
  });

  it("'stop' on a plan on its way stops it and closes its run", async () => {
    await plan("planning");
    await db.query("select public.calendar_stop_plan($1, null, 'stop')", [PLAN]);
    expect(await state()).toEqual({ status: "canceled", posts: ["b"] });
    const { rows } = await db.query<{ status: string }>("select status from public.scheduled_jobs");
    expect(rows[0].status).toBe("skipped");
  });

  it("refuses an intent it does not know", async () => {
    await expect(db.query("select public.calendar_stop_plan($1, null, 'other')", [PLAN])).rejects.toMatchObject({ code: "22023" });
  });
});
