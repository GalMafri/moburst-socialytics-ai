// @vitest-environment node
// 20261111120000_personal_api_keys.sql, applied twice to PGlite over the API
// tables and api_key_touch exactly as they are live (read from
// 20261001100000_public_api.sql, with the audit user_id column that
// 20261109120000_claude_connector.sql added). A personal key reaches what its
// owner can see, worked out on every call: an admin reaches every client, a
// Moburst user every client that is not a demo, anyone else nothing (no row,
// and nothing is counted against the key). A tool key answers as before.
// Every audit row written for a personal key carries its owner.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migrations = join(functionsDir, "..", "migrations");
const migration = readFileSync(join(migrations, "20261111120000_personal_api_keys.sql"), "utf8");
const publicApi = readFileSync(join(migrations, "20261001100000_public_api.sql"), "utf8");

/** The live statements of 20261001100000_public_api.sql from `from` up to `to`. */
function liveSql(from: string, to: string): string {
  const start = publicApi.indexOf(from);
  const end = publicApi.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error(`20261001100000_public_api.sql no longer has "${from}" before "${to}"`);
  return publicApi.slice(start, end);
}
const LIVE_TABLES = liveSql("create table if not exists public.api_keys", "create table if not exists public.demo_jobs");
const LIVE_TOUCH = liveSql("create or replace function public.api_key_touch", "create or replace function public.demo_jobs_lease");

const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const STAFF = "00000000-0000-4000-8000-0000000000a2";
const CLIENT_USER = "00000000-0000-4000-8000-0000000000a3";
const NO_ROLE = "00000000-0000-4000-8000-0000000000a4";
const CLIENT_AND_STAFF = "00000000-0000-4000-8000-0000000000a5";
const SOMEONE_ELSE = "00000000-0000-4000-8000-0000000000a6";
// Inserted out of order, so a sorted answer is not the table's own order.
const CLIENT_A = "00000000-0000-4000-8000-0000000000c1";
const CLIENT_B = "00000000-0000-4000-8000-0000000000c2";
const CLIENT_C = "00000000-0000-4000-8000-0000000000c3";
const DEMO_CLIENT = "00000000-0000-4000-8000-0000000000c0";
const NO_CLIENT = "00000000-0000-0000-0000-000000000000";

const TOOL_KEY = "00000000-0000-4000-8000-0000000000b0";
const ADMIN_KEY = "00000000-0000-4000-8000-0000000000b1";
const STAFF_KEY = "00000000-0000-4000-8000-0000000000b2";
const CLIENT_KEY = "00000000-0000-4000-8000-0000000000b3";
const NO_ROLE_KEY = "00000000-0000-4000-8000-0000000000b4";
const CLIENT_AND_STAFF_KEY = "00000000-0000-4000-8000-0000000000b5";
const REVOKED_KEY = "00000000-0000-4000-8000-0000000000b6";

const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase grants every new public table, sequence and function to these roles; revokes are what take access away.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create schema auth;
create table auth.users (id uuid primary key, email text);
create type public.app_role as enum ('admin', 'moburst_user', 'client');
create table public.user_roles (user_id uuid, role public.app_role);
create table public.clients (id uuid primary key, company_slug text, demo_job_id uuid);
${LIVE_TABLES}
alter table public.api_requests add column if not exists user_id uuid;
alter table public.api_requests add column if not exists oauth_client_id text;
${LIVE_TOUCH}
revoke all on function public.api_key_touch(text) from public, anon, authenticated;
grant execute on function public.api_key_touch(text) to service_role;

insert into auth.users (id) values ('${ADMIN}'), ('${STAFF}'), ('${CLIENT_USER}'), ('${NO_ROLE}'), ('${CLIENT_AND_STAFF}'), ('${SOMEONE_ELSE}');
insert into public.user_roles values ('${ADMIN}', 'admin'), ('${STAFF}', 'moburst_user'), ('${CLIENT_USER}', 'client'),
  ('${CLIENT_AND_STAFF}', 'client'), ('${CLIENT_AND_STAFF}', 'moburst_user'), ('${SOMEONE_ELSE}', 'moburst_user');
insert into public.clients values ('${CLIENT_C}', 'calm', null), ('${DEMO_CLIENT}', 'demo-co', gen_random_uuid()),
  ('${CLIENT_A}', 'bader-law', null), ('${CLIENT_B}', 'other-co', null);
`;

// Personal keys are stored as the key routes make them: no company_slugs, no client_ids.
const KEYS = `
insert into public.api_keys (id, name, key_prefix, key_hash, company_slugs, client_ids) values
  ('${TOOL_KEY}', 'gOS', 'sk_tool', 'h-tool', '{bader-law}', '{${CLIENT_A}}');
insert into public.api_keys (id, name, key_prefix, key_hash, owner_user_id, created_by, expires_at, revoked_at) values
  ('${ADMIN_KEY}', 'Mine', 'sk_admin', 'h-admin', '${ADMIN}', '${ADMIN}', now() + interval '90 days', null),
  ('${STAFF_KEY}', 'Mine', 'sk_staff', 'h-staff', '${STAFF}', '${STAFF}', now() + interval '90 days', null),
  ('${CLIENT_KEY}', 'Mine', 'sk_client', 'h-client', '${CLIENT_USER}', '${CLIENT_USER}', now() + interval '90 days', null),
  ('${NO_ROLE_KEY}', 'Mine', 'sk_norole', 'h-norole', '${NO_ROLE}', '${NO_ROLE}', now() + interval '90 days', null),
  ('${CLIENT_AND_STAFF_KEY}', 'Mine', 'sk_both', 'h-both', '${CLIENT_AND_STAFF}', '${CLIENT_AND_STAFF}', now() + interval '90 days', null),
  ('${REVOKED_KEY}', 'Old', 'sk_old', 'h-revoked', '${SOMEONE_ELSE}', '${SOMEONE_ELSE}', '2026-11-01T00:00:00Z', '2026-10-15T00:00:00Z');
`;

interface Touched {
  id: string; name: string; key_prefix: string; scopes: string[]; company_slugs: string[] | null; client_ids: string[] | null;
  rate_limit_per_minute: number; expires_at: Date | null; revoked_at: Date | null; minute_count: number;
}

let db: PGlite;

/** api_key_touch as the api edge function calls it: as the service role. */
async function touch(hash: string): Promise<Touched[]> {
  await db.exec("set role service_role");
  try {
    const { rows } = await db.query<Touched>("select * from public.api_key_touch($1)", [hash]);
    return rows;
  } finally {
    await db.exec("reset role");
  }
}

/** One audit row as the api edge function writes it (as the service role); its user_id as stored. */
async function audit(keyId: string | null, userId?: string): Promise<string | null> {
  await db.exec("set role service_role");
  try {
    const { rows } = userId === undefined
      ? await db.query<{ user_id: string | null }>(
        "insert into public.api_requests (key_id, method, path, status, duration_ms) values ($1, 'GET', '/v1/clients', 200, 12) returning user_id", [keyId])
      : await db.query<{ user_id: string | null }>(
        "insert into public.api_requests (key_id, method, path, status, duration_ms, user_id) values ($1, 'GET', '/v1/clients', 200, 12, $2) returning user_id", [keyId, userId]);
    return rows[0].user_id;
  } finally {
    await db.exec("reset role");
  }
}

/** Runs `sql` in a savepoint (each test is a transaction) and gives the Postgres error code it raised, or null. */
async function errorCodeOf(sql: string): Promise<string | null> {
  await db.exec("savepoint attempt");
  try {
    await db.exec(sql);
    await db.exec("release savepoint attempt");
    return null;
  } catch (e) {
    await db.exec("rollback to savepoint attempt");
    return (e as { code?: string }).code ?? String(e);
  }
}
const CHECK_VIOLATION = "23514";
const personalKey = (hash: string, scopes: string, rate: number) => `
  insert into public.api_keys (name, key_prefix, key_hash, scopes, rate_limit_per_minute, owner_user_id, created_by)
  values ('Mine', 'sk_x', '${hash}', '${scopes}', ${rate}, '${STAFF}', '${STAFF}')`;

async function bucketsOf(keyId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.api_rate_buckets where key_id = $1", [keyId]);
  return rows[0].n;
}
async function lastUsedOf(keyId: string): Promise<Date | null> {
  const { rows } = await db.query<{ last_used_at: Date | null }>("select last_used_at from public.api_keys where id = $1", [keyId]);
  return rows[0].last_used_at;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(KEYS);
}, 30_000);
afterAll(async () => { await db.close(); });
// Each test runs in a transaction that is rolled back, so buckets, roles and clients start the same every time.
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback"); });

describe("api_key_touch: a tool key (no owner)", () => {
  it("touch_tool_key_unchanged: returns the reach it stores and counts the call, as before", async () => {
    const [row] = await touch("h-tool");
    expect(row.id).toBe(TOOL_KEY);
    expect(row.company_slugs).toEqual(["bader-law"]);
    expect(row.client_ids).toEqual([CLIENT_A]);
    expect(row.scopes).toEqual(["read"]);
    expect(row.rate_limit_per_minute).toBe(120);
    expect(row.minute_count).toBe(1);
    expect((await touch("h-tool"))[0].minute_count).toBe(2);
    expect(await lastUsedOf(TOOL_KEY)).not.toBeNull();
  });

  it("answers nothing for a hash no key has", async () => {
    expect(await touch("h-nobody")).toEqual([]);
  });
});

describe("api_key_touch: a personal key reaches what its owner can see, live", () => {
  it("touch_admin_owner_reaches_all: an admin's key reaches every client, demos included", async () => {
    const [row] = await touch("h-admin");
    expect(row.id).toBe(ADMIN_KEY);
    expect(row.client_ids).toBeNull();
    expect(row.company_slugs).toBeNull();
  });

  it("touch_staff_owner_reaches_real_clients: a Moburst user's key reaches every client that is not a demo, sorted", async () => {
    const [row] = await touch("h-staff");
    expect(row.id).toBe(STAFF_KEY);
    expect(row.client_ids).toEqual([CLIENT_A, CLIENT_B, CLIENT_C]);
    expect(row.client_ids).not.toContain(DEMO_CLIENT);
    expect(row.company_slugs).toBeNull();
  });

  it("follows the clients as they are at the moment of the call", async () => {
    const extra = "00000000-0000-4000-8000-0000000000c4";
    await db.exec(`insert into public.clients values ('${extra}', 'new-co', null)`);
    expect((await touch("h-staff"))[0].client_ids).toEqual([CLIENT_A, CLIENT_B, CLIENT_C, extra]);
    await db.exec(`update public.clients set demo_job_id = gen_random_uuid() where id = '${CLIENT_B}'`);
    expect((await touch("h-staff"))[0].client_ids).toEqual([CLIENT_A, CLIENT_C, extra]);
  });

  it("touch_staff_owner_no_clients_sentinel: with no client to reach, answers an id no client has, never an empty list", async () => {
    await db.exec("delete from public.clients where demo_job_id is null");
    const [row] = await touch("h-staff");
    expect(row.client_ids).toEqual([NO_CLIENT]);
    expect(row.company_slugs).toBeNull();
  });

  it("ignores any reach stored on a personal key's row", async () => {
    await db.exec(`update public.api_keys set company_slugs = '{bader-law}', client_ids = '{${CLIENT_A}}' where id in ('${ADMIN_KEY}', '${STAFF_KEY}')`);
    const [admin] = await touch("h-admin");
    expect(admin.client_ids).toBeNull();
    expect(admin.company_slugs).toBeNull();
    const [staff] = await touch("h-staff");
    expect(staff.client_ids).toEqual([CLIENT_A, CLIENT_B, CLIENT_C]);
    expect(staff.company_slugs).toBeNull();
  });

  it("touch_owner_not_staff_refused: a client's key, and a key whose owner has no role, answer no row and are not counted", async () => {
    expect(await touch("h-client")).toEqual([]);
    expect(await touch("h-norole")).toEqual([]);
    for (const key of [CLIENT_KEY, NO_ROLE_KEY]) {
      expect(await bucketsOf(key)).toBe(0);
      expect(await lastUsedOf(key)).toBeNull();
    }
  });

  it("reads more than one role row as the strongest: admin, then Moburst user", async () => {
    expect((await touch("h-both"))[0].client_ids).toEqual([CLIENT_A, CLIENT_B, CLIENT_C]);
    await db.exec(`insert into public.user_roles values ('${STAFF}', 'admin')`);
    expect((await touch("h-staff"))[0].client_ids).toBeNull();
  });

  it("stops at once when the owner stops being a Moburst user", async () => {
    expect(await touch("h-staff")).toHaveLength(1);
    await db.exec(`update public.user_roles set role = 'client' where user_id = '${STAFF}'`);
    expect(await touch("h-staff")).toEqual([]);
    await db.exec(`delete from public.user_roles where user_id = '${STAFF}'`);
    expect(await touch("h-staff")).toEqual([]);
  });

  it("goes with the owner's account: removing the user removes the key", async () => {
    await db.exec(`delete from auth.users where id = '${STAFF}'`);
    expect(await touch("h-staff")).toEqual([]);
    const { rows } = await db.query("select 1 from public.api_keys where id = $1", [STAFF_KEY]);
    expect(rows).toEqual([]);
  });

  it("touch_keeps_expiry_and_revocation: returns revoked_at and expires_at as stored, for the core to judge", async () => {
    const [row] = await touch("h-revoked");
    expect(row.id).toBe(REVOKED_KEY);
    expect(row.revoked_at?.toISOString()).toBe("2026-10-15T00:00:00.000Z");
    expect(row.expires_at?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(row.client_ids).toEqual([CLIENT_A, CLIENT_B, CLIENT_C]);
  });

  it("counts a served personal key against its own rate limit, like a tool key", async () => {
    expect((await touch("h-staff"))[0].minute_count).toBe(1);
    expect((await touch("h-staff"))[0].minute_count).toBe(2);
    expect(await bucketsOf(STAFF_KEY)).toBe(1);
    expect(await lastUsedOf(STAFF_KEY)).not.toBeNull();
  });
});

describe("api_requests_owner: the audit row of a personal key carries its owner", () => {
  it("audit_stamps_owner: owner for a personal key, null for a tool key, an explicit user_id kept", async () => {
    expect(await audit(STAFF_KEY)).toBe(STAFF);
    expect(await audit(ADMIN_KEY)).toBe(ADMIN);
    expect(await audit(TOOL_KEY)).toBeNull();
    expect(await audit(STAFF_KEY, SOMEONE_ELSE)).toBe(SOMEONE_ELSE);
    // The connector's rows (method MCP) have no key and their own user_id.
    expect(await audit(null, SOMEONE_ELSE)).toBe(SOMEONE_ELSE);
    expect(await audit(null)).toBeNull();
  });
});

describe("api_keys_personal_read_only: a personal key is read only at 120 a minute", () => {
  it("refuses a personal key with admin or demo scopes, or another rate", async () => {
    expect(await errorCodeOf(personalKey("h-p-admin", "{read,admin}", 120))).toBe(CHECK_VIOLATION);
    expect(await errorCodeOf(personalKey("h-p-demo", "{demo}", 120))).toBe(CHECK_VIOLATION);
    expect(await errorCodeOf(personalKey("h-p-rate", "{read}", 500))).toBe(CHECK_VIOLATION);
    expect(await errorCodeOf(`update public.api_keys set scopes = '{read,admin}' where id = '${STAFF_KEY}'`)).toBe(CHECK_VIOLATION);
  });

  it("takes a personal key with {read} at 120", async () => {
    expect(await errorCodeOf(personalKey("h-p-ok", "{read}", 120))).toBeNull();
  });

  it("leaves tool keys free to carry any scopes and rate", async () => {
    expect(await errorCodeOf(`
      insert into public.api_keys (name, key_prefix, key_hash, scopes, rate_limit_per_minute)
      values ('Ops tool', 'sk_ops', 'h-ops', '{read,demo,admin}', 500)`)).toBeNull();
  });
});

describe("the migration", () => {
  it("applies twice: one owner column with its foreign key and index, one audit trigger", async () => {
    const { rows: fks } = await db.query<{ n: number }>(`
      select count(*)::int as n from pg_constraint
       where conrelid = 'public.api_keys'::regclass and contype = 'f' and confrelid = 'auth.users'::regclass`);
    expect(fks[0].n).toBe(1);
    const { rows: rule } = await db.query<{ confdeltype: string }>(`
      select confdeltype from pg_constraint where conrelid = 'public.api_keys'::regclass and confrelid = 'auth.users'::regclass`);
    expect(rule[0].confdeltype).toBe("c");
    const { rows: idx } = await db.query("select 1 from pg_indexes where schemaname = 'public' and tablename = 'api_keys' and indexname = 'api_keys_owner'");
    expect(idx).toHaveLength(1);
    const { rows: triggers } = await db.query<{ n: number }>(`
      select count(*)::int as n from pg_trigger where tgrelid = 'public.api_requests'::regclass and tgname = 'api_requests_owner' and not tgisinternal`);
    expect(triggers[0].n).toBe(1);
    const { rows: checks } = await db.query<{ n: number }>(`
      select count(*)::int as n from pg_constraint
       where conrelid = 'public.api_keys'::regclass and contype = 'c' and conname = 'api_keys_personal_read_only'`);
    expect(checks[0].n).toBe(1);
  });

  it("keeps api_key_touch's return columns and leaves it to the service role only", async () => {
    const { rows } = await db.query<{ result: string; anon: boolean; authenticated: boolean; service: boolean }>(`
      select pg_get_function_result('public.api_key_touch(text)'::regprocedure) as result,
             has_function_privilege('anon', 'public.api_key_touch(text)', 'execute') as anon,
             has_function_privilege('authenticated', 'public.api_key_touch(text)', 'execute') as authenticated,
             has_function_privilege('service_role', 'public.api_key_touch(text)', 'execute') as service`);
    expect(rows[0].result).toBe("TABLE(id uuid, name text, key_prefix text, scopes text[], company_slugs text[], client_ids uuid[], rate_limit_per_minute integer, "
      + "expires_at timestamp with time zone, revoked_at timestamp with time zone, minute_count integer)");
    expect(rows[0]).toMatchObject({ anon: false, authenticated: false, service: true });
  });

  it("does not let a signed-in user call the audit trigger's function", async () => {
    const { rows } = await db.query<{ anon: boolean; authenticated: boolean }>(`
      select has_function_privilege('anon', 'public.api_requests_owner()', 'execute') as anon,
             has_function_privilege('authenticated', 'public.api_requests_owner()', 'execute') as authenticated`);
    expect(rows[0]).toEqual({ anon: false, authenticated: false });
  });
});
