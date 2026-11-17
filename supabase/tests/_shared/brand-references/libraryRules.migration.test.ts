// @vitest-environment node
// 20261118100000_design_library_rules.sql, applied twice to PGlite over the
// reviews table as 20261109150000_design_refs_refresh.sql creates it. What a
// dry run would not show: rows reviewed before the change read as answered
// under the old question (rule 1, no answer), so each is asked once more; and
// the three checks refuse an answer that is not one of the rule's.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");
const migration = readFileSync(join(migrations, "20261118100000_design_library_rules.sql"), "utf8");
/** The reviews table exactly as the earlier migration creates it. */
const reviewsTable = /create table if not exists public\.design_reference_reviews \([\s\S]*?\n\);/.exec(readFileSync(join(migrations, "20261109150000_design_refs_refresh.sql"), "utf8"))![0];

const NORTHWIND = "00000000-0000-4000-8000-000000000001";

let db: PGlite;
const rows = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, params)).rows;
const insert = (id: string, fields: Record<string, unknown>) => {
  const cols = ["client_id", "source_post_id", "verdict", ...Object.keys(fields)];
  return db.query(`insert into public.design_reference_reviews (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, [NORTHWIND, id, "designed", ...Object.values(fields)]);
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create table public.clients (id uuid primary key, name text); insert into public.clients values ('${NORTHWIND}', 'Northwind Dental');`);
  await db.exec(reviewsTable);
  // A post reviewed before the change.
  await db.exec(`insert into public.design_reference_reviews (client_id, source_post_id, network, verdict, path, confidence, reason)
    values ('${NORTHWIND}', 'ig:before', 'INSTAGRAM', 'designed', 'c1/social-before.jpg', 0.9, 'Branded type over a color block')`);
  await db.exec(migration);
  await db.exec(migration);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe("20261118100000_design_library_rules.sql", () => {
  it("applies twice, adds only columns, checks and an index, and rewrites no row", async () => {
    expect(migration).not.toMatch(/\bdrop table\b|\bdrop column\b|\btruncate\b|\bupdate\b|\bdelete\b|\binsert\b/i);
    const cols = await rows(`select column_name, data_type, is_nullable, column_default from information_schema.columns where table_name = 'design_reference_reviews' and column_name in ('kind', 'occasion', 'evidence', 'caption_hash', 'profile_id', 'rule') order by column_name`);
    expect(cols).toEqual([
      { column_name: "caption_hash", data_type: "text", is_nullable: "YES", column_default: null },
      { column_name: "evidence", data_type: "text", is_nullable: "YES", column_default: null },
      { column_name: "kind", data_type: "text", is_nullable: "YES", column_default: null },
      { column_name: "occasion", data_type: "text", is_nullable: "YES", column_default: null },
      { column_name: "profile_id", data_type: "text", is_nullable: "YES", column_default: null },
      { column_name: "rule", data_type: "smallint", is_nullable: "NO", column_default: "1" },
    ]);
    const checks = await rows(`select conname from pg_constraint where conrelid = 'public.design_reference_reviews'::regclass and contype = 'c' and conname ~ '_(kind|occasion|occasion_kind)_check$' order by conname`);
    expect(checks.map((c) => c.conname)).toEqual(["design_reference_reviews_kind_check", "design_reference_reviews_occasion_check", "design_reference_reviews_occasion_kind_check"]);
    const index = await rows(`select indexdef from pg_indexes where indexname = 'design_reference_reviews_caption'`);
    expect(index).toHaveLength(1);
    expect(String(index[0].indexdef)).toContain("(client_id, caption_hash)");
  });

  it("reads a row reviewed before it as answered under the old question, with no answer", async () => {
    expect(await rows(`select verdict, path, reason, kind, occasion, evidence, caption_hash, profile_id, rule from public.design_reference_reviews where source_post_id = 'ig:before'`)).toEqual([
      { verdict: "designed", path: "c1/social-before.jpg", reason: "Branded type over a color block", kind: null, occasion: null, evidence: null, caption_hash: null, profile_id: null, rule: 1 },
    ]);
  });

  it("takes the answers the rule allows", async () => {
    await insert("ig:everyday", { kind: "everyday", rule: 2, caption_hash: "k1" });
    await insert("ig:unanswered", { rule: 2 });
    for (const occasion of ["holiday", "awareness", "event", "person", "contest"]) await insert(`ig:${occasion}`, { kind: "occasion", occasion, evidence: "shown in the caption", rule: 2 });
    expect((await rows(`select count(*)::int as n from public.design_reference_reviews where rule = 2`))[0].n).toBe(7);
  });

  it("refuses a kind or an occasion type outside the lists, a type on an everyday post, and an occasion with no type", async () => {
    await expect(insert("ig:bad1", { kind: "seasonal" })).rejects.toThrow(/design_reference_reviews_kind_check/);
    await expect(insert("ig:bad2", { kind: "occasion", occasion: "birthday" })).rejects.toThrow(/design_reference_reviews_occasion_check/);
    await expect(insert("ig:bad3", { kind: "everyday", occasion: "holiday" })).rejects.toThrow(/design_reference_reviews_occasion_kind_check/);
    await expect(insert("ig:bad4", { kind: "occasion" })).rejects.toThrow(/design_reference_reviews_occasion_kind_check/);
    await expect(insert("ig:bad5", { occasion: "holiday" })).rejects.toThrow(/design_reference_reviews_occasion_kind_check/);
  });
});
