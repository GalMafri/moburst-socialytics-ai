// @vitest-environment node
// 20261123160000_personal_keys_run_and_companies.sql, applied twice to PGlite
// after the API tables (20261001100000_public_api.sql) and the personal keys
// migration (20261111120000): a personal key is read only or read and write,
// and one that names companies reaches only those companies' clients within
// what its owner can see, worked out on every call. Tool keys answer as before.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migrations = join(functionsDir, "..", "migrations");
const sqlOf = (f: string) => readFileSync(join(migrations, f), "utf8");
const publicApi = sqlOf("20261001100000_public_api.sql");
const slice = (from: string, to: string) => publicApi.slice(publicApi.indexOf(from), publicApi.indexOf(to, publicApi.indexOf(from)));
const TABLES = slice("create table if not exists public.api_keys", "create table if not exists public.demo_jobs");
const TOUCH = slice("create or replace function public.api_key_touch", "create or replace function public.demo_jobs_lease");

const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const STAFF = "00000000-0000-4000-8000-0000000000a2";
const A = "00000000-0000-4000-8000-0000000000c1";
const B = "00000000-0000-4000-8000-0000000000c2";
const C = "00000000-0000-4000-8000-0000000000c3";
const DEMO = "00000000-0000-4000-8000-0000000000c0";
const NONE = "00000000-0000-0000-0000-000000000000";

const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create schema auth;
create table auth.users (id uuid primary key, email text);
create type public.app_role as enum ('admin', 'moburst_user', 'client');
create table public.user_roles (user_id uuid, role public.app_role);
create table public.clients (id uuid primary key, company_slug text, demo_job_id uuid);
${TABLES}
alter table public.api_requests add column if not exists user_id uuid;
alter table public.api_requests add column if not exists oauth_client_id text;
${TOUCH}
insert into auth.users (id) values ('${ADMIN}'), ('${STAFF}');
insert into public.user_roles values ('${ADMIN}', 'admin'), ('${STAFF}', 'moburst_user');
insert into public.clients values ('${C}', 'calm', null), ('${DEMO}', 'calm', gen_random_uuid()), ('${A}', 'bader-law', null), ('${B}', 'other-co', null);
`;

let db: PGlite;
async function touch(hash: string): Promise<Array<{ scopes: string[]; company_slugs: string[] | null; client_ids: string[] | null }>> {
  await db.exec("set role service_role");
  try { return (await db.query<{ scopes: string[]; company_slugs: string[] | null; client_ids: string[] | null }>("select * from public.api_key_touch($1)", [hash])).rows; } finally { await db.exec("reset role"); }
}
async function errorCodeOf(sql: string): Promise<string | null> {
  await db.exec("savepoint attempt");
  try { await db.exec(sql); await db.exec("release savepoint attempt"); return null; } catch (e) { await db.exec("rollback to savepoint attempt"); return (e as { code?: string }).code ?? String(e); }
}
const key = (hash: string, owner: string, scopes: string, slugs: string | null) =>
  `insert into public.api_keys (name, key_prefix, key_hash, scopes, rate_limit_per_minute, owner_user_id, created_by, company_slugs) values ('Mine', 'soc_x', '${hash}', '${scopes}', 120, '${owner}', '${owner}', ${slugs === null ? "null" : `'${slugs}'`})`;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(sqlOf("20261111120000_personal_api_keys.sql"));
  const m = sqlOf("20261123160000_personal_keys_run_and_companies.sql");
  await db.exec(m);
  await db.exec(m);
}, 30_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback"); });

describe("personal keys: read only or read and write", () => {
  it("takes {read} and {read,run} at 120, and refuses admin, demo, costs or another rate", async () => {
    expect(await errorCodeOf(key("h1", STAFF, "{read}", null))).toBeNull();
    expect(await errorCodeOf(key("h2", STAFF, "{read,run}", null))).toBeNull();
    for (const s of ["{read,admin}", "{read,demo}", "{read,costs}", "{run}"]) expect(await errorCodeOf(key(`h-${s}`, STAFF, s, null)), s).toBe("23514");
    expect(await errorCodeOf(`insert into public.api_keys (name, key_prefix, key_hash, scopes, rate_limit_per_minute, owner_user_id) values ('x', 'x', 'h9', '{read,run}', 500, '${STAFF}')`)).toBe("23514");
  });

  it("leaves tool keys free to carry any scopes and rate", async () => {
    expect(await errorCodeOf(`insert into public.api_keys (name, key_prefix, key_hash, scopes, rate_limit_per_minute) values ('Ops', 'x', 'h-ops', '{read,run,costs,admin}', 500)`)).toBeNull();
  });
});

describe("api_key_touch with the companies a personal key names", () => {
  it("reaches all the owner can see when the key names none, as before", async () => {
    await db.exec(key("h-admin-all", ADMIN, "{read}", null));
    await db.exec(key("h-staff-all", STAFF, "{read,run}", null));
    expect((await touch("h-admin-all"))[0]).toMatchObject({ client_ids: null, company_slugs: null });
    expect((await touch("h-staff-all"))[0]).toMatchObject({ scopes: ["read", "run"], client_ids: [A, B, C], company_slugs: null });
  });

  it("narrows to the named companies' clients: demos only for an admin", async () => {
    await db.exec(key("h-admin-calm", ADMIN, "{read}", "{calm}"));
    await db.exec(key("h-staff-calm", STAFF, "{read}", "{calm,bader-law}"));
    expect((await touch("h-admin-calm"))[0]).toMatchObject({ client_ids: [DEMO, C], company_slugs: null });
    expect((await touch("h-staff-calm"))[0]).toMatchObject({ client_ids: [A, C], company_slugs: null });
  });

  it("answers the id no client has when nothing named is in reach, never an empty list", async () => {
    await db.exec(key("h-staff-gone", STAFF, "{read}", "{nobody}"));
    expect((await touch("h-staff-gone"))[0].client_ids).toEqual([NONE]);
  });

  it("answers a tool key's stored reach as before", async () => {
    await db.exec(`insert into public.api_keys (name, key_prefix, key_hash, company_slugs, client_ids) values ('gOS', 'soc_t', 'h-tool', '{bader-law}', '{${A}}')`);
    expect((await touch("h-tool"))[0]).toMatchObject({ company_slugs: ["bader-law"], client_ids: [A] });
  });
});
