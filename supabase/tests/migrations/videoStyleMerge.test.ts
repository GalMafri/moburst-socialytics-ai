// @vitest-environment node
// 20261111130200_video_style_merge.sql, applied twice to PGlite: the video
// worker's writes to clients.video_style are each one statement, and only one
// job at a time claims the making of a client's kit.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migration = readFileSync(join(functionsDir, "..", "migrations", "20261111130200_video_style_merge.sql"), "utf8");

const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const EMPTY = "00000000-0000-4000-8000-0000000000c2";
const JOB_A = "00000000-0000-4000-8000-0000000000b1";
const JOB_B = "00000000-0000-4000-8000-0000000000b2";

const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create table public.clients (id uuid primary key, video_style jsonb);
insert into public.clients values ('${CLIENT}', '{"profile": {"logo": "none"}, "frames": ["a", "b"]}'), ('${EMPTY}', null);
`;

let db: PGlite;
async function style(id: string): Promise<any> {
  const { rows } = await db.query<{ v: any }>("select video_style as v from public.clients where id = $1", [id]);
  return rows[0].v;
}
async function claim(id: string, job: string, stale = "15 minutes"): Promise<boolean> {
  const { rows } = await db.query<{ v: boolean }>("select public.video_style_claim_kit($1, $2, $3::interval) as v", [id, job, stale]);
  return rows[0].v;
}
async function merge(id: string, patch: unknown): Promise<void> {
  await db.query("select public.video_style_merge($1, $2::jsonb)", [id, JSON.stringify(patch)]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(migration);
  await db.exec(migration);
}, 30_000);
afterAll(async () => { await db.close(); });

describe("video_style_merge", () => {
  it("sets the patch's keys and keeps the others", async () => {
    await merge(CLIENT, { made_at: "2026-11-11" });
    expect(await style(CLIENT)).toEqual({ profile: { logo: "none" }, frames: ["a", "b"], made_at: "2026-11-11" });
  });

  it("keeps a null key as null", async () => {
    await merge(CLIENT, { kit: null });
    expect((await style(CLIENT)).kit).toBeNull();
    expect((await style(CLIENT)).frames).toEqual(["a", "b"]);
  });

  it("starts a style that was empty", async () => {
    await merge(EMPTY, { kit: [] });
    expect(await style(EMPTY)).toEqual({ kit: [] });
  });

  it("is for the service role only", async () => {
    const { rows } = await db.query<{ a: boolean; s: boolean }>(
      "select has_function_privilege('authenticated', 'public.video_style_merge(uuid, jsonb)', 'execute') as a, has_function_privilege('service_role', 'public.video_style_merge(uuid, jsonb)', 'execute') as s",
    );
    expect(rows[0]).toEqual({ a: false, s: true });
  });
});

describe("video_style_claim_kit", () => {
  it("is won once, and keeps the style's other keys", async () => {
    expect(await claim(CLIENT, JOB_A)).toBe(true);
    expect(await claim(CLIENT, JOB_B)).toBe(false);
    // The holder renews its own claim on its next pass.
    expect(await claim(CLIENT, JOB_A)).toBe(true);
    expect(await claim(CLIENT, JOB_B)).toBe(false);
    const vs = await style(CLIENT);
    expect(vs.kit_job).toBe(JOB_A);
    expect(typeof vs.kit_started_at).toBe("string");
    expect(vs.frames).toEqual(["a", "b"]);
  });

  it("can be taken over once the start is stale", async () => {
    await merge(CLIENT, { kit_started_at: new Date(Date.now() - 20 * 60_000).toISOString() });
    expect(await claim(CLIENT, JOB_B)).toBe(true);
    expect((await style(CLIENT)).kit_job).toBe(JOB_B);
  });

  it("is never won while a kit is stored", async () => {
    await merge(CLIENT, { kit: ["k0", "k1"], kit_started_at: null });
    expect(await claim(CLIENT, JOB_A, "0 seconds")).toBe(false);
  });

  it("is won again after the start is cleared", async () => {
    await merge(CLIENT, { kit: null, kit_started_at: null, kit_job: null });
    expect(await claim(CLIENT, JOB_A)).toBe(true);
  });

  it("is for the service role only", async () => {
    const { rows } = await db.query<{ a: boolean; s: boolean }>(
      "select has_function_privilege('anon', 'public.video_style_claim_kit(uuid, uuid, interval)', 'execute') as a, has_function_privilege('service_role', 'public.video_style_claim_kit(uuid, uuid, interval)', 'execute') as s",
    );
    expect(rows[0]).toEqual({ a: false, s: true });
  });
});
