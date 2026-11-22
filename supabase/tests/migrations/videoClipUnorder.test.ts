// @vitest-environment node
// 20261122150300_video_clip_unorder.sql on top of the clip order migration,
// applied twice to PGlite: an order a refused submit left without a job id is
// cleared only while it still has none, the job is active and the order is
// the one that pass placed (QA 22 Nov 2026, P53-02).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const read = (name: string) => readFileSync(join(functionsDir, "..", "migrations", name), "utf8");
const ORDER_SQL = read("20261111130300_video_clip_order.sql");
const UNORDER_SQL = read("20261122150300_video_clip_unorder.sql");

const JOB = "00000000-0000-4000-8000-0000000000a1";
const AT = "2026-11-22T10:00:00.000Z";

const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create table public.canva_finish_jobs (id uuid primary key, status text not null, state jsonb, error text, lease_until timestamptz, updated_at timestamptz);
`;

let db: PGlite;

async function unorder(at: string): Promise<boolean> {
  const { rows } = await db.query<{ v: boolean }>("select public.video_clip_unorder($1::uuid, $2::text) as v", [JOB, at]);
  return rows[0].v;
}
async function clipOrder(): Promise<unknown> {
  const { rows } = await db.query<{ clip_order: unknown }>("select clip_order from public.canva_finish_jobs where id = $1", [JOB]);
  return rows[0].clip_order;
}
async function reset(status: string, order: unknown): Promise<void> {
  await db.query("delete from public.canva_finish_jobs");
  await db.query("insert into public.canva_finish_jobs (id, status, state, clip_order) values ($1, $2, '{}', $3::jsonb)", [JOB, status, order === null ? null : JSON.stringify(order)]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(ORDER_SQL);
  await db.exec(UNORDER_SQL);
  await db.exec(UNORDER_SQL);
}, 30_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => { await reset("running", { price: 128, at: AT }); });

describe("video_clip_unorder", () => {
  it("clears an order with no job id placed at that time", async () => {
    expect(await unorder(AT)).toBe(true);
    expect(await clipOrder()).toBeNull();
  });
  it("never clears an order that has its clip's job id", async () => {
    await reset("running", { price: 128, at: AT, job_id: "hf-1", credits: 128 });
    expect(await unorder(AT)).toBe(false);
    expect(await clipOrder()).toEqual({ price: 128, at: AT, job_id: "hf-1", credits: 128 });
  });
  it("never clears another pass's order", async () => {
    expect(await unorder("2026-11-22T10:05:00.000Z")).toBe(false);
    expect(await clipOrder()).toEqual({ price: 128, at: AT });
  });
  it("leaves a job that is no longer active alone", async () => {
    await reset("failed", { price: 128, at: AT });
    expect(await unorder(AT)).toBe(false);
  });
  it("answers false when there is no order", async () => {
    await reset("running", null);
    expect(await unorder(AT)).toBe(false);
  });
  it("lets the clip be ordered again once cleared", async () => {
    expect(await unorder(AT)).toBe(true);
    const { rows } = await db.query<{ v: boolean }>("select public.video_clip_order($1::uuid, $2::jsonb) as v", [JOB, JSON.stringify({ price: 128, at: "2026-11-22T10:20:00.000Z" })]);
    expect(rows[0].v).toBe(true);
  });
  it("is the service role's only", async () => {
    const { rows } = await db.query<{ anon: boolean; service: boolean }>(
      "select has_function_privilege('anon', 'public.video_clip_unorder(uuid, text)', 'execute') as anon, has_function_privilege('service_role', 'public.video_clip_unorder(uuid, text)', 'execute') as service",
    );
    expect(rows[0]).toEqual({ anon: false, service: true });
  });
});
