// @vitest-environment node
// 20261123150000_api_action_runs.sql, applied twice to PGlite: the
// idempotency keys of the API's public actions (supabase/functions/api/
// actions.ts). The service role claims a key once; a second claim answers the
// record already there (the first answer once it finished); a claim left
// running past 15 minutes, or any key older than a day, is claimed again.
// Nobody else reads or writes the table: it has no policy that lets anyone
// in, only the three that keep an OAuth session from writing, which every
// table carries (supabase/tests/mcp/schema-guards.test.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migration = readFileSync(join(functionsDir, "..", "migrations", "20261123150000_api_action_runs.sql"), "utf8");
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

async function as<T>(role: "anon" | "authenticated" | "service_role", sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`set role ${role}`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}

type Claim = { claimed: boolean; status: string; request_hash: string; response_status: number | null; response: unknown };
const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const claim = async (key: string, hash = "h1", owner = "key:k1", action = "start_social_report") =>
  (await as<Claim>("service_role", "select * from public.api_action_claim($1, $2, $3, $4, $5)", [owner, action, key, hash, CLIENT]))[0];
const age = (key: string, seconds: number) => db.query("update public.api_action_runs set created_at = now() - make_interval(secs => $2) where idempotency_key = $1", [key, seconds]);

describe("api action runs", () => {
  it("claims a new key once, and answers the record already there to the second claim", async () => {
    expect(await claim("a")).toEqual({ claimed: true, status: "running", request_hash: "h1", response_status: null, response: null });
    expect(await claim("a", "h2")).toEqual({ claimed: false, status: "running", request_hash: "h1", response_status: null, response: null });
  });

  it("answers the first answer once the request finished", async () => {
    await claim("b");
    await db.query("update public.api_action_runs set status = 'done', response_status = 202, response = $2 where idempotency_key = $1", ["b", JSON.stringify({ data: { report_id: "r1" } })]);
    expect(await claim("b")).toEqual({ claimed: false, status: "done", request_hash: "h1", response_status: 202, response: { data: { report_id: "r1" } } });
  });

  it("keeps keys apart per caller and per action", async () => {
    await claim("c");
    expect((await claim("c", "h1", "key:k2")).claimed).toBe(true);
    expect((await claim("c", "h1", "key:k1", "draft_post")).claimed).toBe(true);
  });

  it("frees a claim left running for 15 minutes, and any key after a day", async () => {
    await claim("d");
    await age("d", 14 * 60);
    expect((await claim("d")).claimed).toBe(false);
    await age("d", 16 * 60);
    expect((await claim("d")).claimed).toBe(true);
    await db.query("update public.api_action_runs set status = 'done', response_status = 200 where idempotency_key = 'd'");
    await age("d", 23 * 3600);
    expect((await claim("d")).claimed).toBe(false);
    await age("d", 25 * 3600);
    expect((await claim("d")).claimed).toBe(true);
  });

  it("lets nobody but the service role claim", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      await expect(as(role, "select * from public.api_action_claim('o', 'a', 'k', 'h', null)")).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("keeps the table closed: row level security on, only the three OAuth guards, no grant to the app's roles", async () => {
    const { rows: table } = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid = 'public.api_action_runs'::regclass");
    expect(table).toEqual([{ relrowsecurity: true }]);
    const { rows: policies } = await db.query<{ policyname: string; permissive: string }>("select policyname, permissive from pg_policies where schemaname = 'public' and tablename = 'api_action_runs' order by policyname");
    expect(policies).toEqual([
      { policyname: "OAuth sessions cannot delete", permissive: "RESTRICTIVE" },
      { policyname: "OAuth sessions cannot insert", permissive: "RESTRICTIVE" },
      { policyname: "OAuth sessions cannot update", permissive: "RESTRICTIVE" },
    ]);
    for (const role of ["anon", "authenticated"] as const) {
      await expect(as(role, "select id from public.api_action_runs")).rejects.toMatchObject({ code: "42501" });
      await expect(as(role, "delete from public.api_action_runs")).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("runs the claim as its owner with an empty search path", async () => {
    const { rows } = await db.query<{ prosecdef: boolean; proconfig: string[] | null }>("select prosecdef, proconfig from pg_proc where pronamespace = 'public'::regnamespace and proname = 'api_action_claim'");
    expect(rows).toEqual([{ prosecdef: true, proconfig: ['search_path=""'] }]);
  });
});
