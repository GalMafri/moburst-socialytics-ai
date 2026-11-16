// @vitest-environment node
// 20261116100000_picture_calls.sql, applied twice to PGlite: how the picture
// service knows a call is ours without a shared secret. A worker opens a call
// (service role only), the service claims it once with the public anon key,
// and a call that is unknown, already claimed or older than 120 seconds is
// not claimed. Nobody reads or writes the table itself: it has no policy that
// lets anyone in, only the three that keep an OAuth session from writing,
// which every table carries (supabase/tests/mcp/schema-guards.test.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migration = readFileSync(join(functionsDir, "..", "migrations", "20261116100000_picture_calls.sql"), "utf8");
// The roles a Supabase project has; in PGlite the test runs as the superuser and takes each role in turn.
const SETUP = `
create role anon;
create role authenticated;
create role service_role;
grant usage on schema public to anon, authenticated, service_role;
create function public.is_oauth_session() returns boolean language sql stable as 'select false';
`;

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(migration);
  await db.exec(migration);
});
afterAll(async () => { await db.close(); });

/** Runs one statement as a role, then returns to the superuser whatever happened. */
async function as<T>(role: "anon" | "authenticated" | "service_role", sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`set role ${role}`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}
const open = async () => (await as<{ id: string }>("service_role", "select public.open_picture_call() as id"))[0].id;
const claim = async (id: string) => (await as<{ ok: boolean }>("anon", "select public.claim_picture_call($1) as ok", [id]))[0].ok;
const age = (id: string, seconds: number) => db.query("update public.picture_calls set opened_at = now() - make_interval(secs => $2) where id = $1", [id, seconds]);
const UNKNOWN = "00000000-0000-4000-8000-0000000000aa";

describe("picture calls", () => {
  it("opens a call for the service role and gives its id", async () => {
    const id = await open();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const { rows } = await db.query<{ claimed_at: string | null }>("select claimed_at from public.picture_calls where id = $1", [id]);
    expect(rows).toEqual([{ claimed_at: null }]);
  });

  it("lets nobody but the service role open a call", async () => {
    await expect(as("anon", "select public.open_picture_call()")).rejects.toMatchObject({ code: "42501" });
    await expect(as("authenticated", "select public.open_picture_call()")).rejects.toMatchObject({ code: "42501" });
  });

  it("claims an open call once: the second claim of the same id is refused", async () => {
    const id = await open();
    expect(await claim(id)).toBe(true);
    expect(await claim(id)).toBe(false);
    const { rows } = await db.query<{ claimed: boolean }>("select claimed_at is not null as claimed from public.picture_calls where id = $1", [id]);
    expect(rows).toEqual([{ claimed: true }]);
  });

  it("does not claim an id that was never opened", async () => {
    expect(await claim(UNKNOWN)).toBe(false);
  });

  it("claims a call opened less than 120 seconds ago and refuses an older one", async () => {
    const fresh = await open();
    await age(fresh, 110);
    expect(await claim(fresh)).toBe(true);
    const late = await open();
    await age(late, 121);
    expect(await claim(late)).toBe(false);
  });

  it("does not let a signed-in user claim a call", async () => {
    const id = await open();
    await expect(as("authenticated", "select public.claim_picture_call($1)", [id])).rejects.toMatchObject({ code: "42501" });
  });

  it("keeps the table closed: row level security on, no policy that lets anyone in, no grant to the app's roles", async () => {
    const { rows: table } = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid = 'public.picture_calls'::regclass");
    expect(table).toEqual([{ relrowsecurity: true }]);
    const { rows: policies } = await db.query<{ policyname: string; permissive: string }>("select policyname, permissive from pg_policies where schemaname = 'public' and tablename = 'picture_calls' order by policyname");
    // Restrictive policies only narrow what a permissive one allows, and there is none.
    expect(policies).toEqual([
      { policyname: "OAuth sessions cannot delete", permissive: "RESTRICTIVE" },
      { policyname: "OAuth sessions cannot insert", permissive: "RESTRICTIVE" },
      { policyname: "OAuth sessions cannot update", permissive: "RESTRICTIVE" },
    ]);
    for (const role of ["anon", "authenticated"] as const) {
      await expect(as(role, "select id from public.picture_calls")).rejects.toMatchObject({ code: "42501" });
      await expect(as(role, "insert into public.picture_calls default values")).rejects.toMatchObject({ code: "42501" });
      await expect(as(role, "update public.picture_calls set claimed_at = null")).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("clears calls older than a day whenever a call is opened, and keeps the rest", async () => {
    const old = await open();
    const recent = await open();
    await age(old, 86_400 + 60);
    await age(recent, 3_600);
    const next = await open();
    const { rows } = await db.query<{ id: string }>("select id from public.picture_calls where id = any($1::uuid[])", [[old, recent, next]]);
    expect(rows.map((r) => r.id).sort()).toEqual([recent, next].sort());
  });

  it("runs both functions as their owner with an empty search path", async () => {
    const { rows } = await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
      "select proname, prosecdef, proconfig from pg_proc where pronamespace = 'public'::regnamespace and proname in ('open_picture_call', 'claim_picture_call') order by proname",
    );
    expect(rows).toEqual([
      { proname: "claim_picture_call", prosecdef: true, proconfig: ['search_path=""'] },
      { proname: "open_picture_call", prosecdef: true, proconfig: ['search_path=""'] },
    ]);
  });
});
