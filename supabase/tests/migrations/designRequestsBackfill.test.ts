// @vitest-environment node
// 20261113101030_design_requests_options_ready_backfill.sql, applied twice to
// PGlite: a ready request whose count is 0 gets the number of designs in its
// group, updated_at stays as it was, and nothing else changes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migration = readFileSync(join(functionsDir, "..", "migrations", "20261113101030_design_requests_options_ready_backfill.sql"), "utf8");
const R = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const SETUP = `
create table public.design_requests (id uuid primary key, status text not null, options_ready int not null default 0, updated_at timestamptz not null default now());
create table public.post_iterations (id uuid primary key default gen_random_uuid(), variant_group_id uuid, variant_angle text, archived_at timestamptz);
insert into public.design_requests (id, status, options_ready, updated_at) values
  ('${R(1)}', 'ready', 0, '2026-10-01T00:00:00Z'), ('${R(2)}', 'ready', 2, '2026-10-01T00:00:00Z'),
  ('${R(3)}', 'preparing', 0, '2026-10-01T00:00:00Z'), ('${R(4)}', 'ready', 0, '2026-10-01T00:00:00Z');
insert into public.post_iterations (variant_group_id, variant_angle, archived_at) values
  ('${R(1)}', 'Design option 1', now()), ('${R(1)}', 'Design option 2', null), ('${R(1)}', 'Reference creative 1', null),
  ('${R(2)}', 'Design option 1', null), ('${R(3)}', 'Design option 1', null);
`;

let db: PGlite;
beforeAll(async () => { db = new PGlite(); await db.exec(SETUP); await db.exec(migration); await db.exec(migration); });
afterAll(async () => { await db.close(); });
const get = async (n: number) => (await db.query<{ options_ready: number; updated_at: string }>("select options_ready, updated_at::text from public.design_requests where id = $1", [R(n)])).rows[0];

describe("options_ready backfill", () => {
  it("counts the designs in the group of a ready request that shows 0, deleted ones included", async () => {
    expect((await get(1)).options_ready).toBe(2);
  });
  it("leaves updated_at as it was", async () => {
    expect((await get(1)).updated_at).toContain("2026-10-01");
  });
  it("leaves a count that is set, a request still preparing and a group with no designs", async () => {
    expect((await get(2)).options_ready).toBe(2);
    expect((await get(3)).options_ready).toBe(0);
    expect((await get(4)).options_ready).toBe(0);
  });
  it("leaves no ready request with a count of 0 and designs in its group", async () => {
    const { rows } = await db.query<{ n: number }>("select count(*)::int n from public.design_requests r where status = 'ready' and options_ready = 0 and exists (select 1 from public.post_iterations p where p.variant_group_id = r.id and p.variant_angle ~ '^Design option')");
    expect(rows[0].n).toBe(0);
  });
});
