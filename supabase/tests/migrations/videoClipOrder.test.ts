// @vitest-environment node
// 20261111130300_video_clip_order.sql, applied twice to PGlite: a video's
// clip order lives in its own column, is placed once, gets its job id once,
// and a job holding a live order is never failed by another pass.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migration = readFileSync(join(functionsDir, "..", "migrations", "20261111130300_video_clip_order.sql"), "utf8");

const JOB = "00000000-0000-4000-8000-0000000000a1";

const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create table public.canva_finish_jobs (id uuid primary key, status text not null, state jsonb, error text, lease_until timestamptz, updated_at timestamptz);
`;

let db: PGlite;
const ORDER = { price: 128, at: new Date().toISOString() };

async function call(fn: string, ...args: unknown[]): Promise<boolean> {
  const casts = { video_clip_order: ["uuid", "jsonb"], video_clip_ordered: ["uuid", "text", "numeric"], video_clip_stop: ["uuid", "text"] }[fn]!;
  const { rows } = await db.query<{ v: boolean }>(`select public.${fn}(${casts.map((c, i) => `$${i + 1}::${c}`).join(", ")}) as v`, args.map((a) => (a !== null && typeof a === "object" ? JSON.stringify(a) : a)));
  return rows[0].v;
}
async function row(): Promise<any> {
  const { rows } = await db.query("select status, state, error, lease_until, clip_order from public.canva_finish_jobs where id = $1", [JOB]);
  return rows[0];
}
async function reset(status = "running", clipOrder: unknown = undefined): Promise<void> {
  await db.query("delete from public.canva_finish_jobs");
  await db.query("insert into public.canva_finish_jobs (id, status, state, lease_until) values ($1, $2, '{\"frame_path\": \"f.jpg\"}', now())", [JOB, status]);
  if (clipOrder !== undefined) await db.query("update public.canva_finish_jobs set clip_order = $2::jsonb where id = $1", [JOB, JSON.stringify(clipOrder)]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(migration);
  await db.exec(migration);
}, 30_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => { await reset(); });

describe("video_clip_order", () => {
  it("places the order once, in its own column, leaving the state alone", async () => {
    expect(await call("video_clip_order", JOB, ORDER)).toBe(true);
    expect(await call("video_clip_order", JOB, { price: 99, at: ORDER.at })).toBe(false);
    const r = await row();
    expect(r.clip_order).toEqual(ORDER);
    expect(r.state).toEqual({ frame_path: "f.jpg" });
  });
  it("places none on a job that is no longer active", async () => {
    await reset("canceled");
    expect(await call("video_clip_order", JOB, ORDER)).toBe(false);
    expect((await row()).clip_order).toBeNull();
  });
  it("takes JSON null in the column as no order", async () => {
    await reset("running", null);
    await db.query("update public.canva_finish_jobs set clip_order = 'null'::jsonb where id = $1", [JOB]);
    expect(await call("video_clip_order", JOB, ORDER)).toBe(true);
  });
});

describe("video_clip_ordered", () => {
  it("adds the job id and credits once, to a placed order only", async () => {
    expect(await call("video_clip_ordered", JOB, "hf-1", 128)).toBe(false);
    await call("video_clip_order", JOB, ORDER);
    expect(await call("video_clip_ordered", JOB, "hf-1", 128)).toBe(true);
    expect(await call("video_clip_ordered", JOB, "hf-2", 128)).toBe(false);
    expect((await row()).clip_order).toEqual({ ...ORDER, job_id: "hf-1", credits: 128 });
  });
  it("records a bought clip even on a job stopped meanwhile", async () => {
    await call("video_clip_order", JOB, ORDER);
    await db.query("update public.canva_finish_jobs set status = 'canceled' where id = $1", [JOB]);
    expect(await call("video_clip_ordered", JOB, "hf-1", null)).toBe(true);
    expect((await row()).clip_order).toEqual({ ...ORDER, job_id: "hf-1", credits: null });
  });
});

describe("video_clip_stop", () => {
  it("fails an active job that holds no order", async () => {
    expect(await call("video_clip_stop", JOB, "The video's price went up.")).toBe(true);
    expect(await row()).toMatchObject({ status: "failed", error: "The video's price went up.", lease_until: null });
    expect(await call("video_clip_stop", JOB, "again")).toBe(false);
  });
  it("is refused once an order is placed, with or without its job id", async () => {
    await call("video_clip_order", JOB, ORDER);
    expect(await call("video_clip_stop", JOB, "price")).toBe(false);
    await call("video_clip_ordered", JOB, "hf-1", 128);
    expect(await call("video_clip_stop", JOB, "price")).toBe(false);
    expect((await row()).status).toBe("running");
  });
  it("ends a lost order: no job id, placed more than ten minutes ago", async () => {
    await reset("running", { price: 128, at: new Date(Date.now() - 11 * 60_000).toISOString() });
    expect(await call("video_clip_stop", JOB, "lost")).toBe(true);
    await reset("running", { price: 128, at: new Date(Date.now() - 11 * 60_000).toISOString(), job_id: "hf-1" });
    expect(await call("video_clip_stop", JOB, "lost")).toBe(false);
    await reset("running", { price: 128, at: new Date(Date.now() - 60_000).toISOString() });
    expect(await call("video_clip_stop", JOB, "lost")).toBe(false);
  });
  it("takes JSON null in the column as no order", async () => {
    await reset("running", null);
    await db.query("update public.canva_finish_jobs set clip_order = 'null'::jsonb where id = $1", [JOB]);
    expect(await call("video_clip_stop", JOB, "price")).toBe(true);
  });
  it("leaves a job that is no longer active", async () => {
    await reset("done");
    expect(await call("video_clip_stop", JOB, "price")).toBe(false);
  });
});

describe("grants", () => {
  it("are for the service role only", async () => {
    for (const sig of ["video_clip_order(uuid, jsonb)", "video_clip_ordered(uuid, text, numeric)", "video_clip_stop(uuid, text)"]) {
      const { rows } = await db.query<{ a: boolean; s: boolean }>(`select has_function_privilege('authenticated', 'public.${sig}', 'execute') as a, has_function_privilege('service_role', 'public.${sig}', 'execute') as s`);
      expect(rows[0]).toEqual({ a: false, s: true });
    }
  });
});
