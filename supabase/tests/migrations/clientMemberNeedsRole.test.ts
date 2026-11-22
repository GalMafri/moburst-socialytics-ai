// @vitest-environment node
// 20261122140200_client_member_needs_role.sql, applied twice to PGlite over
// the tables is_client_member reads. QA 22 Nov 2026 (P24-01): a client user
// the Hub deactivated (role removed) kept membership through the profile's
// company name or slug allowlist alone.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migration = readFileSync(join(functionsDir, "..", "migrations", "20261122140200_client_member_needs_role.sql"), "utf8");

const HUB_USER = "00000000-0000-4000-8000-0000000000b1";
const GOS_USER = "00000000-0000-4000-8000-0000000000b2";
const LINKED_USER = "00000000-0000-4000-8000-0000000000b3";
const ACME = "00000000-0000-4000-8000-0000000000c1";
const OTHER = "00000000-0000-4000-8000-0000000000c2";

const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create type public.app_role as enum ('admin', 'moburst_user', 'client');
create table public.user_roles (user_id uuid, role public.app_role);
create table public.profiles (user_id uuid primary key, hub_company_name text, allowed_company_slugs text[]);
create table public.clients (id uuid primary key, hub_company_name text, company_slug text);
create table public.client_users (user_id uuid, client_id uuid);
create function public.is_company_restricted() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid()
    and hub_company_name is null and allowed_company_slugs is not null and cardinality(allowed_company_slugs) > 0) $$;
insert into public.clients values ('${ACME}', 'Acme', 'acme'), ('${OTHER}', 'Other', 'other');
insert into public.user_roles values ('${HUB_USER}', 'client'), ('${GOS_USER}', 'client'), ('${LINKED_USER}', 'client');
insert into public.profiles values ('${HUB_USER}', ' acme ', null), ('${GOS_USER}', null, '{acme}'), ('${LINKED_USER}', null, null);
insert into public.client_users values ('${LINKED_USER}', '${ACME}');
`;

let db: PGlite;

async function member(userId: string, clientId: string): Promise<boolean> {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: userId })]);
  const { rows } = await db.query<{ m: boolean }>(`select public.is_client_member($1::uuid) as m`, [clientId]);
  return rows[0].m;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(migration);
  await db.exec(migration);
});
afterAll(async () => db.close());

describe("is_client_member", () => {
  it("still admits a client user with a role through each branch, and only for their own company", async () => {
    expect(await member(HUB_USER, ACME)).toBe(true);
    expect(await member(GOS_USER, ACME)).toBe(true);
    expect(await member(LINKED_USER, ACME)).toBe(true);
    expect(await member(HUB_USER, OTHER)).toBe(false);
    expect(await member(GOS_USER, OTHER)).toBe(false);
  });

  it("refuses a person whose role was removed, though their profile still names the company", async () => {
    await db.exec(`delete from public.user_roles`);
    expect(await member(HUB_USER, ACME)).toBe(false);
    expect(await member(GOS_USER, ACME)).toBe(false);
    expect(await member(LINKED_USER, ACME)).toBe(false);
  });
});
