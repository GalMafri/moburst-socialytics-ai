// @vitest-environment node
// 20261113101500_trend_themes_collected.sql on PGlite: trend_themes_in_range
// answers collected true only for a week that brought something back (done,
// or partial with a kept post or a theme). A client whose only week failed on
// every platform reads as not yet collected.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");
const migration = readFileSync(join(migrations, "20261113101500_trend_themes_collected.sql"), "utf8");

const C = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const W = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon;
    create function public.is_moburst_staff() returns boolean language sql as $$ select false $$;
    create function public.can_access_client(c uuid) returns boolean language sql as $$ select true $$;
    create table public.trend_weeks (id uuid primary key, client_id uuid not null, week_start date not null, status text not null);
    create table public.trend_posts (id uuid primary key default gen_random_uuid(), week_id uuid not null, client_id uuid not null, platform text not null default 'tiktok', url text not null default 'u', author text not null default '', text text not null default '', posted_at timestamptz, format text, views bigint not null default 0, likes bigint not null default 0, comments bigint not null default 0, shares bigint not null default 0, saves bigint not null default 0, engagement numeric not null default 0, kept boolean not null default false, tripwire boolean not null default false);
    create table public.trend_themes (id uuid primary key default gen_random_uuid(), week_id uuid not null, client_id uuid not null, position smallint not null default 0, title text not null default 't', happening text not null default '', why_it_matters text not null default '', angle text not null default '', platforms text[] not null default '{}', post_ids uuid[] not null default '{}', dismissed_at timestamptz);
  `);
  await db.exec(migration);
  await db.exec(migration);
  // 1: only week partial, nothing back. 2: partial with a kept post. 3: partial with a theme. 4: done. 5: partial with only dropped posts. 6: running.
  const weeks: Array<[number, string]> = [[1, "partial"], [2, "partial"], [3, "partial"], [4, "done"], [5, "partial"], [6, "running"]];
  for (const [n, status] of weeks) await db.query("insert into public.trend_weeks (id, client_id, week_start, status) values ($1, $2, '2026-11-02', $3)", [W(n), C(n), status]);
  await db.query("insert into public.trend_posts (week_id, client_id, kept) values ($1, $2, true)", [W(2), C(2)]);
  await db.query("insert into public.trend_themes (week_id, client_id) values ($1, $2)", [W(3), C(3)]);
  await db.query("insert into public.trend_posts (week_id, client_id, kept) values ($1, $2, false)", [W(5), C(5)]);
});
afterAll(async () => { await db.close(); });

const collected = async (n: number) => (await db.query<{ r: { collected: boolean } }>("select public.trend_themes_in_range($1, '2026-10-01', '2026-11-30') as r", [C(n)])).rows[0].r.collected;

describe("trend_themes_in_range collected", () => {
  it("is false for a client whose only week is partial with every platform failed and no posts", async () => {
    expect(await collected(1)).toBe(false);
  });
  it("is false for a partial week that kept no post and a week still running", async () => {
    expect(await collected(5)).toBe(false);
    expect(await collected(6)).toBe(false);
  });
  it("is true for a partial week with a kept post or a theme, and for a done week", async () => {
    expect(await collected(2)).toBe(true);
    expect(await collected(3)).toBe(true);
    expect(await collected(4)).toBe(true);
  });
});
