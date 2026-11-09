// @vitest-environment node
// 20261111110000_moburst_users_see_all_clients.sql, applied twice to PGlite
// over the role helpers as they are live (9 Nov 2026). Lital, 9 Nov: "all
// moburst users [need] access to see all clients as a moburst user". A Moburst
// user whose Hub account lists companies reaches every client; a client still
// reaches only their own companies.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migration = readFileSync(join(functionsDir, "..", "migrations", "20261111110000_moburst_users_see_all_clients.sql"), "utf8");

const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const STAFF_WITH_COMPANIES = "00000000-0000-4000-8000-0000000000a2";
const STAFF_PLAIN = "00000000-0000-4000-8000-0000000000a3";
const CLIENT_USER = "00000000-0000-4000-8000-0000000000a4";
const NOBODY = "00000000-0000-4000-8000-0000000000a5";
const BADER = "00000000-0000-4000-8000-0000000000c1";
const OTHER = "00000000-0000-4000-8000-0000000000c2";

// The helpers as they are live (pg_get_functiondef, 9 Nov 2026), with is_client_member reduced to its Hub slug branch.
const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create type public.app_role as enum ('admin', 'moburst_user', 'client');
create table public.user_roles (user_id uuid, role public.app_role);
create table public.profiles (user_id uuid primary key, hub_company_name text, allowed_company_slugs text[]);
create table public.clients (id uuid primary key, company_slug text);
create function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') $$;
create function public.is_moburst_staff() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('admin'::public.app_role, 'moburst_user'::public.app_role)) $$;
create function public.is_company_restricted() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid()
    and hub_company_name is null and allowed_company_slugs is not null and cardinality(allowed_company_slugs) > 0) $$;
create function public.is_client_member(_client_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.clients c join public.profiles p on p.user_id = auth.uid()
    where c.id = _client_id and c.company_slug = any(coalesce(p.allowed_company_slugs, '{}'))) $$;
create function public.can_access_client(_client_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.is_moburst_staff() and not public.is_company_restricted()) or public.is_client_member(_client_id) $$;
create function public.can_write_client(_client_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_moburst_staff() and public.can_access_client(_client_id) $$;
create function public.can_manage_roster() returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.is_moburst_staff() and not public.is_company_restricted()) $$;
insert into public.clients values ('${BADER}', 'bader-law'), ('${OTHER}', 'other-co');
insert into public.user_roles values ('${ADMIN}', 'admin'), ('${STAFF_WITH_COMPANIES}', 'moburst_user'), ('${STAFF_PLAIN}', 'moburst_user'), ('${CLIENT_USER}', 'client');
insert into public.profiles values ('${ADMIN}', null, '{}'), ('${STAFF_WITH_COMPANIES}', null, '{bader-law,moburst}'), ('${STAFF_PLAIN}', null, '{}'),
  ('${CLIENT_USER}', null, '{bader-law}'), ('${NOBODY}', null, '{}');
`;

let db: PGlite;
async function as(user: string, sql: string): Promise<unknown> {
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: user, role: "authenticated" })]);
  const { rows } = await db.query<{ v: unknown }>(`select (${sql}) as v`);
  return rows[0].v;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(migration);
  await db.exec(migration);
}, 30_000);
afterAll(async () => { await db.close(); });

describe("Moburst users see every client", () => {
  it("lets a Moburst user whose Hub account lists companies reach, write and manage every client", async () => {
    expect(await as(STAFF_WITH_COMPANIES, `public.can_access_client('${OTHER}')`)).toBe(true);
    expect(await as(STAFF_WITH_COMPANIES, `public.can_access_client('${BADER}')`)).toBe(true);
    expect(await as(STAFF_WITH_COMPANIES, `public.can_write_client('${OTHER}')`)).toBe(true);
    expect(await as(STAFF_WITH_COMPANIES, `public.can_manage_roster()`)).toBe(true);
  });

  it("leaves admins and Moburst users without companies as they were", async () => {
    for (const user of [ADMIN, STAFF_PLAIN]) {
      expect(await as(user, `public.can_access_client('${OTHER}')`)).toBe(true);
      expect(await as(user, `public.can_manage_roster()`)).toBe(true);
    }
  });

  it("still limits a client to their own companies, read only", async () => {
    expect(await as(CLIENT_USER, `public.can_access_client('${BADER}')`)).toBe(true);
    expect(await as(CLIENT_USER, `public.can_access_client('${OTHER}')`)).toBe(false);
    expect(await as(CLIENT_USER, `public.can_write_client('${BADER}')`)).toBe(false);
    expect(await as(CLIENT_USER, `public.can_manage_roster()`)).toBe(false);
  });

  it("gives someone with no role nothing", async () => {
    expect(await as(NOBODY, `public.can_access_client('${OTHER}')`)).toBe(false);
    expect(await as(NOBODY, `public.can_manage_roster()`)).toBe(false);
  });
});
