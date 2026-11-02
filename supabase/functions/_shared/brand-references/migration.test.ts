// @vitest-environment node
// 20261109150000_design_refs_refresh.sql, applied twice to PGlite over the
// smallest schema it touches. What a dry run would not show: who can save a
// choice, that a person's settings row gets the refreshed library and keeps
// its logo, placement and background, and the one-time conversion of
// existing saves (coordinator's decision, 2 Nov 2026: only posts a person
// explicitly kept or left out, and uploads, stay permanent), with its record
// and the reversal the migration documents.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");
const migration = readFileSync(join(migrations, "20261109150000_design_refs_refresh.sql"), "utf8");
/** The reversal the migration documents, as the comment block after "Reversal:" gives it. */
const reversal = (() => {
  const lines = migration.split("\n");
  const start = lines.findIndex((l) => /^-- Reversal:/.test(l));
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("--   ")) break;
    out.push(line.slice(5));
  }
  return out.join("\n");
})();

const PYPER = "00000000-0000-4000-8000-000000000001"; // a person saved after the posts were read
const BADER = "00000000-0000-4000-8000-000000000002"; // a person saved before the current posts were read
const MOBURST = "00000000-0000-4000-8000-000000000003"; // settings the lifecycle derived
const PERSON = "00000000-0000-4000-8000-0000000000aa";
const APP = { sub: PERSON, role: "authenticated", aud: "authenticated", session_id: "s1" };
const CONNECTOR = { ...APP, client_id: "9b1f0c4e-3f8a-4c55-9d7e-2a6b1c0d4e5f" };
const SERVICE = { role: "service_role" };

const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create schema storage;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, created_at timestamptz not null default now());
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create function public.is_moburst_staff() returns boolean language sql stable as $$ select true $$;
create function public.can_access_client(uuid) returns boolean language sql stable as $$ select true $$;
create function public.can_write_client(uuid) returns boolean language sql stable as $$ select auth.uid() is not null or auth.role() = 'service_role' $$;
create function public.is_oauth_session() returns boolean language sql stable as $$ select coalesce(auth.jwt() ->> 'client_id', '') <> '' $$;
create table public.clients (id uuid primary key, name text, archived_at timestamptz, design_references jsonb, harvested_design_references jsonb not null default '[]'::jsonb,
  design_refs_harvested_at timestamptz);
create table public.scheduled_jobs (id uuid primary key default gen_random_uuid(), kind text, client_id uuid, dedupe_key text unique, priority smallint, available_at timestamptz);
create function public.lifecycle_enqueue(p_client uuid, p_priority smallint default 30) returns void language sql security definer set search_path = public as $$
  insert into scheduled_jobs (kind, client_id, dedupe_key, priority, available_at) values ('lifecycle', p_client, 'lifecycle:' || p_client || ':' || gen_random_uuid(), p_priority, now())
$$;
create table public.design_brand_settings (client_id uuid primary key references public.clients(id), logo_path text not null, placement jsonb not null, background text not null,
  reference_paths text[] not null, confirmed_at timestamptz, confirmed_by uuid, updated_at timestamptz not null default now(), source text not null default 'person', derived jsonb,
  constraint design_brand_settings_refs check (cardinality(reference_paths) >= 1 and cardinality(reference_paths) <= 16));
create function public.design_settings_mark_person() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' then new.source := 'person'; end if;
  return new;
end $$;
create trigger design_brand_settings_source before insert or update on public.design_brand_settings for each row execute function public.design_settings_mark_person();
create table public.brand_voice_learnings (id uuid primary key default gen_random_uuid(), client_id uuid not null, pattern_type text not null, pattern_description text not null);
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;

insert into public.clients values
  ('${PYPER}', 'Pay The Pyper', null, '["c1/uploads/flyer.png", "c1/uploads/old-promo.png", "c1/uploads/after-save.png"]',
   '[{"path": "c1/social-a.jpg", "quality_checked": true}, {"path": "c1/social-b.jpg", "quality_checked": true}, {"path": "c1/social-c.jpg", "quality_checked": true}]',
   '2026-10-10T08:00:00Z'),
  ('${BADER}', 'Bader Law', null, '["c2/uploads/brochure.png", "c2/uploads/badge.png"]',
   '[{"path": "c2/social-new.jpg", "quality_checked": true}, {"path": "c2/social-newer.jpg", "quality_checked": true}]',
   '2026-10-28T08:00:00Z'),
  ('${MOBURST}', 'Moburst', null, null, '[{"path": "c3/social-x.jpg", "quality_checked": true}]', '2026-10-01T08:00:00Z');
insert into storage.objects (bucket_id, name, created_at) values
  ('design-references', 'c1/uploads/flyer.png', '2026-09-01T00:00:00Z'),
  ('design-references', 'c1/uploads/old-promo.png', '2026-09-01T00:00:00Z'),
  ('design-references', 'c1/uploads/after-save.png', '2026-10-30T00:00:00Z'),
  ('design-references', 'c2/uploads/brochure.png', '2026-08-01T00:00:00Z'),
  ('design-references', 'c2/uploads/badge.png', '2026-08-01T00:00:00Z');
insert into public.design_brand_settings (client_id, logo_path, placement, background, reference_paths, confirmed_at, updated_at, source) values
  -- Saved by a person on Oct 12 with one upload and two of the three posts.
  ('${PYPER}', 'c1/logo.png', '{"anchor": "left", "width": 0.2, "top": 0.05, "left": 0.05}', '#000000', '{c1/uploads/flyer.png, c1/social-a.jpg, c1/social-b.jpg}', '2026-10-12T09:00:00Z', '2026-10-12T09:00:00Z', 'person'),
  -- Saved by a person on Oct 15; its posts were read again on Oct 28, so the person never saw them.
  ('${BADER}', 'c2/logo.png', '{"anchor": "center", "width": 0.3, "top": 0.05}', '#0C1D2F', '{c2/uploads/brochure.png, c2/social-old.jpg}', '2026-10-15T09:00:00Z', '2026-10-15T09:00:00Z', 'person'),
  ('${MOBURST}', 'c3/logo.png', '{"anchor": "center", "width": 0.25, "top": 0.04}', '#0B0E1A', '{c3/social-x.jpg}', '2026-10-19T12:00:00Z', '2026-10-19T12:00:00Z', 'lifecycle');
insert into public.brand_voice_learnings (client_id, pattern_type, pattern_description) values ('${BADER}', 'tone', 'Plain and direct.');
`;

let db: PGlite;
const as = async (role: "authenticated" | "service_role" | "anon" | null, claims: object | null) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [claims ? JSON.stringify(claims) : ""]);
  if (role) await db.exec(`set role ${role}`);
};
const rows = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, params)).rows;
const choices = async (client: string) => {
  await as(null, null);
  return rows(`select path, choice, source from public.design_reference_choices where client_id = $1 order by path`, [client]);
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(migration);
  await db.exec(migration);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe("20261109150000_design_refs_refresh.sql", () => {
  it("adds its tables with row level security, a staff read policy and the three OAuth guards each", async () => {
    await as(null, null);
    for (const table of ["design_reference_reviews", "design_reference_choices", "design_refs_conversion"]) {
      const [t] = await rows(`select c.relrowsecurity as rls from pg_class c where c.relname = $1`, [table]);
      expect(t?.rls, table).toBe(true);
      const guards = await rows(`select count(*)::int as n from pg_policies where tablename = $1 and permissive = 'RESTRICTIVE' and policyname like 'OAuth sessions cannot %'`, [table]);
      expect(guards[0].n, table).toBe(3);
    }
    expect(migration).not.toMatch(/\bdrop table\b|\bdrop column\b|\btruncate\b/i);
  });

  it("converts each saved row once: what the person left out stays out, uploads in it are kept, and posts in it are not pinned", async () => {
    // The person saw the three posts (read Oct 10, saved Oct 12) and both early uploads; the third upload came after the save.
    expect(await choices(PYPER)).toEqual([
      { path: "c1/social-c.jpg", choice: "left_out", source: "conversion" },
      { path: "c1/uploads/flyer.png", choice: "kept", source: "conversion" },
      { path: "c1/uploads/old-promo.png", choice: "left_out", source: "conversion" },
    ]);
    // Its posts were read again after the save: nothing about them was a person's choice.
    expect(await choices(BADER)).toEqual([
      { path: "c2/uploads/badge.png", choice: "left_out", source: "conversion" },
      { path: "c2/uploads/brochure.png", choice: "kept", source: "conversion" },
    ]);
    // Settings the lifecycle derived were never a person's choice.
    expect(await choices(MOBURST)).toEqual([]);
  });

  it("records what each row held and what the conversion wrote", async () => {
    await as(null, null);
    const [pyper] = await rows(`select reference_paths, posts_seen, left_out, kept, settings_updated_at from public.design_refs_conversion where client_id = $1`, [PYPER]);
    expect(pyper).toMatchObject({
      reference_paths: ["c1/uploads/flyer.png", "c1/social-a.jpg", "c1/social-b.jpg"], posts_seen: true,
      left_out: ["c1/uploads/old-promo.png", "c1/social-c.jpg"], kept: ["c1/uploads/flyer.png"],
    });
    expect((await rows(`select client_id from public.design_refs_conversion order by client_id`)).map((r) => r.client_id)).toEqual([PYPER, BADER]);
  });

  it("never converts twice, even after a person changed a choice and the library moved on", async () => {
    await as("authenticated", APP);
    await db.query(`select public.design_reference_choose($1, 'c1/social-c.jpg', 'none')`, [PYPER]);
    await as("service_role", SERVICE);
    await db.query(`select public.lifecycle_write_design_library($1, array['c1/social-d.jpg', 'c1/social-a.jpg'])`, [PYPER]);
    await as(null, null);
    await db.exec(migration);
    expect(await choices(PYPER)).toEqual([
      { path: "c1/uploads/flyer.png", choice: "kept", source: "conversion" },
      { path: "c1/uploads/old-promo.png", choice: "left_out", source: "conversion" },
    ]);
    expect((await rows(`select reference_paths from public.design_refs_conversion where client_id = $1`, [PYPER]))[0].reference_paths)
      .toEqual(["c1/uploads/flyer.png", "c1/social-a.jpg", "c1/social-b.jpg"]);
  });

  it("writes the library on every settings row, a person's included, and nothing else on it", async () => {
    await as("service_role", SERVICE);
    const paths = Array.from({ length: 20 }, (_, i) => `c2/social-${i % 18}.jpg`);
    expect((await rows(`select public.lifecycle_write_design_library($1, $2) as w`, [BADER, paths]))[0].w).toBe(true);
    expect((await rows(`select public.lifecycle_write_design_library($1, $2) as w`, [MOBURST, ["c3/social-y.jpg"]]))[0].w).toBe(true);
    // The same library again, or none, writes nothing.
    expect((await rows(`select public.lifecycle_write_design_library($1, $2) as w`, [MOBURST, ["c3/social-y.jpg"]]))[0].w).toBe(false);
    expect((await rows(`select public.lifecycle_write_design_library($1, $2) as w`, [MOBURST, []]))[0].w).toBe(false);
    await as(null, null);
    const [bader] = await rows(`select reference_paths, logo_path, placement, background, source, updated_at from public.design_brand_settings where client_id = $1`, [BADER]);
    expect(bader.reference_paths).toEqual(Array.from({ length: 16 }, (_, i) => `c2/social-${i}.jpg`));
    expect(bader).toMatchObject({ logo_path: "c2/logo.png", placement: { anchor: "center", width: 0.3, top: 0.05 }, background: "#0C1D2F", source: "person" });
    expect(new Date(bader.updated_at as string).toISOString()).toBe("2026-10-15T09:00:00.000Z");
    expect((await rows(`select reference_paths, source from public.design_brand_settings where client_id = $1`, [MOBURST]))[0]).toEqual({ reference_paths: ["c3/social-y.jpg"], source: "lifecycle" });
  });

  it("lets only the service role write the library", async () => {
    for (const [role, claims] of [["authenticated", APP], ["anon", null]] as const) {
      await as(role, claims);
      await expect(db.query(`select public.lifecycle_write_design_library($1, array['x.jpg'])`, [PYPER]), role).rejects.toThrow(/permission denied/);
    }
  });

  it("saves a person's choice at once and looks at the client's lifecycle, and refuses a connected app first", async () => {
    await as(null, null);
    await db.exec(`delete from public.scheduled_jobs`);
    await as("authenticated", CONNECTOR);
    await expect(db.query(`select public.design_reference_choose($1, 'c1/social-a.jpg', 'kept')`, [PYPER])).rejects.toThrow("Connected apps can read Socialytics but cannot change it.");
    await as("authenticated", APP);
    expect((await rows(`select public.design_reference_choose($1, 'c1/social-a.jpg', 'kept') as r`, [PYPER]))[0].r).toEqual({ path: "c1/social-a.jpg", choice: "kept" });
    await db.query(`select public.design_reference_choose($1, 'c1/uploads/old-promo.png', 'none')`, [PYPER]);
    await db.query(`select public.design_reference_choose($1, 'c1/social-b.jpg', 'left_out')`, [PYPER]);
    await as(null, null);
    const saved = await rows(`select path, choice, chosen_by, source from public.design_reference_choices where client_id = $1 and source = 'person' order by path`, [PYPER]);
    expect(saved).toEqual([
      { path: "c1/social-a.jpg", choice: "kept", chosen_by: PERSON, source: "person" },
      { path: "c1/social-b.jpg", choice: "left_out", chosen_by: PERSON, source: "person" },
    ]);
    expect(await choices(PYPER)).not.toContainEqual(expect.objectContaining({ path: "c1/uploads/old-promo.png" }));
    expect((await rows(`select count(*)::int as n from public.scheduled_jobs where kind = 'lifecycle' and client_id = $1`, [PYPER]))[0].n).toBe(3);
  });

  it("accepts only the client's own references and the three choices", async () => {
    await as("authenticated", APP);
    await expect(db.query(`select public.design_reference_choose($1, 'c2/social-new.jpg', 'kept')`, [PYPER])).rejects.toThrow("That post is not one of this client's references.");
    await expect(db.query(`select public.design_reference_choose($1, 'c1/social-a.jpg', 'pinned')`, [PYPER])).rejects.toThrow("Unknown choice.");
    // A post the step reviewed as designed counts, even once it left the library.
    await as("service_role", SERVICE);
    await db.query(`insert into public.design_reference_reviews (client_id, source_post_id, network, verdict, path) values ($1, 'ig:9', 'INSTAGRAM', 'designed', 'c1/social-old.jpg')`, [PYPER]);
    await as("authenticated", APP);
    expect((await rows(`select public.design_reference_choose($1, 'c1/social-old.jpg', 'kept') as r`, [PYPER]))[0].r).toEqual({ path: "c1/social-old.jpg", choice: "kept" });
    // Taking a choice back needs no reference: a post that left every list can still be used again.
    await as("service_role", SERVICE);
    await db.query(`insert into public.design_reference_choices (client_id, path, choice) values ($1, 'c1/gone.jpg', 'left_out')`, [PYPER]);
    await as("authenticated", APP);
    await db.query(`select public.design_reference_choose($1, 'c1/gone.jpg', 'none')`, [PYPER]);
    await as(null, null);
    expect(await rows(`select path from public.design_reference_choices where path = 'c1/gone.jpg'`)).toEqual([]);
  });

  it("lets staff read reviews and choices, and nobody but the service role write them directly", async () => {
    await as("authenticated", APP);
    expect((await rows(`select path from public.design_reference_choices where client_id = $1`, [PYPER])).length).toBeGreaterThan(0);
    expect((await rows(`select source_post_id from public.design_reference_reviews`)).map((r) => r.source_post_id)).toEqual(["ig:9"]);
    await expect(db.query(`insert into public.design_reference_choices (client_id, path, choice) values ($1, 'x.jpg', 'kept')`, [PYPER])).rejects.toThrow(/permission denied/);
    await expect(db.query(`insert into public.design_reference_reviews (client_id, source_post_id, verdict) values ($1, 'x', 'designed')`, [PYPER])).rejects.toThrow(/permission denied/);
    await expect(db.query(`select * from public.design_refs_conversion`)).rejects.toThrow(/permission denied/);
  });

  it("gives a preference a platform, and leaves every existing one for all platforms", async () => {
    await as(null, null);
    expect(await rows(`select platform from public.brand_voice_learnings`)).toEqual([{ platform: null }]);
  });

  it("can be undone in data with the reversal it documents", async () => {
    expect(reversal).toContain("design_refs_conversion");
    await as(null, null);
    await db.exec(reversal);
    expect(await rows(`select count(*)::int as n from public.design_reference_choices where source = 'conversion'`)).toEqual([{ n: 0 }]);
    expect((await rows(`select reference_paths from public.design_brand_settings where client_id = $1`, [PYPER]))[0].reference_paths)
      .toEqual(["c1/uploads/flyer.png", "c1/social-a.jpg", "c1/social-b.jpg"]);
    expect((await rows(`select reference_paths from public.design_brand_settings where client_id = $1`, [BADER]))[0].reference_paths)
      .toEqual(["c2/uploads/brochure.png", "c2/social-old.jpg"]);
    // A person's own choices made since stay.
    expect((await rows(`select count(*)::int as n from public.design_reference_choices where source = 'person'`))[0].n).toBeGreaterThan(0);
  });
});
