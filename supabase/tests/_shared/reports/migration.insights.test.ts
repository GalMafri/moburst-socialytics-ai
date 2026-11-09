// @vitest-environment node
// 20261110220000_data_driven_insights.sql, applied twice to PGlite over the
// smallest schema it touches. People read the insights of reports they can
// see and never write them; go-live is fixed the first time the migration
// runs; a finished report gets one waiting insights job; the team's votes
// queue nothing (they apply when a report is read).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");
const migration = readFileSync(join(migrations, "20261110220000_data_driven_insights.sql"), "utf8");

const MOBURST = "00000000-0000-4000-8000-000000000003";
const OTHER = "00000000-0000-4000-8000-000000000004";
const OLD = "00000000-0000-4000-8000-0000000000c1";
const NEW = "00000000-0000-4000-8000-0000000000c2";
const MONTHLY = "00000000-0000-4000-8000-0000000000d1";
const PERSON = "00000000-0000-4000-8000-0000000000aa";
const APP = { sub: PERSON, role: "authenticated", aud: "authenticated", session_id: "s1" };
const HASH = "a".repeat(64);

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

create function public.is_moburst_staff() returns boolean language sql stable as $$ select false $$;
create function public.is_client_member(uuid) returns boolean language sql stable as $$ select $1 = '${MOBURST}'::uuid $$;
create function public.is_oauth_session() returns boolean language sql stable as $$ select coalesce(auth.jwt() ->> 'client_id', '') <> '' $$;
create table public.clients (id uuid primary key, name text, archived_at timestamptz);
create table public.reports (id uuid primary key, client_id uuid not null, status text not null, created_at timestamptz not null default now());
create table public.competitive_reports (id uuid primary key, client_id uuid not null, status text not null, created_at timestamptz not null default now());
create table public.competitive_insight_feedback (id uuid primary key default gen_random_uuid(), client_id uuid not null, insight_key text not null, gap_text text not null,
  verdict text, edited jsonb, unique (client_id, insight_key));
create table public.scheduled_jobs (id uuid primary key default gen_random_uuid(), kind text not null, client_id uuid, dedupe_key text unique, payload jsonb,
  priority smallint, available_at timestamptz, status text not null default 'queued',
  constraint scheduled_jobs_kind_check check (kind = any ('{dispatch,report_text,week_plan}'::text[])));
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
insert into public.clients values ('${MOBURST}', 'Moburst', null), ('${OTHER}', 'Other', null);
`;

let db: PGlite;
const as = async (role: "authenticated" | "service_role" | null, claims: object | null) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [claims ? JSON.stringify(claims) : ""]);
  if (role) await db.exec(`set role ${role}`);
};
const rows = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, params)).rows;
const queued = async () => { await as(null, null); return rows(`select kind, client_id, payload, priority, status from public.scheduled_jobs where kind = 'report_insights' order by dedupe_key`); };
let liveFrom = "";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(migration);
  liveFrom = String((await rows(`select public.report_insights_live_from()::text as t`))[0].t);
  await db.exec(migration);
  await db.query(`insert into public.competitive_reports values ($1, $2, 'complete', $3::timestamptz - interval '30 days'), ($4, $2, 'complete', $3::timestamptz + interval '1 day')`, [OLD, MOBURST, liveFrom, NEW]);
  await db.query(`insert into public.reports values ($1, $2, 'completed', $3::timestamptz + interval '1 day')`, [MONTHLY, MOBURST, liveFrom]);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe("20261110220000_data_driven_insights.sql", () => {
  it("adds report_insights with row level security, one read policy, the three OAuth guards, and only adds", async () => {
    await as(null, null);
    expect((await rows(`select relrowsecurity as rls from pg_class where relname = 'report_insights'`))[0].rls).toBe(true);
    expect((await rows(`select count(*)::int as n from pg_policies where tablename = 'report_insights' and permissive = 'RESTRICTIVE' and policyname like 'OAuth sessions cannot %'`))[0].n).toBe(3);
    expect(migration).not.toMatch(/\bdrop table\b|\bdrop column\b|\btruncate\b/i);
  });

  it("lets a client's member read its insights, nobody else's, and never write them", async () => {
    await as("service_role", { role: "service_role" });
    for (const [client, report] of [[MOBURST, MONTHLY], [OTHER, OLD]]) {
      await db.query(`insert into public.report_insights (report_table, report_id, client_id, kind, input_hash, facts, fields, source, prompt_version) values ('reports', $1, $2, 'social', $3, '[]', '{}', 'template', 1)`, [report, client, HASH]);
    }
    await as("authenticated", APP);
    expect((await rows(`select client_id from public.report_insights`)).map((r) => r.client_id)).toEqual([MOBURST]);
    await expect(db.query(`insert into public.report_insights (report_table, report_id, client_id, kind, input_hash, facts, fields, source, prompt_version) values ('reports', $1, $2, 'social', $3, '[]', '{}', 'model', 1)`, [NEW, MOBURST, "b".repeat(64)])).rejects.toThrow();
  });

  it("keeps go-live as the first run set it, and only the service role reads it", async () => {
    await as(null, null);
    expect(String((await rows(`select public.report_insights_live_from()::text as t`))[0].t)).toBe(liveFrom);
    await as("authenticated", APP);
    await expect(db.query(`select public.report_insights_live_from()`)).rejects.toThrow();
  });

  it("queues one waiting insights job per finished report, and none for an unknown table or report", async () => {
    await as("service_role", { role: "service_role" });
    await db.query(`select public.report_insights_queue('reports', $1)`, [MONTHLY]);
    await db.query(`select public.report_insights_queue('reports', $1)`, [MONTHLY]);
    await db.query(`select public.report_insights_queue('nope', $1)`, [MONTHLY]);
    await db.query(`select public.report_insights_queue('competitive_reports', $1)`, [MONTHLY]);
    expect(await queued()).toEqual([{ kind: "report_insights", client_id: MOBURST, payload: { table: "reports", report_id: MONTHLY }, priority: 71, status: "queued" }]);
    await as("authenticated", APP);
    await expect(db.query(`select public.report_insights_queue('reports', $1)`, [MONTHLY])).rejects.toThrow();
  });

  it("leaves the team's votes alone: no verdict or edit queues or re-words a report", async () => {
    await as(null, null);
    expect(migration).not.toMatch(/competitive_insight_feedback|report_insights_on_feedback/);
    expect((await rows(`select count(*)::int as n from pg_trigger where tgrelid = 'public.competitive_insight_feedback'::regclass and not tgisinternal`))[0].n).toBe(0);
    expect((await rows(`select count(*)::int as n from pg_proc where proname = 'report_insights_on_feedback'`))[0].n).toBe(0);
    await db.query(`insert into public.competitive_insight_feedback (client_id, insight_key, gap_text, verdict) values ($1, 'post-more-memes', 'Post more memes', 'down')`, [MOBURST]);
    expect((await queued()).filter((j) => (j.payload as { table: string }).table === "competitive_reports")).toEqual([]);
  });

  it("adds the job kind to the ones there", async () => {
    await as(null, null);
    const [{ def }] = await rows(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'scheduled_jobs_kind_check'`);
    for (const kind of ["dispatch", "report_text", "week_plan", "report_insights"]) expect(String(def)).toContain(kind);
  });
});
