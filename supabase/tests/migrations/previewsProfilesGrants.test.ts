// @vitest-environment node
// 20261113103100_previews_profiles_no_anon_writes.sql on PGlite, from the grants
// the live tables had: nobody can truncate them, anon cannot write, and signed-in
// sessions keep the writes their policies are written for.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migration = readFileSync(join(functionsDir, "..", "migrations", "20261113103100_previews_profiles_no_anon_writes.sql"), "utf8");
const TABLES = ["post_previews", "sprout_profiles"];

let db: PGlite;
const has = async (role: string, table: string, priv: string) =>
  (await db.query<{ ok: boolean }>("select has_table_privilege($1, $2, $3) as ok", [role, `public.${table}`, priv])).rows[0].ok;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.post_previews (id uuid primary key default gen_random_uuid());
    create table public.sprout_profiles (id uuid primary key default gen_random_uuid());
    grant all on public.post_previews, public.sprout_profiles to anon, authenticated, service_role;`);
  expect(await has("anon", "post_previews", "TRUNCATE")).toBe(true);
  await db.exec(migration);
  await db.exec(migration);
});
afterAll(async () => { await db.close(); });

describe.each(TABLES)("%s grants after the migration", (table) => {
  it("lets neither anon nor signed-in sessions truncate", async () => {
    expect(await has("anon", table, "TRUNCATE")).toBe(false);
    expect(await has("authenticated", table, "TRUNCATE")).toBe(false);
  });
  it("lets anon read and nothing else that writes", async () => {
    expect(await has("anon", table, "SELECT")).toBe(true);
    for (const p of ["INSERT", "UPDATE", "DELETE"]) expect(await has("anon", table, p)).toBe(false);
  });
  it("leaves signed-in sessions their reads and writes, and the service role everything", async () => {
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) expect(await has("authenticated", table, p)).toBe(true);
    expect(await has("service_role", table, "TRUNCATE")).toBe(true);
  });
});
