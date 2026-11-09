// @vitest-environment node
// 20261110140000_seasonal_relevance.sql, applied twice to PGlite over the
// smallest schema it touches. A person's delete of a planned seasonal post
// records the removal and queues the memory's lesson; a service delete or any
// other post does neither; nothing in the trigger can fail the delete. The
// new tables carry their row level security and the OAuth guards, and the job
// kinds and memory source are added to what was there.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");
const migration = readFileSync(join(migrations, "20261110140000_seasonal_relevance.sql"), "utf8");

const MOBURST = "00000000-0000-4000-8000-000000000003";
const PLAN = "00000000-0000-4000-8000-000000000011";
const PERSON = "00000000-0000-4000-8000-0000000000aa";
const APP = { sub: PERSON, role: "authenticated", aud: "authenticated", session_id: "s1" };
const SERVICE = { role: "service_role" };

const SEASONAL = JSON.stringify([{ type: "seasonal", label: "Halloween, Oct 31.", fit: "Fits.", test: false,
  evidence: [{ id: "M1", kind: "moment", text: "Halloween", key: "us:halloween", category: "cultural_commercial", date: "2026-10-31", link: "https://x.test/h" }] }]);
const OLD_SEASONAL = JSON.stringify([{ type: "seasonal", label: "Election Day on Nov 3.", moment: "Election Day on Nov 3", test: false }]);
const PERFORMANCE = JSON.stringify([{ type: "performance", label: "Your post did well.", test: false }]);

const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create function public.is_moburst_staff() returns boolean language sql stable as $$ select auth.uid() is not null $$;
create function public.can_write_client(uuid) returns boolean language sql stable as $$ select auth.uid() is not null or auth.role() = 'service_role' $$;
create function public.is_oauth_session() returns boolean language sql stable as $$ select coalesce(auth.jwt() ->> 'client_id', '') <> '' $$;
create table public.clients (id uuid primary key, name text);
create table public.calendar_plans (id uuid primary key, client_id uuid not null references public.clients(id), week_start date not null);
create table public.calendar_posts (id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id), plan_id uuid,
  post_date date not null, post_key text not null, platform text not null default 'Instagram', copy text not null default '', reasons jsonb not null default '[]'::jsonb);
alter table public.calendar_posts enable row level security;
create policy "Staff write calendar posts" on public.calendar_posts for all to authenticated using (public.can_write_client(client_id)) with check (public.can_write_client(client_id));
create table public.scheduled_jobs (id uuid primary key default gen_random_uuid(), kind text not null, client_id uuid, dedupe_key text unique, payload jsonb,
  priority smallint, available_at timestamptz, status text not null default 'queued',
  constraint scheduled_jobs_kind_check check (kind = any ('{dispatch,notes_read,sprout_onboarding,voice_profile,week_plan}'::text[])),
  constraint scheduled_jobs_client_required check (client_id is not null or kind = 'sprout_onboarding'));
create table public.brand_voice_learnings (id uuid primary key default gen_random_uuid(), client_id uuid not null, pattern_type text not null, pattern_description text not null,
  source text not null default 'copy_edit', constraint brand_voice_learnings_source_check check (source in ('copy_edit', 'revise_note', 'rewrite_note')));
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
insert into public.clients values ('${MOBURST}', 'Moburst');
insert into public.calendar_plans values ('${PLAN}', '${MOBURST}', '2026-10-26');
`;

let db: PGlite;
const as = async (role: "authenticated" | "service_role" | null, claims: object | null) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [claims ? JSON.stringify(claims) : ""]);
  if (role) await db.exec(`set role ${role}`);
};
const rows = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, params)).rows;
const addPost = async (key: string, reasons: string, plan: string | null = PLAN) => {
  await as(null, null);
  await db.query(`insert into public.calendar_posts (client_id, plan_id, post_date, post_key, reasons) values ($1, $2, '2026-10-31', $3, $4::jsonb)`, [MOBURST, plan, key, reasons]);
};
const remove = async (key: string, who: "person" | "service") => {
  await (who === "person" ? as("authenticated", APP) : as("service_role", SERVICE));
  await db.query(`delete from public.calendar_posts where post_key = $1`, [key]);
};
const removals = async () => { await as(null, null); return rows(`select moment_key, moment_name, category, post_key, removed_by from public.moment_removals order by removed_at, post_key`); };
const feedbackJobs = async () => { await as(null, null); return rows(`select kind, client_id, payload, priority from public.scheduled_jobs where kind = 'moment_feedback' order by dedupe_key`); };
const left = async (key: string) => { await as(null, null); return (await rows(`select count(*)::int as n from public.calendar_posts where post_key = $1`, [key]))[0].n; };

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(migration);
  await db.exec(migration);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe("20261110140000_seasonal_relevance.sql", () => {
  it("adds its tables with row level security, a staff read policy and the three OAuth guards each, and only adds", async () => {
    await as(null, null);
    for (const table of ["moments", "moment_lists", "moment_removals"]) {
      const [t] = await rows(`select c.relrowsecurity as rls from pg_class c where c.relname = $1`, [table]);
      expect(t?.rls, table).toBe(true);
      const guards = await rows(`select count(*)::int as n from pg_policies where tablename = $1 and permissive = 'RESTRICTIVE' and policyname like 'OAuth sessions cannot %'`, [table]);
      expect(guards[0].n, table).toBe(3);
      const reads = await rows(`select count(*)::int as n from pg_policies where tablename = $1 and permissive = 'PERMISSIVE' and cmd = 'SELECT'`, [table]);
      expect(reads[0].n, table).toBe(1);
    }
    expect(migration).not.toMatch(/\bdrop table\b|\bdrop column\b|\btruncate\b/i);
    expect((await rows(`select column_name from information_schema.columns where table_name = 'calendar_plans' and column_name = 'moments'`)).length).toBe(1);
  });

  it("lets people read moments but never write them", async () => {
    await as("authenticated", APP);
    await expect(db.query(`insert into public.moments (key, country, name, date, category, link, listed_for) values ('us:x', 'US', 'X', '2026-11-03', 'sports', 'https://x.test', '2026-11-02')`)).rejects.toThrow();
    expect(await rows(`select * from public.moments`)).toEqual([]);
    await as("service_role", SERVICE);
    await db.query(`insert into public.moments (key, country, name, date, category, link, listed_for) values ('us:x', 'US', 'X', '2026-11-03', 'sports', 'https://x.test', '2026-11-02')`);
    await expect(db.query(`insert into public.moments (key, country, name, date, category, link, listed_for) values ('us:y', 'US', 'Y', '2026-11-03', 'sports', 'no link', '2026-11-02')`)).rejects.toThrow();
  });

  it("records a person's removal of a planned seasonal post with its moment, and queues the memory's lesson", async () => {
    await addPost("post:halloween", SEASONAL);
    await remove("post:halloween", "person");
    expect(await left("post:halloween")).toBe(0);
    expect(await removals()).toEqual([{ moment_key: "us:halloween", moment_name: "Halloween", category: "cultural_commercial", post_key: "post:halloween", removed_by: PERSON }]);
    const jobs = await feedbackJobs();
    expect(jobs).toEqual([{ kind: "moment_feedback", client_id: MOBURST, payload: { removal_id: expect.any(String) }, priority: 45 }]);
  });

  it("records a seasonal post planned before moments had keys by its words, with no key to block", async () => {
    await addPost("post:election", OLD_SEASONAL);
    await remove("post:election", "person");
    expect((await removals()).find((r) => r.post_key === "post:election")).toEqual({ moment_key: null, moment_name: "Election Day on Nov 3", category: null, post_key: "post:election", removed_by: PERSON });
  });

  it("records nothing for a service delete, a post that isn't seasonal, or a seasonal post a person added", async () => {
    const before = (await removals()).length;
    const jobsBefore = (await feedbackJobs()).length;
    await addPost("post:service", SEASONAL);
    await remove("post:service", "service");
    await addPost("post:performance", PERFORMANCE);
    await remove("post:performance", "person");
    await addPost("post:added", SEASONAL, null);
    await remove("post:added", "person");
    for (const key of ["post:service", "post:performance", "post:added"]) expect(await left(key)).toBe(0);
    expect((await removals()).length).toBe(before);
    expect((await feedbackJobs()).length).toBe(jobsBefore);
  });

  it("never blocks the delete when the removal can't be recorded", async () => {
    await as(null, null);
    await db.exec(`alter table public.scheduled_jobs add constraint refuse_feedback check (kind <> 'moment_feedback') not valid`);
    const before = (await removals()).length;
    await addPost("post:broken", SEASONAL);
    await remove("post:broken", "person");
    expect(await left("post:broken")).toBe(0);
    // The removal and its job go together or not at all.
    expect((await removals()).length).toBe(before);
    await as(null, null);
    await db.exec(`alter table public.scheduled_jobs drop constraint refuse_feedback`);
  });

  it("adds the three job kinds to the ones there, lets a country's list belong to no client, and the memory learn from removals", async () => {
    await as(null, null);
    const [{ def }] = await rows(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'scheduled_jobs_kind_check'`);
    for (const kind of ["dispatch", "notes_read", "sprout_onboarding", "voice_profile", "week_plan", "moments_list", "week_moments", "moment_feedback"]) expect(String(def)).toContain(kind);
    await db.query(`insert into public.scheduled_jobs (kind, client_id, dedupe_key, payload) values ('moments_list', null, 'moments_list:us:2026-11-02', '{"country":"US"}')`);
    await expect(db.query(`insert into public.scheduled_jobs (kind, client_id, dedupe_key) values ('week_moments', null, 'week_moments:none')`)).rejects.toThrow();
    await db.query(`insert into public.brand_voice_learnings (client_id, pattern_type, pattern_description, source) values ($1, 'topics', 'Skip civic and political moments.', 'moment_removed')`, [MOBURST]);
    // The sources already there stay: a rewrite note still teaches the memory.
    await db.query(`insert into public.brand_voice_learnings (client_id, pattern_type, pattern_description, source) values ($1, 'tone', 'Shorter.', 'rewrite_note')`, [MOBURST]);
    await expect(db.query(`insert into public.brand_voice_learnings (client_id, pattern_type, pattern_description, source) values ($1, 'tone', 'X.', 'made_up')`, [MOBURST])).rejects.toThrow();
  });
});
