// @vitest-environment node
// 20261113103000_scheduled_jobs_lease_attempt_cap.sql, applied to PGlite on a
// scheduled_jobs table: a job whose worker keeps dying is leased at most
// max_attempts + 1 times (the last lease is the one in which a kind reports a
// clean failure), then closed: a dispatch is blocked, any other kind failed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migration = readFileSync(join(functionsDir, "..", "migrations", "20261113103000_scheduled_jobs_lease_attempt_cap.sql"), "utf8");

const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create table public.scheduled_jobs (
  id uuid primary key default gen_random_uuid(), kind text not null, status text not null default 'queued',
  priority smallint not null default 50, attempts integer not null default 0, max_attempts integer not null default 3,
  available_at timestamptz not null default now(), lease_until timestamptz, reason text,
  created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz, updated_at timestamptz not null default now());
`;

let db: PGlite;
beforeAll(async () => { db = new PGlite(); await db.exec(SETUP); await db.exec(migration); await db.exec(migration); });
afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.exec("delete from public.scheduled_jobs"); });

const add = async (kind: string, status: string, attempts: number, max = 3): Promise<string> => {
  const lease = status === "running" ? "now() - interval '1 minute'" : "null";
  const { rows } = await db.query<{ id: string }>(`insert into public.scheduled_jobs (kind, status, attempts, max_attempts, lease_until) values ($1, $2, $3, $4, ${lease}) returning id`, [kind, status, attempts, max]);
  return rows[0].id;
};
const job = async (id: string) => (await db.query<{ status: string; attempts: number; reason: string | null; lease_until: string | null; finished_at: string | null }>("select status, attempts, reason, lease_until, finished_at from public.scheduled_jobs where id = $1", [id])).rows[0];
const lease = async (fn = "scheduled_jobs_lease") => (await db.query<{ id: string; attempts: number }>(`select id, attempts from public.${fn}(300)`)).rows;
/** A worker that dies on every try: its lease runs out at once. */
const die = (id: string) => db.query("update public.scheduled_jobs set lease_until = now() - interval '1 second' where id = $1", [id]);

describe("scheduled_jobs_lease attempt cap", () => {
  it.each(["week_plan", "lifecycle_step", "voice_profile", "feed_refresh"])("%s: a job that kills its worker every time is leased max_attempts + 1 times, then failed", async (kind) => {
    const id = await add(kind, "queued", 0);
    let leases = 0;
    for (let i = 0; i < 20; i++) {
      const got = await lease();
      if (!got.length) break;
      leases++;
      await die(id);
    }
    expect(leases).toBe(4);
    const after = await job(id);
    expect(after.status).toBe("failed");
    expect(after.reason).toMatch(/Tried 4 times without finishing/);
    expect(after.lease_until).toBeNull();
    expect(after.finished_at).not.toBeNull();
  });

  it("blocks a dispatch instead of failing it, and starts its count again", async () => {
    const id = await add("dispatch", "running", 4);
    expect(await lease()).toEqual([]);
    const after = await job(id);
    expect(after.status).toBe("blocked");
    expect(after.attempts).toBe(0);
    expect(after.finished_at).toBeNull();
  });

  it("closes a job the sweep put back in the queue after its last try", async () => {
    const id = await add("week_plan", "queued", 4);
    expect(await lease()).toEqual([]);
    expect((await job(id)).status).toBe("failed");
  });

  it("still leases a queued job and an expired one with tries left", async () => {
    const a = await add("week_plan", "queued", 0);
    const b = await add("week_plan", "running", 3);
    const got = (await lease()).concat(await lease());
    expect(got.map((r) => r.id).sort()).toEqual([a, b].sort());
    expect(got.find((r) => r.id === b)!.attempts).toBe(4);
  });

  it("applies the same cap to the pipeline lane", async () => {
    const id = await add("report_pipeline", "queued", 0, 5);
    let leases = 0;
    for (let i = 0; i < 20; i++) {
      const got = await lease("scheduled_jobs_lease_pipelines");
      if (!got.length) break;
      leases++;
      await die(id);
    }
    expect(leases).toBe(6);
    expect((await job(id)).status).toBe("failed");
  });

  it("leaves a job a worker holds alone", async () => {
    const id = await add("week_plan", "running", 4);
    await db.query("update public.scheduled_jobs set lease_until = now() + interval '5 minutes' where id = $1", [id]);
    expect(await lease()).toEqual([]);
    expect((await job(id)).status).toBe("running");
  });
});
