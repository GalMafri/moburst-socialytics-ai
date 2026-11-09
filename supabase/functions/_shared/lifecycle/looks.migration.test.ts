// @vitest-environment node
// 20261110160000_lifecycle_looks.sql and 20261110210000_lifecycle_look_time.sql,
// each applied twice to PGlite over the smallest schema they touch: a look
// asked for after one already ran in the same minute is queued, and a look
// that has not started yet covers only the requests it runs at or after.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");
const migration = readFileSync(join(migrations, "20261110160000_lifecycle_looks.sql"), "utf8");
const lookTime = readFileSync(join(migrations, "20261110210000_lifecycle_look_time.sql"), "utf8");

const YANGRA = "00000000-0000-4000-8000-000000000001";
const ARCHIVED = "00000000-0000-4000-8000-000000000002";
const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create table public.clients (id uuid primary key, name text, archived_at timestamptz);
create table public.scheduled_jobs (id uuid primary key default gen_random_uuid(), kind text not null, client_id uuid, dedupe_key text unique,
  priority smallint, available_at timestamptz not null default now(), status text not null default 'queued');
-- The function this migration replaces, as 20261019180000_client_lifecycle.sql made it.
create function public.lifecycle_enqueue(p_client uuid, p_priority smallint default 30) returns void language sql security definer set search_path = public as $$
  insert into scheduled_jobs (kind, client_id, dedupe_key, priority, available_at)
  select 'lifecycle', p_client, 'lifecycle:' || p_client || ':' || to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI'), p_priority, now()
   where exists (select 1 from clients where id = p_client and archived_at is null)
  on conflict (dedupe_key) do nothing;
$$;
insert into public.clients values ('${YANGRA}', 'Yangra', null), ('${ARCHIVED}', 'Gone', now());
`;

let db: PGlite;
const looks = async (client = YANGRA) =>
  (await db.query<{ status: string; available_at: string }>("select status, to_char(available_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') as available_at from scheduled_jobs where kind = 'lifecycle' and client_id = $1 order by available_at", [client])).rows;
const ask = (at?: string, client = YANGRA) =>
  at ? db.query("select public.lifecycle_enqueue($1, 30::smallint, $2::timestamptz)", [client, at]) : db.query("select public.lifecycle_enqueue($1)", [client]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(lookTime);
  await db.exec(lookTime);
});
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.exec("delete from scheduled_jobs"); });

describe("lifecycle_enqueue after 20261110210000_lifecycle_look_time.sql", () => {
  it("queues a look after one already ran in the same minute", async () => {
    await ask();
    await db.exec("update scheduled_jobs set status = 'done'");
    await ask();
    expect((await looks()).map((l) => l.status)).toEqual(["done", "queued"]);
  });

  it("asks once while a look that has not started covers the request", async () => {
    await ask();
    await ask();
    await ask(new Date(Date.now() - 60_000).toISOString());
    expect(await looks()).toHaveLength(1);
  });

  it("queues a later look even when an earlier one is waiting", async () => {
    await ask();
    await ask("2099-11-09T14:14:00Z");
    expect((await looks()).map((l) => l.available_at)).toEqual([expect.any(String), "2099-11-09 14:14:00"]);
  });

  // BetterBee, 9 Nov 2026: the content strategy asked to be looked at 06:14:41
  // UTC; a look queued for 06:14:03 counted as covering it, ran 24 seconds
  // before the step was due, and the strategy waited a day.
  it("queues a look when the one waiting runs before the request, even in the same minute", async () => {
    await ask("2099-11-09T06:14:03Z");
    await ask("2099-11-09T06:14:41Z");
    expect((await looks()).map((l) => l.available_at)).toEqual(["2099-11-09 06:14:03", "2099-11-09 06:14:41"]);
  });

  it("asks once when the look waiting runs at the request or less than a minute after it", async () => {
    await ask("2099-11-09T06:14:41Z");
    await ask("2099-11-09T06:14:41Z");
    await ask("2099-11-09T06:14:03Z");
    await ask("2099-11-09T06:13:42Z");
    expect((await looks()).map((l) => l.available_at)).toEqual(["2099-11-09 06:14:41"]);
    await ask("2099-11-09T06:13:41Z");
    expect((await looks()).map((l) => l.available_at)).toEqual(["2099-11-09 06:13:41", "2099-11-09 06:14:41"]);
  });

  it("queues a look now when only a later one is waiting", async () => {
    await ask("2099-11-09T14:14:00Z");
    await ask();
    expect(await looks()).toHaveLength(2);
  });

  it("queues nothing for an archived client, and the triggers' one-argument call still works", async () => {
    await ask(undefined, ARCHIVED);
    expect(await looks(ARCHIVED)).toEqual([]);
    expect(await looks()).toEqual([]);
  });

  it("is the service role's alone", async () => {
    const grants = await db.query<{ grantee: string }>(
      "select grantee from information_schema.routine_privileges where routine_name = 'lifecycle_enqueue' and privilege_type = 'EXECUTE' order by grantee");
    expect(grants.rows.map((g) => g.grantee)).not.toEqual(expect.arrayContaining(["anon", "authenticated"]));
  });
});
