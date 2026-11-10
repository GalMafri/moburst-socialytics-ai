// @vitest-environment node
// 20261111130300_video_clip_order.sql, applied twice to PGlite: a video's
// clip order is recorded on its job once, and only while the job is active.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migration = readFileSync(join(functionsDir, "..", "migrations", "20261111130300_video_clip_order.sql"), "utf8");

const JOB = "00000000-0000-4000-8000-0000000000a1";
const STOPPED = "00000000-0000-4000-8000-0000000000a2";
const EMPTY = "00000000-0000-4000-8000-0000000000a3";

const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create table public.canva_finish_jobs (id uuid primary key, status text not null, state jsonb, updated_at timestamptz);
insert into public.canva_finish_jobs values
  ('${JOB}', 'running', '{"frame_path": "c/frame-1.jpg"}', null),
  ('${STOPPED}', 'canceled', '{}', null),
  ('${EMPTY}', 'queued', null, null);
`;

let db: PGlite;
async function order(id: string, o: unknown): Promise<boolean> {
  const { rows } = await db.query<{ v: boolean }>("select public.video_clip_order($1, $2::jsonb) as v", [id, JSON.stringify(o)]);
  return rows[0].v;
}
async function state(id: string): Promise<any> {
  const { rows } = await db.query<{ v: any; u: string | null }>("select state as v, updated_at as u from public.canva_finish_jobs where id = $1", [id]);
  return rows[0];
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(migration);
  await db.exec(migration);
}, 30_000);
afterAll(async () => { await db.close(); });

describe("video_clip_order", () => {
  it("records the order once, keeping the job's other state", async () => {
    expect(await order(JOB, { price: 128, at: "2026-11-11T10:00:00Z" })).toBe(true);
    expect(await order(JOB, { price: 99, at: "2026-11-11T10:01:00Z" })).toBe(false);
    const row = await state(JOB);
    expect(row.v).toEqual({ frame_path: "c/frame-1.jpg", clip_order: { price: 128, at: "2026-11-11T10:00:00Z" } });
    expect(row.u).not.toBeNull();
  });

  it("records nothing on a job that is no longer active", async () => {
    expect(await order(STOPPED, { price: 128, at: "x" })).toBe(false);
    expect((await state(STOPPED)).v).toEqual({});
  });

  it("starts a job's state that was empty", async () => {
    expect(await order(EMPTY, { price: 128, at: "x" })).toBe(true);
    expect((await state(EMPTY)).v).toEqual({ clip_order: { price: 128, at: "x" } });
  });

  it("is for the service role only", async () => {
    const { rows } = await db.query<{ a: boolean; s: boolean }>(
      "select has_function_privilege('authenticated', 'public.video_clip_order(uuid, jsonb)', 'execute') as a, has_function_privilege('service_role', 'public.video_clip_order(uuid, jsonb)', 'execute') as s",
    );
    expect(rows[0]).toEqual({ a: false, s: true });
  });
});
