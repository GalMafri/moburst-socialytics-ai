// @vitest-environment node
// 20261110180000_trend_merges_and_share.sql, applied twice to PGlite over the
// smallest schema it touches: a rewrite merges into the overrides as they are
// in the database, the monthly refresh drops only Instagram's, and the share
// counts every calendar post a trend informed.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");
const migration = readFileSync(join(migrations, "20261110180000_trend_merges_and_share.sql"), "utf8");

const C = "00000000-0000-4000-8000-000000000001";
const WRITTEN = "2026-11-01T10:00:00+00";
const TAGGED = "2026-11-02T10:00:00+00";
const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create function public.is_oauth_session() returns boolean language sql as $$ select false $$;
create function public.is_moburst_staff() returns boolean language sql as $$ select true $$;
create function public.can_access_client(uuid) returns boolean language sql as $$ select true $$;
create table public.clients (id uuid primary key, name text);
create table public.trend_profiles (client_id uuid primary key, search_overrides jsonb, written_at timestamptz, hashtags_at timestamptz);
create table public.trend_weeks (id uuid primary key default gen_random_uuid(), client_id uuid, week_start date, status text, platforms jsonb default '{}', cost jsonb default '{}');
create table public.trend_posts (week_id uuid, kept boolean, tripwire boolean);
create table public.trend_themes (week_id uuid, dismissed_at timestamptz);
create table public.trend_terms (client_id uuid, kind text, removed_at timestamptz);
create table public.calendar_posts (client_id uuid, post_date date, reasons jsonb);
insert into public.clients values ('${C}', 'Moburst');
`;

let db: PGlite;
const overrides = async () => (await db.query<{ o: Record<string, string[]> }>("select search_overrides as o from trend_profiles where client_id = $1", [C])).rows[0].o;
const put = async (platform: string, searches: string[], o: { written?: string; tagged?: string | null; check?: boolean } = {}) =>
  (await db.query<{ ok: boolean }>("select public.trend_search_override_put($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, $6) as ok",
    [C, platform, JSON.stringify(searches), o.written ?? WRITTEN, o.tagged === undefined ? TAGGED : o.tagged, o.check ?? false])).rows[0].ok;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(migration);
  await db.exec(migration);
});
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`delete from trend_profiles; insert into trend_profiles values ('${C}', '{"youtube": ["kept"], "linkedin": ["old"]}', '${WRITTEN}', '${TAGGED}');`);
});

describe("trend_search_override_put", () => {
  it("merges one platform into the overrides as the database holds them", async () => {
    // A "Go back" on LinkedIn lands between the run's read and its write.
    await db.exec(`update trend_profiles set search_overrides = search_overrides - 'linkedin'`);
    expect(await put("tiktok", ["a", "b"])).toBe(true);
    expect(await overrides()).toEqual({ youtube: ["kept"], tiktok: ["a", "b"] });
  });
  it("writes nothing once the profile the run read is replaced", async () => {
    expect(await put("tiktok", ["a"], { written: "2026-10-01T10:00:00+00" })).toBe(false);
    expect(await overrides()).toEqual({ youtube: ["kept"], linkedin: ["old"] });
  });
  it("writes Instagram only while the hashtags the run read stand", async () => {
    expect(await put("instagram", ["#a"], { tagged: "2026-10-02T10:00:00+00", check: true })).toBe(false);
    expect(await put("instagram", ["#a"], { check: true })).toBe(true);
    expect((await overrides()).instagram).toEqual(["#a"]);
  });
  it("refuses a rewrite with no searches", async () => {
    await expect(put("tiktok", [])).rejects.toThrow("A search rewrite must name its platform and its searches.");
  });
});

describe("trend_hashtags_refreshed", () => {
  it("records the refresh and drops only Instagram's rewrite, in one statement", async () => {
    await put("instagram", ["#old"], { check: true });
    await db.query("select public.trend_hashtags_refreshed($1, $2::timestamptz)", [C, "2026-12-01T06:00:00+00"]);
    expect(await overrides()).toEqual({ youtube: ["kept"], linkedin: ["old"] });
    const at = (await db.query<{ at: string }>("select to_char(hashtags_at at time zone 'UTC', 'YYYY-MM-DD') as at from trend_profiles")).rows[0].at;
    expect(at).toBe("2026-12-01");
  });
});

describe("trend_measures used_share", () => {
  it("counts a post when any reason is a trend or cites one", async () => {
    await db.exec(`
      insert into trend_weeks (client_id, week_start, status) values ('${C}', '2026-11-02', 'done');
      insert into calendar_posts values
        ('${C}', '2026-11-03', '[{"type": "trend", "evidence": []}]'),
        ('${C}', '2026-11-04', '[{"type": "performance", "evidence": [{"kind": "own"}, {"kind": "trend"}]}]'),
        ('${C}', '2026-11-05', '[{"type": "performance", "evidence": [{"kind": "own"}]}, {"type": "trend"}]'),
        ('${C}', '2026-11-06', '[{"type": "performance", "evidence": [{"kind": "report"}]}]'),
        ('${C}', '2026-11-07', null);
    `);
    const row = (await db.query<{ used_share: string }>("select used_share::text from public.trend_measures($1)", [C])).rows[0];
    expect(row.used_share).toBe("0.600");
  });
});
