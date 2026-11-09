// @vitest-environment node
// 20261110150000_claude_sync.sql, applied twice to PGlite after the
// migrations it builds on (the content strategy, client notes and the Claude
// connector), over the smallest schema they touch. Claude's saves land in
// the tables below only through the connector's service role: a session from
// Supabase's OAuth server still writes none of them, the strategy's save for
// a named person is the service role's alone, and the app's own save works
// as before. Notes carry their source and a hash of their text, decks are
// read by whoever can see their report, and the audit row names its target.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noteTextHash } from "../../functions/_shared/notes/add";
import { sectionVersion } from "../../functions/mcp/reads";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
const read = (f: string) => readFileSync(join(migrations, f), "utf8");
const SYNC = read("20261110150000_claude_sync.sql");

const BADER = "00000000-0000-4000-8000-000000000001";
const CALM = "00000000-0000-4000-8000-000000000002";
const STAFF = "00000000-0000-4000-8000-0000000000aa";
const BADER_USER = "00000000-0000-4000-8000-0000000000bb";
const CALM_USER = "00000000-0000-4000-8000-0000000000cc";
const OAUTH_CLIENT = "9b1f0c4e-3f8a-4c55-9d7e-2a6b1c0d4e5f";
const app = (sub: string) => ({ sub, role: "authenticated", aud: "authenticated", session_id: "s1" });
const oauth = (sub: string) => ({ ...app(sub), client_id: OAUTH_CLIENT });
const SERVICE = { role: "service_role" };

// The parts of Supabase and of earlier migrations the four migrations rely on.
const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
create table auth.users (id uuid primary key, email text);
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $$;
grant usage on schema storage to authenticated, service_role;
grant all on storage.objects, storage.buckets to authenticated, service_role;
grant execute on all functions in schema storage to authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- Who people are: stand-ins for user_roles and the client membership.
create table public.user_roles (user_id uuid, role text);
create table public.client_members (user_id uuid, client_id uuid);
create function public.is_moburst_staff() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('admin', 'moburst_user')) $$;
create function public.is_client_member(uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.client_members where user_id = auth.uid() and client_id = $1) $$;
create function public.can_access_client(uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_moburst_staff() or public.is_client_member($1) $$;
create function public.can_write_client(uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_moburst_staff() and public.can_access_client($1) $$;
create function public.lifecycle_enqueue(uuid) returns void language sql as $$ select $$;

create table public.clients (id uuid primary key, name text, timezone text, archived_at timestamptz, website_url text, brief_text text, brief_file_id uuid,
  strategy_doc_file_path text, competitor_seed_notes text, logo_url text, brand_identity jsonb, field_sources jsonb, posting_rhythm jsonb, brand_notes text);
create table public.profiles (id uuid primary key default gen_random_uuid(), user_id uuid, display_name text, email text);
create table public.reports (id uuid primary key default gen_random_uuid(), client_id uuid not null, status text);
create table public.competitive_reports (id uuid primary key default gen_random_uuid(), client_id uuid not null, status text);
create table public.post_iterations (id uuid primary key default gen_random_uuid(), client_id uuid not null, report_id uuid, version int not null default 1,
  platform text, post_copy text, hashtags text[], cta text, concept text, visual_direction text, format text,
  source text default 'calendar' check (source in ('calendar', 'ad_hoc', 'regeneration')), created_at timestamptz default now(), created_by uuid, calendar_post_key text);
create table public.design_requests (client_id uuid, calendar_post_key text, status text);
create table public.scheduled_posts (client_id uuid, calendar_post_key text, platform text, post_content text);
create table public.scheduled_jobs (id uuid primary key default gen_random_uuid(), kind text not null, client_id uuid, payload jsonb, dedupe_key text unique,
  priority smallint, available_at timestamptz, status text not null default 'queued', constraint scheduled_jobs_kind_check check (kind = any (array['lifecycle_step'])));
create table public.api_requests (id bigserial primary key, key_id uuid, method text not null, path text not null, status integer not null,
  duration_ms integer, client_id uuid, job_id uuid, ip text, error_code text, created_at timestamptz not null default now());
do $$ declare t text; begin
  foreach t in array array['clients', 'reports', 'competitive_reports', 'post_iterations', 'api_requests'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
create policy "Read clients" on public.clients for select to authenticated using (public.can_access_client(id));
create policy "Read reports" on public.reports for select to authenticated using (public.can_access_client(client_id));
create policy "Read competitive reports" on public.competitive_reports for select to authenticated using (public.can_access_client(client_id));
create policy "Staff write post iterations" on public.post_iterations for all to authenticated using (public.can_write_client(client_id)) with check (public.can_write_client(client_id));
grant usage on all sequences in schema public to authenticated, service_role;

insert into auth.users values ('${STAFF}', 'sinead@moburst.com'), ('${BADER_USER}', 'jo@baderlaw.com'), ('${CALM_USER}', 'sam@calm.com');
insert into public.profiles (user_id, display_name, email) values ('${STAFF}', 'Sinéad Cronin', 'sinead@moburst.com');
insert into public.user_roles values ('${STAFF}', 'moburst_user');
insert into public.client_members values ('${BADER_USER}', '${BADER}'), ('${CALM_USER}', '${CALM}');
insert into public.clients (id, name, timezone) values ('${BADER}', 'Bader Law', 'America/New_York'), ('${CALM}', 'Calm', 'UTC');
`;

let db: PGlite;
const as = async (role: "authenticated" | "service_role" | null, claims: object | null) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [claims ? JSON.stringify(claims) : ""]);
  if (role) await db.exec(`set role ${role}`);
};
const rows = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, params)).rows;
const one = async (sql: string, params: unknown[] = []) => (await rows(sql, params))[0];

let report: string;
let competitive: string;
let calmReport: string;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  // The earlier migrations' function bodies name tables this schema leaves out; their own tests check them.
  await db.exec("set check_function_bodies = off");
  for (const f of ["20261108120000_content_strategy.sql", "20261109100000_client_notes.sql", "20261109120000_claude_connector.sql"]) await db.exec(read(f));
  await db.exec("set check_function_bodies = on");
  // A note typed before the migration, to be hashed by it.
  await db.query(`insert into public.client_notes (client_id, kind, title, text) values ($1, 'typed', 'Old note', $2)`, [BADER, "  Never say\t\"cheap\".\n\nSay  \"affordable\".  "]);
  await db.exec(SYNC);
  await db.exec(SYNC);
  report = (await one(`insert into public.reports (client_id, status) values ($1, 'completed') returning id`, [BADER])).id as string;
  competitive = (await one(`insert into public.competitive_reports (client_id, status) values ($1, 'complete') returning id`, [BADER])).id as string;
  calmReport = (await one(`insert into public.reports (client_id, status) values ($1, 'completed') returning id`, [CALM])).id as string;
}, 60_000);
afterAll(async () => { await db?.close(); });

describe("20261110150000_claude_sync.sql", () => {
  it("is additive: it drops no table or column and runs twice", () => {
    const sql = SYNC.replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/\bdrop\s+(table|column)\b|\btruncate\b/i);
    expect(sql).toMatch(/create table if not exists public\.report_decks/);
  });

  it("applies after the migrations main added on 10 Nov, none of which touches what it changes", () => {
    const later = readdirSync(migrations).filter((f) => f > "20261109120000_claude_connector.sql" && f < "20261110150000_claude_sync.sql");
    expect(later).toEqual(expect.arrayContaining(["20261110110000_post_notes_stories.sql", "20261110120000_onboarding_complete.sql"]));
    expect(readdirSync(migrations).sort().filter((f) => f >= "20261110150000").at(0)).toBe("20261110150000_claude_sync.sql");
    const OURS = /\b(client_notes|post_iterations|content_strateg\w*|strategy_section_save\w*|report_decks|report-decks|api_requests)\b/i;
    for (const f of later) expect(read(f).replace(/--[^\n]*/g, "").match(OURS)?.[0] ?? null, f).toBeNull();
  });

  it("guards the new table like every other: three OAuth policies on report_decks", async () => {
    await as(null, null);
    for (const t of ["report_decks", "client_notes", "post_iterations", "content_strategy_edits"]) {
      const n = (await one(`select count(*)::int as n from pg_policies where tablename = $1 and permissive = 'RESTRICTIVE' and policyname like 'OAuth sessions cannot %'`, [t])).n;
      expect(n, t).toBe(3);
    }
  });

  it("keeps an OAuth session from writing any table or bucket Claude's saves land in, staff included", async () => {
    await as("authenticated", oauth(STAFF));
    await expect(db.query(`insert into public.client_notes (client_id, kind, title, text, source) values ($1, 'typed', 't', 'x', 'claude')`, [BADER])).rejects.toThrow();
    await expect(db.query(`insert into public.post_iterations (client_id, post_copy, source, calendar_post_key) values ($1, 'x', 'claude', 'k')`, [BADER])).rejects.toThrow(/row-level security/);
    await expect(db.query(`insert into public.content_strategy_edits (client_id, section_key, text) values ($1, 'goals', 'x')`, [BADER])).rejects.toThrow();
    await expect(db.query(`insert into public.report_decks (id, client_id, report_id, title, kind, link) values (gen_random_uuid(), $1, $2, 't', 'link', 'https://docs.google.com/x')`, [BADER, report])).rejects.toThrow();
    await expect(db.query(`insert into storage.objects (bucket_id, name) values ('report-decks', $1)`, [`${BADER}/${report}/d.pptx`])).rejects.toThrow(/row-level security/);
    await expect(db.query(`select public.strategy_section_save_as($1, $2, 'goals', 'Grow', 'claude')`, [STAFF, BADER])).rejects.toThrow(/permission denied/);
    await expect(db.query(`select public.strategy_section_save($1, 'goals', 'Grow')`, [BADER])).rejects.toThrow("Connected apps can read Socialytics but cannot change it.");
    await as(null, null);
    expect(await rows(`select 1 from public.post_iterations where source = 'claude'`)).toEqual([]);
    expect(await rows(`select 1 from public.content_strategy_edits`)).toEqual([]);
    expect(await rows(`select 1 from public.report_decks`)).toEqual([]);
  });

  it("lets an app session write post iterations as before, and keeps their old sources", async () => {
    await as("authenticated", app(STAFF));
    expect(await rows(`insert into public.post_iterations (client_id, post_copy, source, calendar_post_key) values ($1, 'x', 'calendar', 'k1') returning source`, [BADER])).toEqual([{ source: "calendar" }]);
    await as("service_role", SERVICE);
    for (const source of ["calendar", "ad_hoc", "regeneration", "claude"]) {
      expect(await rows(`insert into public.post_iterations (client_id, post_copy, source, calendar_post_key) values ($1, 'x', $2, 'k2') returning source`, [BADER, source])).toEqual([{ source }]);
    }
    await expect(db.query(`insert into public.post_iterations (client_id, post_copy, source) values ($1, 'x', 'chatgpt')`, [BADER])).rejects.toThrow(/post_iterations_source_check/);
    await as(null, null);
    await db.exec(`delete from public.post_iterations`);
  });

  it("saves a strategy section for a named person from the service role only, from Claude, and never hands one back from there", async () => {
    await as(null, null);
    await db.query(`insert into public.content_strategies (client_id, sections, written_at) values ($1, '{"goals": "Grow the firm", "audience": "Injured drivers"}', now())`, [BADER]);
    for (const [role, claims] of [["authenticated", app(STAFF)], ["authenticated", app(BADER_USER)]] as const) {
      await as(role, claims);
      await expect(db.query(`select public.strategy_section_save_as($1, $2, 'goals', 'Grow', 'claude')`, [STAFF, BADER]), JSON.stringify(claims)).rejects.toThrow(/permission denied/);
    }
    await as("service_role", SERVICE);
    const saved = (await one(`select public.strategy_section_save_as($1, $2, 'goals', '  Grow leads in Queens  ', 'claude') as r`, [STAFF, BADER])).r as Record<string, unknown>;
    expect(saved).toMatchObject({ section_key: "goals", text: "Grow leads in Queens", editor_name: "Sinéad Cronin", source: "claude" });
    expect(await rows(`select edited_by, source from public.content_strategy_edits where client_id = $1 and section_key = 'goals'`, [BADER])).toEqual([{ edited_by: STAFF, source: "claude" }]);
    for (const text of ["", "   ", "Grow the firm"]) {
      await expect(db.query(`select public.strategy_section_save_as($1, $2, 'goals', $3, 'claude')`, [STAFF, BADER, text]), JSON.stringify(text)).rejects.toThrow("A section saved from Claude is never handed back.");
    }
    await expect(db.query(`select public.strategy_section_save_as($1, $2, 'goals', 'x', 'chatgpt')`, [STAFF, BADER])).rejects.toThrow(/Unknown source/);
    await expect(db.query(`select public.strategy_section_save_as($1, $2, 'notes', 'x', 'claude')`, [STAFF, BADER])).rejects.toThrow("Unknown strategy section.");
    await expect(db.query(`select public.strategy_section_save_as(null, $1, 'goals', 'x', 'claude')`, [BADER])).rejects.toThrow(/person/);
    expect((await rows(`select 1 from public.content_strategy_edits where client_id = $1`, [BADER])).length).toBe(1);
  });

  it("saves from Claude only against the version read, and otherwise refuses with the section as it is now, writing nothing", async () => {
    await as(null, null);
    await db.query(`insert into public.content_strategies (client_id, sections, written_at) values ($1, '{"positioning": "Local and fast"}', now()) on conflict (client_id) do update set sections = public.content_strategies.sections || excluded.sections`, [CALM]);
    await as("service_role", SERVICE);
    const save = async (text: string, expected: string | null) => (await one(`select public.strategy_section_save_as($1, $2, 'positioning', $3, 'claude', $4) as r`, [STAFF, CALM, text, expected])).r as Record<string, unknown>;
    // The product's version, as read: saved.
    expect(await save("Local, fast and fair", await sectionVersion("Local and fast"))).toMatchObject({ section_key: "positioning", text: "Local, fast and fair", source: "claude" });
    // A second save still naming the product's version: the section changed since, so nothing is written.
    expect(await save("Cheapest in town", await sectionVersion("Local and fast"))).toEqual({
      conflict: true, section_key: "positioning", text: "Local, fast and fair", version: await sectionVersion("Local, fast and fair"),
    });
    expect((await one(`select text from public.content_strategy_edits where client_id = $1 and section_key = 'positioning'`, [CALM])).text).toBe("Local, fast and fair");
    // Against the version now shown: saved.
    expect(await save("Local and fair", await sectionVersion("Local, fast and fair"))).toMatchObject({ text: "Local and fair" });
    // A section with no text yet has the version of empty text.
    expect((await one(`select public.strategy_section_save_as($1, $2, 'measures', 'Calls booked', 'claude', $3) as r`, [STAFF, CALM, await sectionVersion("")])).r).toMatchObject({ section_key: "measures", text: "Calls booked" });
  });

  it("checks the version under locks taken before the section is read, in the same call that writes it", () => {
    const body = SYNC.slice(SYNC.indexOf("create or replace function public.strategy_section_save_as"), SYNC.indexOf("revoke all on function public.strategy_section_save_as"));
    const at = (re: RegExp) => body.search(re);
    expect(body).toMatch(/p_expected text default null/);
    expect(at(/pg_advisory_xact_lock/)).toBeGreaterThan(0);
    expect(at(/for update/)).toBeGreaterThan(0);
    const firstRead = at(/select[\s\S]*?into v_product/);
    expect(at(/pg_advisory_xact_lock/)).toBeLessThan(firstRead);
    expect(at(/for update/)).toBeLessThan(firstRead);
    expect(at(/'conflict', true/)).toBeLessThan(at(/insert into public\.content_strategy_edits/));
    expect(at(/'conflict', true/)).toBeLessThan(at(/delete from public\.content_strategy_edits/));
  });

  it("keeps the Strategy page's save as it was: staff with access, the signed-in editor, empty or product text hands back", async () => {
    await as("authenticated", app(STAFF));
    const saved = (await one(`select public.strategy_section_save($1, 'audience', 'Drivers hurt in crashes') as r`, [BADER])).r as Record<string, unknown>;
    expect(saved).toMatchObject({ section_key: "audience", text: "Drivers hurt in crashes", editor_name: "Sinéad Cronin", source: "app" });
    expect(Object.keys(saved).sort()).toEqual(["edited_at", "editor_name", "section_key", "source", "text"]);
    // A person's version from Claude becomes the app's when edited on the page.
    expect(((await one(`select public.strategy_section_save($1, 'goals', 'Grow leads in Brooklyn') as r`, [BADER])).r as { source: string }).source).toBe("app");
    expect((await one(`select public.strategy_section_save($1, 'audience', 'Injured drivers') as r`, [BADER])).r).toBeNull();
    expect((await one(`select public.strategy_section_save($1, 'goals', '') as r`, [BADER])).r).toBeNull();
    expect(await rows(`select section_key from public.content_strategy_edits where client_id = $1`, [BADER])).toEqual([]);
    await as("authenticated", app(BADER_USER));
    await expect(db.query(`select public.strategy_section_save($1, 'goals', 'x')`, [BADER])).rejects.toThrow("Only Moburst staff can change the content strategy.");
  });

  it("marks where each note came from and hashes typed text the way the connector does, before and after", async () => {
    await as(null, null);
    const old = await one(`select source, text, text_hash from public.client_notes where title = 'Old note'`);
    expect(old.source).toBe("app");
    expect(old.text_hash).toBe(await noteTextHash(old.text as string));
    expect(old.text_hash).toBe(await noteTextHash("Never say \"cheap\". Say \"affordable\"."));
    await as("service_role", SERVICE);
    const hash = await noteTextHash("Launch on Dec 1");
    await db.query(`insert into public.client_notes (client_id, kind, title, text, source, text_hash) values ($1, 'typed', 'a', 'Launch on Dec 1', 'claude', $2)`, [BADER, hash]);
    await expect(db.query(`insert into public.client_notes (client_id, kind, title, text, source, text_hash) values ($1, 'typed', 'b', 'Launch on Dec 1', 'claude', $2)`, [BADER, hash])).rejects.toThrow(/client_notes_claude_text/);
    // Another client, and the app's own notes, may hold the same words.
    await db.query(`insert into public.client_notes (client_id, kind, title, text, source, text_hash) values ($1, 'typed', 'c', 'Launch on Dec 1', 'claude', $2)`, [CALM, hash]);
    await db.query(`insert into public.client_notes (client_id, kind, title, text, source, text_hash) values ($1, 'typed', 'd', 'Launch on Dec 1', 'app', $2)`, [BADER, hash]);
    await expect(db.query(`insert into public.client_notes (client_id, kind, title, text, source) values ($1, 'typed', 'e', 'x', 'email')`, [BADER])).rejects.toThrow(/client_notes_source_check/);
    await as("authenticated", app(STAFF));
    expect((await rows(`select source from public.client_notes where client_id = $1 and text = 'Launch on Dec 1' order by source`, [BADER])).map((r) => r.source)).toEqual(["app", "claude"]);
    await as("authenticated", app(BADER_USER));
    expect(await rows(`select 1 from public.client_notes`)).toEqual([]);
  });

  it("records a deck once for a report it belongs to, and shows it to whoever can see that report", async () => {
    await as("service_role", SERVICE);
    const file = `${BADER}/${report}/11111111-1111-4111-8111-111111111111.pptx`;
    await db.query(`insert into public.report_decks (id, client_id, report_id, title, kind, file_path, added_by, added_by_name) values ('11111111-1111-4111-8111-111111111111', $1, $2, 'October deck', 'pptx', $3, $4, 'Sinéad Cronin')`, [BADER, report, file, STAFF]);
    await db.query(`insert into public.report_decks (id, client_id, competitive_report_id, title, kind, link) values (gen_random_uuid(), $1, $2, 'Q3 field', 'link', 'https://docs.google.com/presentation/d/1')`, [BADER, competitive]);
    await db.query(`insert into storage.objects (bucket_id, name) values ('report-decks', $1), ('report-decks', $2)`, [file, `${BADER}/${report}/not-recorded.pptx`]);
    for (const [what, sql, params] of [
      ["both reports", `insert into public.report_decks (client_id, report_id, competitive_report_id, title, kind, link) values ($1, $2, $3, 't', 'link', 'https://x.com')`, [BADER, report, competitive]],
      ["no report", `insert into public.report_decks (client_id, title, kind, link) values ($1, 't', 'link', 'https://x.com')`, [BADER]],
      ["a link that is not https", `insert into public.report_decks (client_id, report_id, title, kind, link) values ($1, $2, 't', 'link', 'http://x.com')`, [BADER, report]],
      ["a file deck with no file", `insert into public.report_decks (client_id, report_id, title, kind) values ($1, $2, 't', 'pptx')`, [BADER, report]],
      ["an empty title", `insert into public.report_decks (client_id, report_id, title, kind, link) values ($1, $2, '  ', 'link', 'https://x.com')`, [BADER, report]],
      ["an unknown source", `insert into public.report_decks (client_id, report_id, title, kind, link, source) values ($1, $2, 't', 'link', 'https://x.com', 'email')`, [BADER, report]],
    ] as const) await expect(db.query(sql, [...params]), what).rejects.toThrow();

    await as("authenticated", app(BADER_USER));
    expect((await rows(`select title from public.report_decks order by title`)).map((r) => r.title)).toEqual(["October deck", "Q3 field"]);
    expect((await rows(`select name from storage.objects where bucket_id = 'report-decks'`)).map((r) => r.name)).toEqual([file]);
    await expect(db.query(`insert into public.report_decks (client_id, report_id, title, kind, link) values ($1, $2, 't', 'link', 'https://x.com')`, [BADER, report])).rejects.toThrow(/permission denied/);
    await expect(db.query(`insert into storage.objects (bucket_id, name) values ('report-decks', $1)`, [`${BADER}/${report}/x.pptx`])).rejects.toThrow(/row-level security/);
    await as("authenticated", app(CALM_USER));
    expect(await rows(`select title from public.report_decks`)).toEqual([]);
    expect(await rows(`select name from storage.objects where bucket_id = 'report-decks'`)).toEqual([]);
    await as("authenticated", app(STAFF));
    expect((await rows(`select title from public.report_decks`)).length).toBe(2);
    await as(null, null);
    expect(calmReport).toBeTruthy();
  });

  it("keeps deck files in a private bucket of decks and PDFs up to 50 MB", async () => {
    await as(null, null);
    expect(await one(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'report-decks'`)).toEqual({
      public: false, file_size_limit: 52428800, allowed_mime_types: ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/pdf"],
    });
  });

  it("gives the audit row a target, and the service role alone writes it", async () => {
    await as("service_role", SERVICE);
    expect(await rows(`insert into public.api_requests (method, path, status, client_id, user_id, oauth_client_id, target) values ('MCP', 'mcp/socialytics_note_save', 200, $1, $2, $3, 'n1') returning target`, [BADER, STAFF, OAUTH_CLIENT])).toEqual([{ target: "n1" }]);
    await as("authenticated", oauth(STAFF));
    await expect(db.query(`insert into public.api_requests (method, path, status, target) values ('MCP', 'x', 200, 't')`)).rejects.toThrow(/row-level security/);
  });
});
