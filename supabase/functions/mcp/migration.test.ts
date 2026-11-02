// @vitest-environment node
// 20261109120000_claude_connector.sql, applied twice to PGlite over the
// smallest schema its functions and policies touch. A session from Supabase's
// OAuth server (the Claude connector) reads but cannot write a table, a
// storage object or call a write function; an app session, the service role
// and the database owner write exactly as before. The audit columns and the
// per-person rate limit are there, reachable by the service role only.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
const migration = readFileSync(join(migrations, "20261109120000_claude_connector.sql"), "utf8");

const CLIENT = "00000000-0000-4000-8000-000000000001";
const PERSON = "00000000-0000-4000-8000-0000000000aa";
const APP = { sub: PERSON, role: "authenticated", aud: "authenticated", session_id: "s1" };
const CONNECTOR = { ...APP, client_id: "9b1f0c4e-3f8a-4c55-9d7e-2a6b1c0d4e5f" };
const SERVICE = { role: "service_role" };

// The parts of Supabase the migration and the five guarded functions rely on.
const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create schema storage;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create policy "Signed-in upload" on storage.objects for all to authenticated using (true) with check (true);
grant usage on schema storage to authenticated, service_role;
grant all on storage.objects to authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase grants every new public table, sequence and function to these roles; revokes are what take access away.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create function public.is_moburst_staff() returns boolean language sql stable as $$ select true $$;
create function public.can_access_client(uuid) returns boolean language sql stable as $$ select true $$;
create table public.clients (id uuid primary key, name text, archived_at timestamptz);
create table public.reports (id uuid primary key default gen_random_uuid(), client_id uuid, status text);
create table public.trend_profiles (client_id uuid primary key, search_overrides jsonb not null default '{}'::jsonb);
create table public.trend_terms (id uuid primary key default gen_random_uuid(), client_id uuid not null, kind text not null, platform text, term text not null,
  reason text not null default '', source text not null, removed_at timestamptz, removed_by uuid, created_at timestamptz not null default now());
create unique index trend_terms_one on public.trend_terms (client_id, kind, coalesce(platform, ''), lower(term));
create table public.trend_themes (id uuid primary key default gen_random_uuid(), client_id uuid not null, title text not null, happening text not null default '',
  dismissed_at timestamptz, dismissed_by uuid);
create table public.client_lifecycle_steps (client_id uuid not null, step text not null, status text not null, attempted_at timestamptz,
  updated_at timestamptz not null default now(), primary key (client_id, step));
create table public.scheduled_jobs (id uuid primary key default gen_random_uuid(), kind text, client_id uuid, payload jsonb, dedupe_key text unique,
  priority smallint, available_at timestamptz);
create table public.api_requests (id bigserial primary key, key_id uuid, method text not null, path text not null, status integer not null,
  duration_ms integer, client_id uuid, job_id uuid, ip text, error_code text, created_at timestamptz not null default now());
create table public.no_policy_audit (id bigserial primary key, note text);
do $$ declare t text; begin
  foreach t in array array['clients','reports','trend_profiles','trend_terms','trend_themes','client_lifecycle_steps','scheduled_jobs','api_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "Legacy broad grant" on public.%I for all to authenticated using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated, service_role', t);
  end loop;
end $$;
grant usage on all sequences in schema public to authenticated, service_role;
insert into public.clients values ('${CLIENT}', 'Bader Law', null);
insert into public.trend_profiles values ('${CLIENT}', '{"tiktok": ["law"], "instagram": ["#law"]}');
`;

let db: PGlite;
const as = async (role: "authenticated" | "service_role" | "anon" | null, claims: object | null) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [claims ? JSON.stringify(claims) : ""]);
  if (role) await db.exec(`set role ${role}`);
};
const rows = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, params)).rows;

/** Seeds one row in each table a write function touches, as the owner. */
async function seed(): Promise<{ term: string; theme: string }> {
  await as(null, null);
  const term = (await rows(`insert into public.trend_terms (client_id, kind, term, source) values ($1, 'topic', 'injury law ' || gen_random_uuid(), 'lifecycle') returning id`, [CLIENT]))[0].id as string;
  const theme = (await rows(`insert into public.trend_themes (client_id, title) values ($1, 'Back to school ' || gen_random_uuid()) returning id`, [CLIENT]))[0].id as string;
  await db.exec(`update public.trend_profiles set search_overrides = '{"tiktok": ["law"], "instagram": ["#law"]}'`);
  await db.exec(`delete from public.client_lifecycle_steps`);
  return { term, theme };
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(migration);
  await db.exec(migration);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe("20261109120000_claude_connector.sql", () => {
  it("tells an OAuth session from an app session, the service role and no session", async () => {
    for (const [role, claims, oauth] of [["authenticated", CONNECTOR, true], ["authenticated", APP, false], ["service_role", SERVICE, false], ["anon", null, false]] as const) {
      await as(role, claims);
      expect((await rows("select public.is_oauth_session() as v"))[0].v, `${role} ${JSON.stringify(claims)}`).toBe(oauth);
    }
  });

  it("lets an OAuth session read every table and write none of them", async () => {
    await as("authenticated", CONNECTOR);
    expect(await rows("select name from public.clients")).toEqual([{ name: "Bader Law" }]);
    await expect(db.query(`insert into public.reports (client_id, status) values ($1, 'completed')`, [CLIENT])).rejects.toThrow(/row-level security/);
    expect(await rows(`update public.clients set name = 'Changed' returning id`)).toEqual([]);
    expect(await rows(`delete from public.clients returning id`)).toEqual([]);
    await expect(db.query(`insert into public.api_requests (method, path, status) values ('MCP', 'x', 200)`)).rejects.toThrow(/row-level security/);
    await expect(db.query(`insert into storage.objects (bucket_id, name) values ('generated-media', 'x.png')`)).rejects.toThrow(/row-level security/);
    await as(null, null);
    expect(await rows("select name from public.clients")).toEqual([{ name: "Bader Law" }]);
  });

  it("guards every table with row level security, the ones it made included, and leaves the others alone", async () => {
    await as(null, null);
    const unguarded = await rows(`
      select c.relname as table from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and c.relrowsecurity and n.nspname in ('public', 'storage')
        and (select count(*) from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname and p.permissive = 'RESTRICTIVE' and p.policyname like 'OAuth sessions cannot %') <> 3`);
    expect(unguarded).toEqual([]);
    expect((await rows(`select count(*)::int as n from pg_policies where tablename = 'no_policy_audit'`))[0].n).toBe(0);
  });

  it("keeps app sessions writing as before", async () => {
    await as("authenticated", APP);
    expect(await rows(`insert into public.reports (client_id, status) values ($1, 'running') returning status`, [CLIENT])).toEqual([{ status: "running" }]);
    expect(await rows(`update public.reports set status = 'completed' returning status`)).toEqual([{ status: "completed" }]);
    expect((await rows(`delete from public.reports returning id`)).length).toBe(1);
    expect((await rows(`insert into storage.objects (bucket_id, name) values ('generated-media', 'a.png') returning name`))[0].name).toBe("a.png");
  });

  it("keeps the service role and the owner writing as before", async () => {
    await as("service_role", SERVICE);
    expect((await rows(`insert into public.reports (client_id, status) values ($1, 'running') returning id`, [CLIENT])).length).toBe(1);
    expect((await rows(`insert into public.api_requests (method, path, status, user_id, oauth_client_id) values ('MCP', 'mcp/socialytics_clients_list', 200, $1, $2) returning id`, [PERSON, CONNECTOR.client_id])).length).toBe(1);
    expect((await rows(`delete from public.reports returning id`)).length).toBe(1);
    await as(null, CONNECTOR);
    expect((await rows(`update public.clients set name = name returning id`)).length).toBe(1);
  });

  it("refuses every write function to an OAuth session before it does anything", async () => {
    const calls = (ids: { term: string; theme: string }) => [
      [`select public.trend_term_add($1, 'topic', null, 'car accidents')`, [CLIENT]],
      [`select public.trend_term_remove($1)`, [ids.term]],
      [`select public.trend_theme_dismiss($1)`, [ids.theme]],
      [`select public.trend_search_override_clear($1, 'tiktok')`, [CLIENT]],
      [`select public.lifecycle_request($1, 'brand_read')`, [CLIENT]],
    ] as const;
    const ids = await seed();
    await as("authenticated", CONNECTOR);
    for (const [sql, params] of calls(ids)) await expect(db.query(sql, [...params]), sql).rejects.toThrow("Connected apps can read Socialytics but cannot change it.");
    await as(null, null);
    expect(await rows(`select term, removed_at from public.trend_terms where term = 'car accidents' or removed_at is not null`)).toEqual([]);
    expect(await rows(`select id from public.trend_themes where dismissed_at is not null`)).toEqual([]);
    expect((await rows(`select search_overrides from public.trend_profiles`))[0].search_overrides).toEqual({ tiktok: ["law"], instagram: ["#law"] });
    expect(await rows(`select step from public.client_lifecycle_steps`)).toEqual([]);
  });

  it("keeps every write function working for an app session and the service role", async () => {
    for (const [role, claims] of [["authenticated", APP], ["service_role", SERVICE]] as const) {
      const ids = await seed();
      await as(role, claims);
      await db.query(`select public.trend_term_add($1, 'topic', null, $2)`, [CLIENT, `car accidents ${role}`]);
      await db.query(`select public.trend_term_remove($1)`, [ids.term]);
      await db.query(`select public.trend_theme_dismiss($1)`, [ids.theme]);
      await db.query(`select public.trend_search_override_clear($1, 'tiktok')`, [CLIENT]);
      await db.query(`select public.lifecycle_request($1, 'brand_read')`, [CLIENT]);
      await as(null, null);
      expect((await rows(`select count(*)::int as n from public.trend_terms where term = $1`, [`car accidents ${role}`]))[0].n, role).toBe(1);
      expect((await rows(`select removed_at from public.trend_terms where id = $1`, [ids.term]))[0].removed_at, role).not.toBeNull();
      expect((await rows(`select dismissed_at from public.trend_themes where id = $1`, [ids.theme]))[0].dismissed_at, role).not.toBeNull();
      expect((await rows(`select search_overrides from public.trend_profiles`))[0].search_overrides, role).toEqual({ instagram: ["#law"] });
      expect(await rows(`select step, status from public.client_lifecycle_steps`), role).toEqual([{ step: "brand_read", status: "running" }]);
    }
  });

  it("counts each person's calls per minute for the service role only", async () => {
    await as("service_role", SERVICE);
    const touch = async () => (await rows(`select public.mcp_rate_touch($1) as n`, [PERSON]))[0].n;
    expect(await touch()).toBe(1);
    expect(await touch()).toBe(2);
    expect((await rows(`select public.mcp_rate_touch($1) as n`, ["00000000-0000-4000-8000-0000000000bb"]))[0].n).toBe(1);
    for (const [role, claims] of [["authenticated", APP], ["authenticated", CONNECTOR], ["anon", null]] as const) {
      await as(role, claims);
      await expect(db.query(`select public.mcp_rate_touch($1)`, [PERSON]), `${role}`).rejects.toThrow(/permission denied/);
    }
  });
});
