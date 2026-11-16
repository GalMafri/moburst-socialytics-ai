// @vitest-environment node
// 20261113101010_use_design.sql, applied to PGlite: one statement puts a live
// design option in use and takes the post's others out; a deleted or turned
// down design, another kind of media and a missing row change nothing.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migration = readFileSync(join(functionsDir, "..", "migrations", "20261113101010_use_design.sql"), "utf8");
const id = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create table public.post_iterations (id uuid primary key, client_id uuid not null, calendar_post_key text, variant_angle text, is_selected boolean not null default false, archived_at timestamptz, rejected_at timestamptz);
`;
const C1 = "00000000-0000-4000-8000-0000000000c1";
const C2 = "00000000-0000-4000-8000-0000000000c2";

let db: PGlite;
beforeAll(async () => { db = new PGlite(); await db.exec(SETUP); await db.exec(migration); await db.exec(migration); });
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec("delete from public.post_iterations");
  await db.exec(`insert into public.post_iterations (id, client_id, calendar_post_key, variant_angle, is_selected, archived_at, rejected_at) values
    ('${id(1)}', '${C1}', 'p1', 'Design option 1', true, null, null),
    ('${id(2)}', '${C1}', 'p1', 'Design option 2', false, null, null),
    ('${id(3)}', '${C1}', 'p1', 'Design option 3', false, now(), null),
    ('${id(4)}', '${C1}', 'p1', 'Design option 4', false, null, now()),
    ('${id(5)}', '${C1}', 'p1', 'Upload', false, null, null),
    ('${id(6)}', '${C2}', 'p1', 'Design option 1', true, null, null),
    ('${id(7)}', '${C1}', 'p2', 'Design option 1', true, null, null)`);
});
const use = async (n: number) => (await db.query<{ v: boolean }>("select public.use_design($1::uuid) as v", [id(n)])).rows[0].v;
const selected = async () => (await db.query<{ id: string }>("select id from public.post_iterations where is_selected order by id")).rows.map((r) => r.id);

describe("use_design", () => {
  it("puts a live design in use and takes the same post's other design out, leaving other posts and clients alone", async () => {
    expect(await use(2)).toBe(true);
    expect(await selected()).toEqual([id(2), id(6), id(7)]);
  });
  it.each([3, 4, 5])("changes nothing for row %i (deleted, turned down, not a design)", async (n) => {
    expect(await use(n)).toBe(false);
    expect(await selected()).toEqual([id(1), id(6), id(7)]);
  });
  it("answers false for a row that is not there", async () => {
    expect((await db.query<{ v: boolean }>("select public.use_design($1::uuid) as v", [id(99)])).rows[0].v).toBe(false);
  });
  it("is the same when asked twice", async () => {
    await use(2); await use(2);
    expect(await selected()).toEqual([id(2), id(6), id(7)]);
  });
});
