// @vitest-environment node
// 20261113100700_posting_time_hhmm.sql over a small calendar_posts: the
// 12-hour rows (some with a zone word) become HH:MM, the 24-hour rows stay,
// a time written later lands in the same form, and applying it twice is safe.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations", "20261113100700_posting_time_hhmm.sql"), "utf8");
let db: PGlite;
const times = async () => ((await db.query<{ k: string; t: string | null }>(`select post_key as k, posting_time as t from public.calendar_posts order by post_key`)).rows);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create table public.calendar_posts (post_key text primary key, posting_time text);
    insert into public.calendar_posts values ('a','6:00 PM'),('b','10:00 PM'),('c','18:45'),('d','9:00 AM UTC'),('e',null),('f','12:00 PM'),('g','12:30 AM');`);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe("20261113100700_posting_time_hhmm.sql", () => {
  it("rewrites every 12-hour row to HH:MM and leaves 24-hour rows and empty ones alone, twice over", async () => {
    await db.exec(migration);
    await db.exec(migration);
    expect(Object.fromEntries((await times()).map((r) => [r.k, r.t]))).toEqual({ a: "18:00", b: "22:00", c: "18:45", d: "09:00", e: null, f: "12:00", g: "00:30" });
  });

  it("puts a time written afterwards in the same form", async () => {
    await db.exec(`insert into public.calendar_posts values ('x','6:45 pm EST'); update public.calendar_posts set posting_time = '7 AM' where post_key = 'a';`);
    const got = Object.fromEntries((await times()).map((r) => [r.k, r.t]));
    expect(got.x).toBe("18:45");
    expect(got.a).toBe("07:00");
  });
});
