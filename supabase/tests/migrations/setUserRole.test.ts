// @vitest-environment node
// 20261113100100_set_user_role.sql, applied twice to PGlite over user_roles as
// it is live (unique on user_id and role). Both portal bridges write a
// person's role through it: the new role is in place and the others are gone
// after one call, and the account is never without a role in between, which a
// tab that loaded in that moment read as "no role" (QA 12 Nov 2026,
// ACCESS-API-02). Only the service role may call it. set_client_access does
// the same for a legacy client's companies: the wanted rows are in place
// before the others go, so the mapping is never empty (QA review round 2).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migration = readFileSync(join(functionsDir, "..", "migrations", "20261113100100_set_user_role.sql"), "utf8");
const USER = "00000000-0000-4000-8000-0000000000a1";

let db: PGlite;
const roles = async (id = USER) => ((await db.query<{ role: string }>("select role from public.user_roles where user_id = $1 order by role", [id])).rows).map((r) => r.role);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create type public.app_role as enum ('admin', 'user', 'moburst_user', 'client');
    create table public.user_roles (id uuid primary key default gen_random_uuid(), user_id uuid not null, role public.app_role not null, unique (user_id, role));
    grant all on public.user_roles to service_role;
    create table public.client_users (id uuid primary key default gen_random_uuid(), user_id uuid not null, client_id uuid not null, role text default 'viewer', created_at timestamptz default now(), unique (user_id, client_id));
    grant all on public.client_users to service_role;
  `);
  await db.exec(migration);
  await db.exec(migration);
});
afterAll(async () => { await db.close(); });

describe("set_user_role", () => {
  it("gives a person with no role the new one", async () => {
    await db.query("select public.set_user_role($1, 'client')", [USER]);
    expect(await roles()).toEqual(["client"]);
  });

  it("replaces every other role with the new one, and keeps it when it is already there", async () => {
    await db.query("insert into public.user_roles (user_id, role) values ($1, 'admin')", [USER]);
    await db.query("select public.set_user_role($1, 'moburst_user')", [USER]);
    expect(await roles()).toEqual(["moburst_user"]);
    await db.query("select public.set_user_role($1, 'moburst_user')", [USER]);
    expect(await roles()).toEqual(["moburst_user"]);
  });

  it("removes every role when the role is null, and leaves other people's alone", async () => {
    const other = "00000000-0000-4000-8000-0000000000a3";
    await db.query("insert into public.user_roles (user_id, role) values ($1, 'admin'), ($1, 'client'), ($2, 'admin')", [USER, other]);
    await db.query("select public.set_user_role($1, null)", [USER]);
    expect(await roles()).toEqual([]);
    expect(await roles(other)).toEqual(["admin"]);
    await db.query("delete from public.user_roles where user_id = $1", [other]);
  });

  it("leaves other people's roles alone", async () => {
    const other = "00000000-0000-4000-8000-0000000000a2";
    await db.query("insert into public.user_roles (user_id, role) values ($1, 'admin')", [other]);
    await db.query("select public.set_user_role($1, 'client')", [USER]);
    expect(await roles(other)).toEqual(["admin"]);
  });

  it("can be called by the service role only", async () => {
    await db.exec("set role authenticated");
    await expect(db.query("select public.set_user_role($1, 'admin')", [USER])).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
    await db.exec("set role service_role");
    await db.query("select public.set_user_role($1, 'client')", [USER]);
    await db.exec("reset role");
  });
});

const C1 = "00000000-0000-4000-8000-0000000000c1";
const C2 = "00000000-0000-4000-8000-0000000000c2";
const C3 = "00000000-0000-4000-8000-0000000000c3";
const clients = async (id = USER) => ((await db.query<{ client_id: string }>("select client_id from public.client_users where user_id = $1 order by client_id", [id])).rows).map((r) => r.client_id);
const rowIds = async () => ((await db.query<{ id: string }>("select id from public.client_users where user_id = $1 and client_id = $2", [USER, C2])).rows).map((r) => r.id);

describe("set_client_access", () => {
  it("writes the wanted clients, drops the others and reports the count", async () => {
    await db.query("delete from public.client_users");
    await db.query("insert into public.client_users (user_id, client_id) values ($1, $2)", [USER, C1]);
    const { rows } = await db.query<{ n: number }>("select public.set_client_access($1, array[$2, $3]::uuid[]) as n", [USER, C2, C3]);
    expect(rows[0].n).toBe(2);
    expect(await clients()).toEqual([C2, C3]);
  });

  it("keeps a row that is still wanted as the same row, so the mapping is never rewritten and never empty", async () => {
    const before = await rowIds();
    await db.query("select public.set_client_access($1, array[$2, $3]::uuid[])", [USER, C2, C1]);
    expect(await rowIds()).toEqual(before);
    expect(await clients()).toEqual([C1, C2]);
  });

  it("removes every client for an empty list or null, and leaves other people alone", async () => {
    const other = "00000000-0000-4000-8000-0000000000a9";
    await db.query("insert into public.client_users (user_id, client_id) values ($1, $2)", [other, C1]);
    await db.query("select public.set_client_access($1, '{}'::uuid[])", [USER]);
    expect(await clients()).toEqual([]);
    await db.query("insert into public.client_users (user_id, client_id) values ($1, $2)", [USER, C1]);
    await db.query("select public.set_client_access($1, null)", [USER]);
    expect(await clients()).toEqual([]);
    expect(await clients(other)).toEqual([C1]);
  });

  it("takes a client listed twice once, and can be called by the service role only", async () => {
    await db.query("select public.set_client_access($1, array[$2, $2]::uuid[])", [USER, C1]);
    expect(await clients()).toEqual([C1]);
    await db.exec("set role authenticated");
    await expect(db.query("select public.set_client_access($1, '{}'::uuid[])", [USER])).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  });
});
