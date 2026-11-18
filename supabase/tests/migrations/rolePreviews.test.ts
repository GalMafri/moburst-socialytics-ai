// @vitest-environment node
// 20261118120000_role_previews.sql, applied twice to PGlite over the access
// rules as they are live, with the preview's requests (role-preview/preview.ts)
// run against that database through the two functions the migration adds.
// Preview as a client, 18 Nov 2026: a staff member in a preview of one
// client is, to every access rule, a client user of exactly that client;
// after Exit they are staff again with nothing left behind; a person is a
// client exactly when they have an open row; and a role a sign-in or a
// removal wrote is never written over.
//
// PGlite is one connection, so two calls cannot overlap here. What is tested
// is every order two calls can land in; that they cannot interleave is the
// row lock each function takes, which this harness cannot exercise.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { functionsDir } from "../paths.ts";
import { handleRolePreview, type PreviewStore } from "../../functions/role-preview/preview.ts";
import { readBegin, readEnd, readPreview } from "../../functions/role-preview/store.ts";

const migrations = join(functionsDir, "..", "migrations");
const migration = readFileSync(join(migrations, "20261118120000_role_previews.sql"), "utf8");
// set_user_role and set_client_access, as the sign-in bridges call them.
const roleWrites = readFileSync(join(migrations, "20261113100100_set_user_role.sql"), "utf8");

// Each case sets a database up again. Between cases the worker is handed back
// for one turn, so on a slow machine the runner's messages are still answered.
const turn = () => new Promise<void>((done) => setImmediate(done));
afterEach(turn);

const ADMIN = "00000000-0000-4000-8000-0000000000a1"; // signs in through the older Hub: a company name on the profile
const STAFF = "00000000-0000-4000-8000-0000000000a2"; // signs in through moburst.ai: a company list on the profile
const OTHER_STAFF = "00000000-0000-4000-8000-0000000000a3";
const CLIENT_USER = "00000000-0000-4000-8000-0000000000a4"; // a real client of South
const NORTH = "00000000-0000-4000-8000-0000000000c1";
const SOUTH = "00000000-0000-4000-8000-0000000000c2"; // carries the admin's company name
const EAST = "00000000-0000-4000-8000-0000000000c3"; // is on the staff member's company list
const DEMO = "00000000-0000-4000-8000-0000000000c4";
const ARCHIVED = "00000000-0000-4000-8000-0000000000c5";
const UNKNOWN = "00000000-0000-4000-8000-0000000000c9";

// The tables and helpers the access rules read, as they are live: is_admin
// and is_moburst_staff (20260419000002), is_company_restricted and
// is_client_member with its three branches (20260720130000),
// can_access_client (20261111110000), can_write_client, the demo rule
// (20261006120000) and the select policies on clients and reports.
const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key);
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create type public.app_role as enum ('admin', 'user', 'moburst_user', 'client');
create table public.clients (id uuid primary key, name text not null, hub_company_name text, company_slug text, archived_at timestamptz, demo_job_id uuid);
create table public.reports (id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id) on delete cascade, demo_job_id uuid);
create table public.user_roles (id uuid primary key default gen_random_uuid(), user_id uuid not null, role public.app_role not null, unique (user_id, role));
create table public.client_users (id uuid primary key default gen_random_uuid(), user_id uuid not null, client_id uuid not null references public.clients(id) on delete cascade, role text default 'viewer', created_at timestamptz default now(), unique (user_id, client_id));
create table public.profiles (user_id uuid primary key, hub_company_name text, allowed_company_slugs text[]);
grant all on all tables in schema public to service_role;
grant select on public.clients, public.reports, public.user_roles, public.client_users, public.profiles to authenticated;

create function public.is_oauth_session() returns boolean language sql stable as $$ select coalesce(auth.jwt() ->> 'client_id', '') <> '' $$;
create function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') $$;
create function public.is_moburst_staff() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('admin'::public.app_role, 'moburst_user'::public.app_role)) $$;
create function public.is_company_restricted() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where user_id = auth.uid()
    and hub_company_name is null and allowed_company_slugs is not null and cardinality(allowed_company_slugs) > 0) $$;
create function public.is_client_member(_client_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from public.clients c join public.profiles p on p.user_id = auth.uid()
      where c.id = _client_id and c.hub_company_name is not null and p.hub_company_name is not null
        and lower(trim(c.hub_company_name)) = lower(trim(p.hub_company_name)))
    or (not public.is_company_restricted()
      and exists (select 1 from public.client_users cu where cu.user_id = auth.uid() and cu.client_id = _client_id))
    or exists (select 1 from public.clients c join public.profiles p on p.user_id = auth.uid()
      where c.id = _client_id and p.hub_company_name is null and p.allowed_company_slugs is not null
        and c.company_slug is not null and c.company_slug = any (p.allowed_company_slugs)) $$;
create function public.can_access_client(_client_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_moburst_staff() or public.is_client_member(_client_id) $$;
create function public.can_write_client(_client_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_moburst_staff() and public.can_access_client(_client_id) $$;
create function public.is_demo_client(_client_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.clients c where c.id = _client_id and c.demo_job_id is not null) $$;

alter table public.clients enable row level security;
create policy "Admins can do everything with clients" on public.clients for all to authenticated using (public.is_admin());
create policy "Moburst staff can view clients" on public.clients for select to authenticated using (public.can_access_client(id));
create policy "Demo clients are for admins only" on public.clients as restrictive for select to authenticated using (public.is_admin() or demo_job_id is null);
alter table public.reports enable row level security;
create policy "Moburst staff can view reports" on public.reports for select to authenticated using (public.can_access_client(client_id));
create policy "Demo rows are for admins only" on public.reports as restrictive for select to authenticated
  using (public.is_admin() or (demo_job_id is null and not public.is_demo_client(client_id)));

insert into auth.users values ('${ADMIN}'), ('${STAFF}'), ('${OTHER_STAFF}'), ('${CLIENT_USER}');
insert into public.clients (id, name, hub_company_name, company_slug, archived_at, demo_job_id) values
  ('${NORTH}', 'North Bakery', 'North Bakery', 'north-bakery', null, null),
  ('${SOUTH}', 'South Cycles', 'Harbor Works', 'south-cycles', null, null),
  ('${EAST}', 'East Garden', 'East Garden', 'east-garden', null, null),
  ('${DEMO}', 'Sample Co', 'Sample Co', 'sample-co', null, gen_random_uuid()),
  ('${ARCHIVED}', 'Old Mill', 'Old Mill', 'old-mill', now(), null);
insert into public.reports (client_id) values ('${NORTH}'), ('${NORTH}'), ('${SOUTH}'), ('${EAST}'), ('${DEMO}');
`;
// The people, as they are before each case.
const PEOPLE = `
delete from public.role_previews; delete from public.user_roles; delete from public.client_users; delete from public.profiles;
insert into public.user_roles (user_id, role) values ('${ADMIN}', 'admin'), ('${STAFF}', 'moburst_user'), ('${OTHER_STAFF}', 'moburst_user'), ('${CLIENT_USER}', 'client');
insert into public.profiles values ('${ADMIN}', 'Harbor Works', null), ('${STAFF}', null, '{east-garden}'), ('${OTHER_STAFF}', null, '{}'), ('${CLIENT_USER}', 'Harbor Works', null);
insert into public.client_users (user_id, client_id) values ('${ADMIN}', '${SOUTH}'), ('${CLIENT_USER}', '${SOUTH}');
`;

let db: PGlite;

/** Runs one statement as a role (and, for a signed-in person, with their session), then returns to the superuser. */
async function as<T>(who: { role: "anon" | "authenticated" | "service_role"; user?: string }, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.query("select set_config('request.jwt.claims', $1, false)", [who.user ? JSON.stringify({ sub: who.user, role: "authenticated" }) : ""]);
  await db.exec(`set role ${who.role}`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}
const person = (user: string) => ({ role: "authenticated" as const, user });
const service = { role: "service_role" as const };
/** One yes-or-no helper, answered for a signed-in person. */
const says = async (user: string, sql: string) => (await as<{ v: boolean }>(person(user), `select (${sql}) as v`))[0].v;
const ids = async (user: string, sql: string) => (await as<{ id: string }>(person(user), sql)).map((r) => r.id).sort();
const rows = (sql: string, params: unknown[] = []) => db.query<Record<string, unknown>>(sql, params).then((r) => r.rows);

// The function's three database calls, made as the service role, as the function makes them.
const store: PreviewStore = {
  openPreview: async (u) => readPreview((await as(service, "select id, client_id, client_name, started_at from public.role_previews where user_id = $1 and ended_at is null", [u]))[0]),
  begin: async (u, c) => readBegin((await as<{ r: unknown }>(service, "select public.role_preview_begin($1, $2) as r", [u, c]))[0].r),
  end: async (id, reason) => readEnd((await as<{ r: unknown }>(service, "select public.role_preview_end($1, $2) as r", [id, reason]))[0].r),
};
const start = (user: string, client: string) => handleRolePreview(store, user, { action: "start", client_id: client });
const stop = (user: string) => handleRolePreview(store, user, { action: "stop" });
const status = (user: string) => handleRolePreview(store, user, { action: "status" });

// What a sign-in through a Hub does: three writes of its own, each one transaction, knowing nothing of previews.
const signIn = async (user: string, role: string | null, company: string | null, slugs: string | null, clients: string[] = []) => {
  await as(service, "insert into public.profiles (user_id, hub_company_name, allowed_company_slugs) values ($1, $2, $3::text[]) on conflict (user_id) do update set hub_company_name = excluded.hub_company_name, allowed_company_slugs = excluded.allowed_company_slugs", [user, company, slugs]);
  await as(service, "select public.set_user_role($1, $2::public.app_role)", [user, role]);
  await as(service, "select public.set_client_access($1, $2::uuid[])", [user, `{${clients.join(",")}}`]);
};
/** Everything the access rules read about a person, and their open preview rows. */
const stateOf = async (user: string) => ({
  roles: (await rows("select role::text as role from public.user_roles where user_id = $1 order by role", [user])).map((r) => r.role),
  links: (await rows("select client_id from public.client_users where user_id = $1 order by client_id", [user])).map((r) => r.client_id),
  profile: (await rows("select hub_company_name, allowed_company_slugs from public.profiles where user_id = $1", [user]))[0] ?? null,
  open: (await rows("select count(*)::int as n from public.role_previews where user_id = $1 and ended_at is null", [user]))[0].n,
});
const ADMIN_BEFORE = { roles: ["admin"], links: [SOUTH], profile: { hub_company_name: "Harbor Works", allowed_company_slugs: null }, open: 0 };
const IN_NORTH = { roles: ["client"], links: [NORTH], profile: { hub_company_name: null, allowed_company_slugs: [] }, open: 1 };
const reasons = async (user: string) => (await rows("select ended_reason from public.role_previews where user_id = $1 order by started_at, ended_at", [user])).map((r) => r.ended_reason);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(roleWrites);
  await db.exec(migration);
  await db.exec(migration);
}, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(PEOPLE);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the role_previews table and its two functions", () => {
  it("is written by nobody directly: not a signed-in person, not an admin, not the service role", async () => {
    const insert = `insert into public.role_previews (user_id, client_id, client_name, previous_role) values ('${ADMIN}', '${NORTH}', 'North Bakery', 'admin')`;
    for (const who of [person(STAFF), person(ADMIN), { role: "anon" as const }, service]) {
      await expect(as(who, insert)).rejects.toMatchObject({ code: "42501" });
      await expect(as(who, "update public.role_previews set previous_role = 'admin'")).rejects.toMatchObject({ code: "42501" });
      await expect(as(who, "delete from public.role_previews")).rejects.toMatchObject({ code: "42501" });
    }
    await expect(as({ role: "anon" }, "select id from public.role_previews")).rejects.toMatchObject({ code: "42501" });
  });

  it("lets only the service role call the functions that make the switch", async () => {
    for (const who of [person(ADMIN), person(STAFF), { role: "anon" as const }]) {
      await expect(as(who, `select public.role_preview_begin('${ADMIN}', '${NORTH}')`)).rejects.toMatchObject({ code: "42501" });
      await expect(as(who, `select public.role_preview_end('${UNKNOWN}', 'exited')`)).rejects.toMatchObject({ code: "42501" });
      await expect(as(who, `select public.role_preview_holds('${ADMIN}', '${NORTH}')`)).rejects.toMatchObject({ code: "42501" });
    }
    expect(await stateOf(ADMIN)).toEqual(ADMIN_BEFORE);
  });

  it("lets a person read their own rows and an admin read every row", async () => {
    await start(STAFF, NORTH);
    await start(OTHER_STAFF, EAST);
    expect(await as(person(STAFF), "select user_id from public.role_previews")).toEqual([{ user_id: STAFF }]);
    expect(await as(person(OTHER_STAFF), "select user_id from public.role_previews")).toEqual([{ user_id: OTHER_STAFF }]);
    expect(await as(person(CLIENT_USER), "select user_id from public.role_previews")).toEqual([]);
    expect(await as(person(ADMIN), "select user_id from public.role_previews")).toHaveLength(2);
  });

  it("holds one open preview per person, only a staff role to go back to, and an end only with a known reason", async () => {
    const open = (role: string) => db.query(`insert into public.role_previews (user_id, client_id, client_name, previous_role) values ('${STAFF}', '${NORTH}', 'North Bakery', '${role}')`);
    await open("moburst_user");
    await expect(open("moburst_user")).rejects.toMatchObject({ code: "23505" });
    await db.exec("delete from public.role_previews");
    await expect(open("client")).rejects.toMatchObject({ code: "23514" });
    await open("admin");
    await expect(db.query("update public.role_previews set ended_at = now()")).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("update public.role_previews set ended_at = now(), ended_reason = 'because'")).rejects.toMatchObject({ code: "23514" });
    await db.query("update public.role_previews set ended_at = now(), ended_reason = 'exited'");
  });

  it("carries the three policies that keep a connected app from writing", async () => {
    const names = (await rows("select policyname from pg_policies where tablename = 'role_previews' order by policyname")).map((r) => r.policyname);
    expect(names).toEqual(["A person reads their own previews", "Admins read every preview", "OAuth sessions cannot delete", "OAuth sessions cannot insert", "OAuth sessions cannot update"]);
  });
});

describe.each([
  // The admin's profile names a company that the South client carries, and they hold an old link to it.
  { who: "an admin whose profile names another client's company", user: ADMIN, wasAdmin: true, before: ADMIN_BEFORE, sees: [ARCHIVED, DEMO, EAST, NORTH, SOUTH].sort() },
  // The staff member's company list holds the East client.
  { who: "a Moburst user whose company list holds another client", user: STAFF, wasAdmin: false, before: { roles: ["moburst_user"], links: [] as string[], profile: { hub_company_name: null, allowed_company_slugs: ["east-garden"] }, open: 0 }, sees: [ARCHIVED, EAST, NORTH, SOUTH].sort() },
])("a preview of the North client by $who", ({ user, wasAdmin, before, sees }) => {
  it("makes them a client user of North and of nothing else, in the helpers and in the row policies", async () => {
    expect(await says(user, "public.is_moburst_staff()")).toBe(true);
    expect(await ids(user, "select id from public.clients")).toEqual(sees);

    expect((await start(user, NORTH)).status).toBe(200);
    expect(await says(user, "public.is_moburst_staff()")).toBe(false);
    expect(await says(user, "public.is_admin()")).toBe(false);
    expect(await says(user, `public.is_client_member('${NORTH}')`)).toBe(true);
    expect(await says(user, `public.is_client_member('${SOUTH}')`)).toBe(false);
    expect(await says(user, `public.is_client_member('${EAST}')`)).toBe(false);
    expect(await says(user, `public.can_access_client('${NORTH}')`)).toBe(true);
    expect(await says(user, `public.can_access_client('${SOUTH}')`)).toBe(false);
    // A client reads and never writes.
    expect(await says(user, `public.can_write_client('${NORTH}')`)).toBe(false);
    expect(await ids(user, "select id from public.clients")).toEqual([NORTH]);
    expect((await as<{ client_id: string }>(person(user), "select client_id from public.reports")).map((r) => r.client_id)).toEqual([NORTH, NORTH]);
    // Exactly the three places a real client user of one client has.
    expect(await stateOf(user)).toEqual(IN_NORTH);
    expect(await rows("select role from public.client_users where user_id = $1", [user])).toEqual([{ role: "viewer" }]);
    // The page can see that a preview is open, and only its owner's.
    expect(await as(person(user), "select client_name from public.role_previews where ended_at is null")).toEqual([{ client_name: "North Bakery" }]);
    expect(await as(person(OTHER_STAFF), "select client_name from public.role_previews")).toEqual([]);
  });

  it("ends with them staff again, exactly as before, and no client row left behind", async () => {
    await start(user, NORTH);
    expect(await stop(user)).toEqual({ status: 200, body: { preview: null, ended: "exited" } });
    expect(await stateOf(user)).toEqual(before);
    expect(await says(user, "public.is_moburst_staff()")).toBe(true);
    expect(await says(user, "public.is_admin()")).toBe(wasAdmin);
    expect(await says(user, `public.can_write_client('${SOUTH}')`)).toBe(true);
    expect(await ids(user, "select id from public.clients")).toEqual(sees);
    expect(await reasons(user)).toEqual(["exited"]);
    // Exit is spent: it cannot be used a second time.
    expect((await stop(user)).status).toBe(409);
    expect(await stateOf(user)).toEqual(before);
  });
});

describe("who may start, and of which client", () => {
  it("refuses a client and a person with no role, and writes nothing", async () => {
    const real = await stateOf(CLIENT_USER);
    expect(await start(CLIENT_USER, SOUTH)).toMatchObject({ status: 403, body: { code: "not_staff" } });
    expect(await stateOf(CLIENT_USER)).toEqual(real);
    expect(await start("00000000-0000-4000-8000-0000000000a9", NORTH)).toMatchObject({ status: 403, body: { code: "not_staff" } });
    expect(await rows("select 1 from public.role_previews")).toEqual([]);
  });

  it("refuses a person the Hub removed a moment ago, though their page still shows staff", async () => {
    await signIn(ADMIN, null, null, null);
    expect(await start(ADMIN, NORTH)).toMatchObject({ status: 403, body: { code: "not_staff" } });
    expect(await stateOf(ADMIN)).toEqual({ roles: [], links: [], profile: { hub_company_name: null, allowed_company_slugs: null }, open: 0 });
  });

  it("refuses a client that is unknown or archived, and a demo client for anyone but an admin", async () => {
    expect(await start(STAFF, UNKNOWN)).toMatchObject({ status: 404, body: { code: "client_not_found" } });
    expect(await start(STAFF, ARCHIVED)).toMatchObject({ status: 409, body: { code: "client_archived" } });
    expect(await start(STAFF, DEMO)).toMatchObject({ status: 404, body: { code: "client_not_found" } });
    expect((await stateOf(STAFF)).roles).toEqual(["moburst_user"]);
    expect(await rows("select 1 from public.role_previews")).toEqual([]);
    expect((await start(ADMIN, DEMO)).status).toBe(200);
  });

  it("gives a person with a second, weaker role row their strongest staff role back", async () => {
    await db.query("insert into public.user_roles (user_id, role) values ($1, 'moburst_user'), ($1, 'user')", [ADMIN]);
    await start(ADMIN, NORTH);
    expect((await stateOf(ADMIN)).roles).toEqual(["client"]);
    await stop(ADMIN);
    expect((await stateOf(ADMIN)).roles).toEqual(["admin"]);
  });
});

describe("a role the Hub writes is never written over", () => {
  it("Exit after a removal puts nothing back: the person stays removed", async () => {
    await start(ADMIN, NORTH);
    // The Hub removes the person while their preview is open.
    await as(service, "select public.set_user_role($1, null)", [ADMIN]);
    await as(service, "select public.set_client_access($1, '{}'::uuid[])", [ADMIN]);
    expect(await stop(ADMIN)).toEqual({ status: 200, body: { preview: null, ended: "role_changed" } });
    expect(await stateOf(ADMIN)).toMatchObject({ roles: [], links: [], open: 0 });
    expect(await says(ADMIN, "public.is_moburst_staff()")).toBe(false);
    // And with the row closed, nothing can bring the admin role back.
    expect((await stop(ADMIN)).status).toBe(409);
    expect((await start(ADMIN, NORTH)).status).toBe(403);
  });

  it("a removal that lands on the role row alone is enough: the saved admin role stays unwritten", async () => {
    await start(ADMIN, NORTH);
    await as(service, "select public.set_user_role($1, null)", [ADMIN]);
    expect((await status(ADMIN)).body).toEqual({ preview: null, ended: "role_changed" });
    expect((await stateOf(ADMIN)).roles).toEqual([]);
  });

  it("a sign-in as staff during a preview stands: the row is closed and nothing is put back", async () => {
    await start(ADMIN, NORTH);
    await signIn(ADMIN, "moburst_user", null, "{}");
    const fromHub = { roles: ["moburst_user"], links: [], profile: { hub_company_name: null, allowed_company_slugs: [] }, open: 1 };
    expect(await stateOf(ADMIN)).toEqual(fromHub);
    expect((await status(ADMIN)).body).toEqual({ preview: null, ended: "role_changed" });
    expect(await stateOf(ADMIN)).toEqual({ ...fromHub, open: 0 });
    expect(await reasons(ADMIN)).toEqual(["role_changed"]);
  });

  it("a sign-in that made the person a real client stands too, even of the same client", async () => {
    await start(ADMIN, NORTH);
    await signIn(ADMIN, "client", "North Bakery", null, [NORTH]);
    expect(await stop(ADMIN)).toEqual({ status: 200, body: { preview: null, ended: "role_changed" } });
    expect(await stateOf(ADMIN)).toEqual({ roles: ["client"], links: [NORTH], profile: { hub_company_name: "North Bakery", allowed_company_slugs: null }, open: 0 });
    expect((await start(ADMIN, NORTH)).status).toBe(403);
  });

  it("a sign-in's role write lands on the preview's own role row, so no client role is left beside it", async () => {
    await start(ADMIN, NORTH);
    await as(service, "select public.set_user_role($1, 'admin')", [ADMIN]);
    expect((await stateOf(ADMIN)).roles).toEqual(["admin"]);
    // A new preview starts from what the sign-in wrote, with the old row closed on the way.
    await signIn(ADMIN, "moburst_user", null, "{}");
    expect((await start(ADMIN, SOUTH)).status).toBe(200);
    expect(await reasons(ADMIN)).toEqual(["role_changed", null]);
    expect(await rows("select previous_role::text as r, previous_client_ids as c from public.role_previews where user_id = $1 and ended_at is null", [ADMIN])).toEqual([{ r: "moburst_user", c: [] }]);
  });
});

describe("Start and Exit from two tabs, in either order", () => {
  // A person is a client exactly when they have an open row.
  const consistent = async (user: string) => {
    const s = await stateOf(user);
    expect(s.roles.includes("client")).toBe(s.open === 1);
    return s;
  };

  it("a second Start while a preview is open changes nothing", async () => {
    await start(ADMIN, NORTH);
    expect(await start(ADMIN, SOUTH)).toMatchObject({ status: 409, body: { code: "already_previewing", preview: { client_id: NORTH } } });
    expect(await consistent(ADMIN)).toEqual(IN_NORTH);
    expect(await rows("select count(*)::int as n from public.role_previews")).toEqual([{ n: 1 }]);
  });

  it("Exit then Start: the old preview is over and the new one holds what the person had as staff", async () => {
    await start(ADMIN, NORTH);
    await stop(ADMIN);
    expect((await start(ADMIN, EAST)).status).toBe(200);
    expect(await consistent(ADMIN)).toEqual({ ...IN_NORTH, links: [EAST] });
    expect(await rows("select previous_role::text as r, previous_client_ids as c, previous_hub_company_name as n from public.role_previews where ended_at is null")).toEqual([{ r: "admin", c: [SOUTH], n: "Harbor Works" }]);
  });

  it("Start then Exit, then an Exit that arrives late: staff again, exactly as before", async () => {
    await start(ADMIN, NORTH);
    const late = (await store.openPreview(ADMIN))!.id;
    await stop(ADMIN);
    expect(await consistent(ADMIN)).toEqual(ADMIN_BEFORE);
    // The other tab's Exit, sent for the same row, finds it closed and changes nothing.
    expect(await store.end(late, "exited")).toEqual({ open: false, ended: null });
    expect(await consistent(ADMIN)).toEqual(ADMIN_BEFORE);
    // Nor can a late Exit end a newer preview that is not its own.
    await start(ADMIN, EAST);
    expect(await store.end(late, "exited")).toEqual({ open: false, ended: null });
    expect((await consistent(ADMIN)).links).toEqual([EAST]);
  });
});

describe("a preview left open", () => {
  it("is open until 8 hours, and is ended with everything put back by the next status after that", async () => {
    await start(ADMIN, NORTH);
    await db.exec("update public.role_previews set started_at = now() - interval '7 hours 59 minutes'");
    expect((await status(ADMIN)).body).toMatchObject({ preview: { client_id: NORTH, client_name: "North Bakery" }, ended: null });
    expect(await stateOf(ADMIN)).toEqual(IN_NORTH);
    await db.exec("update public.role_previews set started_at = now() - interval '8 hours 1 second'");
    expect((await status(ADMIN)).body).toEqual({ preview: null, ended: "expired" });
    expect(await stateOf(ADMIN)).toEqual(ADMIN_BEFORE);
    expect(await reasons(ADMIN)).toEqual(["expired"]);
  });

  it("past 8 hours does not stand in the way of a new Start", async () => {
    await start(ADMIN, NORTH);
    await db.exec("update public.role_previews set started_at = now() - interval '9 hours'");
    expect((await start(ADMIN, EAST)).status).toBe(200);
    expect(await reasons(ADMIN)).toEqual(["expired", null]);
    expect((await stateOf(ADMIN)).links).toEqual([EAST]);
  });

  it("can still be left after its client was deleted", async () => {
    const GONE = "00000000-0000-4000-8000-0000000000c6";
    await db.query("insert into public.clients (id, name) values ($1, 'West Pier')", [GONE]);
    await start(OTHER_STAFF, GONE);
    await db.query("delete from public.clients where id = $1", [GONE]);
    expect(await rows("select client_id, client_name, ended_at from public.role_previews where user_id = $1", [OTHER_STAFF])).toEqual([{ client_id: null, client_name: "West Pier", ended_at: null }]);
    expect(await ids(OTHER_STAFF, "select id from public.clients")).toEqual([]);
    expect((await status(OTHER_STAFF)).body).toMatchObject({ preview: { client_id: null, client_name: "West Pier" } });
    expect(await stop(OTHER_STAFF)).toEqual({ status: 200, body: { preview: null, ended: "exited" } });
    expect(await stateOf(OTHER_STAFF)).toEqual({ roles: ["moburst_user"], links: [], profile: { hub_company_name: null, allowed_company_slugs: [] }, open: 0 });
  });
});

describe("role_preview_end", () => {
  it("answers for a row that does not exist, and refuses a reason it does not know", async () => {
    expect(await store.end(UNKNOWN, "check")).toEqual({ open: false, ended: null });
    await start(ADMIN, NORTH);
    const id = (await store.openPreview(ADMIN))!.id;
    await expect(as(service, "select public.role_preview_end($1, 'role_changed')", [id])).rejects.toMatchObject({ code: "22023" });
    expect(await stateOf(ADMIN)).toEqual(IN_NORTH);
  });
});
