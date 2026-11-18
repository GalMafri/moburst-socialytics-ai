// @vitest-environment node
// "Sync from Sprout" on the server: sprout-profiles' sync_now and sync_status
// actions, run against PGlite with the real enqueue_sprout_onboarding_now
// (20261118130000_sprout_sync_now.sql). Staff start a run and a client's
// user does not; a run under way is used, never doubled; a new run is one
// queued sprout_onboarding job with the on-demand key; and the answer says
// in a few words what the newest finished run added. No Sprout call is made.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { functionsDir } from "../paths.ts";

const migration = readFileSync(join(functionsDir, "..", "migrations", "20261118130000_sprout_sync_now.sql"), "utf8");
const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create table public.clients (id uuid primary key default gen_random_uuid(), name text not null);
create table public.sprout_brand_declines (id uuid primary key default gen_random_uuid(), sprout_group_id text, profile_ids bigint[], brand text, declined_at timestamptz, note text);
create table public.scheduled_jobs (
  id uuid primary key default gen_random_uuid(), kind text not null, client_id uuid, payload jsonb, dedupe_key text not null unique,
  priority smallint not null default 50, status text not null default 'queued', attempts integer not null default 0,
  available_at timestamptz not null default now(), result jsonb, created_at timestamptz not null default now(), finished_at timestamptz);
`;

const st = vi.hoisted(() => ({
  caller: "staff" as "staff" | "client" | "nobody",
  handler: null as null | ((req: Request) => Promise<Response>),
  sproutCalls: 0,
  rpcs: [] as Array<{ name: string; args: unknown }>,
  db: null as unknown,
}));

vi.mock("https://deno.land/std@0.168.0/http/server.ts", () => ({ serve: (h: (req: Request) => Promise<Response>) => { st.handler = h; } }));
// The gate answers as requireStaff does: nothing for staff, a 403 for a signed-in client user, a 401 with no session.
vi.mock("../../functions/_shared/auth/requireStaff.ts", async () => {
  const { AuthzError, authzResponse } = await import("../../functions/_shared/auth/authz");
  return {
    staffGate: async (_req: Request, cors: Record<string, string>) => {
      if (st.caller === "staff") return null;
      return authzResponse(st.caller === "client" ? new AuthzError(403, "Moburst staff only.") : new AuthzError(401, "Sign-in required."), cors);
    },
  };
});
vi.mock("../../functions/_shared/supabase.ts", () => ({ createClient: () => st.db }));
vi.mock("../../functions/_shared/sprout/profiles.ts", () => ({
  SproutListError: class extends Error { status = 502; },
  listCustomerProfiles: async () => { st.sproutCalls++; return [{ id: "41", name: "Fixture Bakery", native_name: "fixturebakery", network_type: "facebook", native_link: "https://example.test/fixturebakery", status: "active", groups: [] }]; },
  listCustomerGroups: async () => { st.sproutCalls++; return []; },
}));

let pg: PGlite;

/** The few supabase-js calls the actions make, answered by PGlite: from().select().eq().in().order().limit() and rpc(). */
function dbOver(pglite: PGlite) {
  const column = (c: string) => {
    const [alias, path] = c.includes(":") ? c.split(":") : [null, c];
    const [col, key] = path.split("->");
    return key ? `${col}->'${key}' as ${alias ?? key}` : col;
  };
  return {
    from(table: string) {
      const where: string[] = [];
      const params: unknown[] = [];
      let columns = "*";
      let tail = "";
      const q = {
        select(cols: string) { columns = cols.split(",").map((c) => column(c.trim())).join(", "); return q; },
        eq(c: string, v: unknown) { params.push(v); where.push(`${c} = $${params.length}`); return q; },
        in(c: string, vs: unknown[]) { params.push(vs.map(String)); where.push(`${c}::text = any($${params.length}::text[])`); return q; },
        order(c: string, o?: { ascending?: boolean }) { tail += ` order by ${c} ${o?.ascending === false ? "desc" : "asc"}`; return q; },
        limit(n: number) { tail += ` limit ${Number(n)}`; return q; },
        then<T>(done: (r: { data: unknown; error: { message: string } | null }) => T) {
          return pglite.query(`select ${columns} from public.${table}${where.length ? ` where ${where.join(" and ")}` : ""}${tail}`, params)
            .then((r) => done({ data: r.rows, error: null }), (e: Error) => done({ data: null, error: { message: e.message } }));
        },
      };
      return q;
    },
    async rpc(name: string, args?: unknown) {
      st.rpcs.push({ name, args });
      const { rows } = await pglite.query<{ a: unknown }>(`select public.${name}() as a`);
      return { data: rows[0].a, error: null };
    },
  };
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(SETUP);
  await pg.exec(migration);
  st.db = dbOver(pg);
  vi.stubGlobal("Deno", { env: { get: () => "x" } });
  await import("../../functions/sprout-profiles/index.ts");
}, 60_000);
afterAll(async () => { vi.unstubAllGlobals(); await pg.close(); });
beforeEach(async () => { st.caller = "staff"; st.sproutCalls = 0; st.rpcs = []; await pg.exec("delete from public.scheduled_jobs; delete from public.clients"); });
afterEach(() => vi.restoreAllMocks());

const call = async (body: Record<string, unknown>) => {
  const res = await st.handler!(new Request("https://f.test/sprout-profiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};
type Job = { id: string; kind: string; dedupe_key: string; status: string; client_id: string | null; priority: number };
const jobs = async () => (await pg.query<Job>("select id, kind, dedupe_key, status, client_id, priority from public.scheduled_jobs order by created_at, dedupe_key")).rows;
const client = async (name: string) => (await pg.query<{ id: string }>("insert into public.clients (name) values ($1) returning id", [name])).rows[0].id;
/** A sprout_onboarding job as the worker leaves it. */
const job = async (o: { key: string; status: string; created: string; finished?: string; attempts?: number; made?: string[] }) =>
  (await pg.query<{ id: string }>(
    "insert into public.scheduled_jobs (kind, dedupe_key, status, attempts, created_at, finished_at, result) values ('sprout_onboarding', $1, $2, $3, $4::timestamptz, $5::timestamptz, $6::jsonb) returning id",
    [o.key, o.status, o.attempts ?? 1, o.created, o.finished ?? null, o.made ? JSON.stringify({ created: o.made, results: [{ brand: "not read by the status" }] }) : null],
  )).rows[0].id;

describe("sync_now", () => {
  it("queues one sprout_onboarding job for a staff member, with the on-demand key, and calls Sprout for nothing", async () => {
    const r = await call({ action: "sync_now" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ started: true, sync: { open: true, slow: false, last: null } });
    const all = await jobs();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: "sprout_onboarding", status: "queued", client_id: null, priority: 15 });
    expect(all[0].dedupe_key).toMatch(/^sprout_onboarding:now:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z:[0-9a-f]{12}$/);
    expect(st.rpcs).toEqual([{ name: "enqueue_sprout_onboarding_now", args: undefined }]);
    expect(st.sproutCalls).toBe(0);
  });

  it("refuses a client's user and a caller with no session, and queues nothing", async () => {
    st.caller = "client";
    const asClient = await call({ action: "sync_now" });
    expect(asClient.status).toBe(403);
    expect(asClient.body).toEqual({ error: "Moburst staff only." });
    st.caller = "nobody";
    expect((await call({ action: "sync_now" })).status).toBe(401);
    expect((await call({ action: "sync_status" })).status).toBe(401);
    expect(await jobs()).toEqual([]);
    expect(st.rpcs).toEqual([]);
  });

  it("uses the run already under way instead of starting another, however often it is pressed", async () => {
    await call({ action: "sync_now" });
    const again = await Promise.all([call({ action: "sync_now" }), call({ action: "sync_now" }), call({ action: "sync_now" })]);
    for (const r of again) expect(r.body).toEqual({ started: false, sync: { open: true, slow: false, last: null } });
    expect(await jobs()).toHaveLength(1);
  });

  it("does not start a run beside the weekly one or beside the rest of a run", async () => {
    const weekly = await job({ key: "sprout_onboarding:2026-11-16", status: "running", created: "2026-11-16T06:00:00Z" });
    expect((await call({ action: "sync_now" })).body).toMatchObject({ started: false, sync: { open: true } });
    await pg.query("update public.scheduled_jobs set status = 'done', finished_at = '2026-11-16T06:02:00Z' where id = $1", [weekly]);
    await job({ key: `sprout_onboarding:rest:${weekly}`, status: "queued", created: "2026-11-16T06:02:00Z", attempts: 0 });
    expect((await call({ action: "sync_now" })).body).toMatchObject({ started: false, sync: { open: true } });
    expect(await jobs()).toHaveLength(2);
  });

  it("starts a new run once the one before it is over", async () => {
    await job({ key: "sprout_onboarding:2026-11-16", status: "done", created: "2026-11-16T06:00:00Z", finished: "2026-11-16T06:02:00Z", made: [] });
    expect((await call({ action: "sync_now" })).body).toMatchObject({ started: true, sync: { open: true, last: null } });
    expect((await jobs()).filter((j) => j.status === "queued")).toHaveLength(1);
  });
});

describe("sync_status", () => {
  it("says nothing is under way when there has never been a run", async () => {
    expect((await call({ action: "sync_status" })).body).toEqual({ sync: { open: false, slow: false, last: null } });
    expect(st.rpcs).toEqual([]);
    expect(st.sproutCalls).toBe(0);
  });

  it("names the clients the newest finished run added, across the jobs of that run", async () => {
    const [north, harbor, older] = [await client("Northwind Fixture"), await client("Harbor Fixture"), await client("Older Fixture")];
    await job({ key: "sprout_onboarding:2026-11-09", status: "done", created: "2026-11-09T06:00:00Z", finished: "2026-11-09T06:02:00Z", made: [older] });
    const first = await job({ key: "sprout_onboarding:now:2026-11-13T10:00:00Z:aaaaaaaaaaaa", status: "done", created: "2026-11-13T10:00:00Z", finished: "2026-11-13T10:02:00Z", made: [north] });
    await job({ key: `sprout_onboarding:rest:${first}`, status: "done", created: "2026-11-13T10:02:00Z", finished: "2026-11-13T10:04:00Z", made: [harbor] });
    const r = await call({ action: "sync_status" });
    expect(r.body).toEqual({ sync: { open: false, slow: false, last: {
      finished: true, finished_at: expect.stringMatching(/^2026-11-13T10:04:00/),
      added: [{ id: harbor, name: "Harbor Fixture" }, { id: north, name: "Northwind Fixture" }],
    } } });
    // Only the ids of the clients made are read from a job's result, never the list of every brand.
    expect(JSON.stringify(r.body)).not.toContain("not read by the status");
  });

  it("says a finished run added nobody, and leaves out a client deleted since", async () => {
    await job({ key: "sprout_onboarding:now:2026-11-13T10:00:00Z:bbbbbbbbbbbb", status: "done", created: "2026-11-13T10:00:00Z", finished: "2026-11-13T10:02:00Z", made: ["00000000-0000-4000-8000-000000000001"] });
    expect((await call({ action: "sync_status" })).body).toMatchObject({ sync: { open: false, last: { finished: true, added: [] } } });
  });

  it("says a run did not finish, with what it added before it stopped", async () => {
    const north = await client("Northwind Fixture");
    const first = await job({ key: "sprout_onboarding:now:2026-11-13T10:00:00Z:cccccccccccc", status: "done", created: "2026-11-13T10:00:00Z", finished: "2026-11-13T10:02:00Z", made: [north] });
    await job({ key: `sprout_onboarding:rest:${first}`, status: "failed", created: "2026-11-13T10:02:00Z", finished: "2026-11-13T10:40:00Z", attempts: 3 });
    const r = await call({ action: "sync_status" });
    expect(r.body).toMatchObject({ sync: { open: false, last: { finished: false, added: [{ id: north, name: "Northwind Fixture" }] } } });
    // Why it stopped stays in the queue for the team: the answer has no reason in it.
    expect(Object.keys((r.body.sync as { last: object }).last).sort()).toEqual(["added", "finished", "finished_at"]);
  });

  it("says a run under way is on another try while it waits for one or runs one", async () => {
    const id = await job({ key: "sprout_onboarding:now:2026-11-13T10:00:00Z:dddddddddddd", status: "running", created: "2026-11-13T10:00:00Z", attempts: 1 });
    expect((await call({ action: "sync_status" })).body).toEqual({ sync: { open: true, slow: false, last: null } });
    await pg.query("update public.scheduled_jobs set status = 'queued' where id = $1", [id]);
    expect((await call({ action: "sync_status" })).body).toEqual({ sync: { open: true, slow: true, last: null } });
    await pg.query("update public.scheduled_jobs set status = 'running', attempts = 2 where id = $1", [id]);
    expect((await call({ action: "sync_status" })).body).toEqual({ sync: { open: true, slow: true, last: null } });
  });
});

describe("the profile list", () => {
  it("is answered as before when no action is named", async () => {
    const r = await call({});
    expect(r.status).toBe(200);
    expect(r.body.total_profiles).toBe(1);
    expect(st.sproutCalls).toBe(2);
    expect(st.rpcs).toEqual([]);
    expect(await jobs()).toEqual([]);
  });
});
