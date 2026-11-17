// @vitest-environment node
// 20261116120100_design_logo_set_person_rows.sql, applied twice to PGlite:
// a signed-in person's save of a logo (their first save of the settings, or
// a change of the main logo) queues the lifecycle's look that makes the
// client's logo set. A person cannot call lifecycle_enqueue themselves, so
// the trigger's function runs as its owner.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migrations = join(functionsDir, "..", "migrations");
const migration = readFileSync(join(migrations, "20261116120100_design_logo_set_person_rows.sql"), "utf8");
const lookTime = readFileSync(join(migrations, "20261110210000_lifecycle_look_time.sql"), "utf8");

const C1 = "00000000-0000-4000-8000-000000000001";
const SETUP = `
create role anon; create role authenticated; create role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
create table public.clients (id uuid primary key, archived_at timestamptz);
create table public.scheduled_jobs (id uuid primary key default gen_random_uuid(), kind text, client_id uuid, dedupe_key text, priority smallint, available_at timestamptz, status text not null default 'queued');
create table public.design_brand_settings (
  client_id uuid primary key references public.clients(id),
  logo_path text not null, placement jsonb not null, background text not null, reference_paths text[] not null,
  updated_at timestamptz not null default now(), source text not null default 'person', logo_set jsonb
);
grant select, insert, update on public.design_brand_settings to authenticated;
grant all on public.design_brand_settings to service_role;
insert into public.clients (id) values ('${C1}');
`;

/* eslint-disable @typescript-eslint/no-explicit-any -- Rows of an ad hoc query. */
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(lookTime);
  await db.exec(migration);
  await db.exec(migration);
});
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.exec("delete from public.design_brand_settings; delete from public.scheduled_jobs;"); });

async function as(role: "authenticated" | "service_role", sql: string, params: unknown[] = []): Promise<void> {
  await db.query("select set_config('request.jwt.claim.role', $1, false)", [role]);
  await db.exec(`set role ${role}`);
  try {
    await db.query(sql, params);
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.role', '', false)");
  }
}
const looks = async () => (await db.query<any>("select count(*)::int as n from public.scheduled_jobs where kind = 'lifecycle' and client_id = $1 and status = 'queued'", [C1])).rows[0].n;
const INSERT = `insert into public.design_brand_settings (client_id, logo_path, placement, background, reference_paths) values ($1, $2, '{"anchor":"center","width":0.3,"top":0.05}', '#0C1D2F', '{a.jpg}')`;

describe("a look when a person saves a logo", () => {
  it("queues a look when a person saves a logo for the first time", async () => {
    await as("authenticated", INSERT, [C1, "c1/logo.png"]);
    expect(await looks()).toBe(1);
  });

  it("queues a look when a person changes the main logo, and none when they change only the background", async () => {
    await as("authenticated", INSERT, [C1, "c1/logo.png"]);
    await db.exec("delete from public.scheduled_jobs");
    await as("authenticated", "update public.design_brand_settings set background = '#101010', updated_at = now() where client_id = $1", [C1]);
    expect(await looks()).toBe(0);
    // The card's save names every field: the same logo again is no change.
    await as("authenticated", "update public.design_brand_settings set logo_path = 'c1/logo.png', background = '#111111' where client_id = $1", [C1]);
    expect(await looks()).toBe(0);
    await as("authenticated", "update public.design_brand_settings set logo_path = 'c1/newer-logo.png' where client_id = $1", [C1]);
    expect(await looks()).toBe(1);
  });

  it("queues nothing for a write that is not a signed-in person's", async () => {
    // The lifecycle's own writes are made from a run of the step, which looks again on its own.
    await as("service_role", INSERT, [C1, "c1/logo.png"]);
    await as("service_role", "update public.design_brand_settings set logo_path = 'c1/trimmed.png' where client_id = $1", [C1]);
    expect(await looks()).toBe(0);
  });

  it("lets nobody call the trigger's function", async () => {
    await expect(as("authenticated", "select public.design_settings_look_on_logo()")).rejects.toThrow();
  });
});
