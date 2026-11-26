// @vitest-environment node
// 20261117160000_trend_week_write.sql, applied twice to PGlite over the trend
// tables as 20261029100000_trends.sql makes them: a week is written in one
// step (a failure leaves it as it was), a post is matched by its link, a theme
// a person dismissed is never erased or written again, and
// trend_themes_in_range says whether this week brought something back.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fakeDb } from "../../support/lifecycleFakeDb";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");
const migration = readFileSync(join(migrations, "20261117160000_trend_week_write.sql"), "utf8");

const C = "00000000-0000-4000-8000-000000000001";
const W = "00000000-0000-4000-8000-000000000101";
const STAFF = "00000000-0000-4000-8000-0000000000aa";
const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create function public.is_oauth_session() returns boolean language sql as $$ select coalesce(current_setting('test.oauth', true), '') = 'on' $$;
create function public.is_moburst_staff() returns boolean language sql as $$ select false $$;
create function public.can_access_client(uuid) returns boolean language sql as $$ select true $$;
create table public.trend_weeks (
  id uuid primary key default gen_random_uuid(), client_id uuid not null, week_start date not null,
  status text not null default 'running' check (status in ('running', 'done', 'partial')), platforms jsonb not null default '{}'::jsonb,
  filter_status text check (filter_status in ('ok', 'failed', 'skipped')), cost jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), finished_at timestamptz, unique (client_id, week_start));
create table public.trend_posts (
  id uuid primary key default gen_random_uuid(), week_id uuid not null references public.trend_weeks(id) on delete cascade, client_id uuid not null,
  platform text not null check (platform in ('tiktok', 'instagram', 'linkedin', 'youtube', 'pinterest', 'facebook')), url text not null,
  author text not null default '', text text not null default '', posted_at timestamptz,
  format text check (format in ('short_video', 'long_video', 'carousel', 'image', 'text', 'pin')),
  views bigint not null default 0, likes bigint not null default 0, comments bigint not null default 0, shares bigint not null default 0, saves bigint not null default 0,
  engagement numeric not null default 0, search text not null default '', kept boolean not null default false, drop_reason text,
  fit smallint check (fit between 0 and 100), why text, lesson text, tripwire boolean not null default false, created_at timestamptz not null default now(),
  unique (week_id, url));
create table public.trend_themes (
  id uuid primary key default gen_random_uuid(), week_id uuid not null references public.trend_weeks(id) on delete cascade, client_id uuid not null,
  position smallint not null default 0, title text not null, happening text not null default '', why_it_matters text not null default '', angle text not null default '',
  platforms text[] not null default '{}', post_ids uuid[] not null default '{}', dismissed_at timestamptz, dismissed_by uuid, created_at timestamptz not null default now());
`;

// deno-lint-ignore no-explicit-any
type Any = any;
let db: PGlite;

const post = (n: number, over: Record<string, unknown> = {}) => ({
  platform: "instagram", url: `https://www.instagram.com/p/post${n}/`, author: `maker${n}`, text: `Post ${n}`, posted_at: "2026-11-10T09:00:00Z", format: "image",
  views: 0, likes: 10 * n, comments: n, shares: 0, saves: 0, engagement: 12 * n, search: "#trail", kept: true, drop_reason: null, fit: 80, why: "w", lesson: "l", tripwire: false, ...over,
});
const theme = (title: string, posts: number[]) => ({ title, happening: `${title} is happening`, why_it_matters: "w", angle: "a", platforms: ["instagram"], post_urls: posts.map((n) => post(n).url) });

const write = (posts: Any[], themes: Any[], o: { status?: string; week?: string } = {}) =>
  db.query<{ r: { posts: number; themes: number; dismissed_kept: number } }>(
    "select public.trend_week_write($1, $2, $3::jsonb, $4::jsonb, $5, $6::jsonb, $7, $8::jsonb, $9::timestamptz) as r",
    [o.week ?? W, C, JSON.stringify(posts), JSON.stringify(themes), o.status ?? "done", JSON.stringify({ instagram: { status: "ok" } }), "ok", JSON.stringify({ apify_usd: 0.05 }), "2026-11-10T10:00:00Z"],
  ).then((r) => r.rows[0].r);
const posts = async () => (await db.query<Any>("select id, url, kept, fit, likes, platform from public.trend_posts where week_id = $1 order by url", [W])).rows;
const themes = async () => (await db.query<Any>("select id, title, position, post_ids, dismissed_at, dismissed_by, happening from public.trend_themes where week_id = $1 order by dismissed_at nulls first, position", [W])).rows;
const week = async () => (await db.query<Any>("select status, platforms, filter_status, cost, finished_at from public.trend_weeks where id = $1", [W])).rows[0];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(migration);
  await db.exec(migration);
});
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec("delete from public.trend_weeks;");
  await db.query("insert into public.trend_weeks (id, client_id, week_start) values ($1, $2, date_trunc('week', now() at time zone 'Asia/Jerusalem')::date)", [W, C]);
});

describe("trend_week_write", () => {
  it("writes the week's posts, themes and row in one call, each theme pointing at its posts in order", async () => {
    expect(await write([post(1), post(2), post(3, { kept: false, drop_reason: "off_topic", fit: null })], [theme("Trail snacks", [2, 1]), theme("Rain gear", [3, 9])])).toEqual({ posts: 3, themes: 2, dismissed_kept: 0 });
    const stored = await posts();
    const id = (n: number) => stored.find((p) => p.url === post(n).url)!.id;
    expect((await themes()).map((t) => [t.title, t.position, t.post_ids])).toEqual([["Trail snacks", 0, [id(2), id(1)]], ["Rain gear", 1, [id(3)]]]);
    expect(await week()).toMatchObject({ status: "done", platforms: { instagram: { status: "ok" } }, filter_status: "ok", cost: { apify_usd: 0.05 } });
  });

  it("matches a post by its link when the week is written again: kept in place, added, or removed, and never stored twice", async () => {
    await write([post(1), post(2)], [theme("Trail snacks", [1])]);
    const before = await posts();
    // Post 1 judged again, post 2 gone, post 3 new and listed twice.
    await write([post(1, { fit: 91, likes: 500 }), post(3), post(3, { likes: 1 })], [theme("Trail snacks", [1, 3])]);
    const after = await posts();
    expect(after.map((p) => p.url)).toEqual([post(1).url, post(3).url]);
    expect(after[0]).toMatchObject({ id: before[0].id, fit: 91, likes: 500 });
    expect((await themes())[0].post_ids).toEqual([after[0].id, after[1].id]);
  });

  it("never erases a theme a person dismissed, and leaves out a new theme with its title", async () => {
    await write([post(1), post(2), post(3)], [theme("Trail snacks", [1]), theme("Gear hauls", [2, 3]), theme("Rain gear", [3])]);
    const hauls = (await themes()).find((t) => t.title === "Gear hauls")!;
    await db.query("update public.trend_themes set dismissed_at = '2026-11-10T12:00:00Z', dismissed_by = $2 where id = $1", [hauls.id, STAFF]);
    // The week is written again: post 3 is gone, and the model wrote the dismissed theme again in other capitals.
    expect(await write([post(1), post(2), post(4)], [theme("GEAR HAULS", [2]), theme("Camp cooking", [4]), theme("Trail snacks", [1])])).toEqual({ posts: 3, themes: 2, dismissed_kept: 1 });
    const now = await themes();
    expect(now.filter((t) => t.dismissed_at === null).map((t) => t.title)).toEqual(["Camp cooking", "Trail snacks"]);
    const kept = now.filter((t) => t.dismissed_at !== null);
    expect(kept).toHaveLength(1);
    const post2 = (await posts()).find((p) => p.url === post(2).url)!.id;
    // The same row: who and when, its own words; of its posts, the one the week still holds.
    expect(kept[0]).toMatchObject({ id: hauls.id, title: "Gear hauls", dismissed_by: STAFF, happening: "Gear hauls is happening", post_ids: [post2] });
    expect(new Date(kept[0].dismissed_at).toISOString()).toBe("2026-11-10T12:00:00.000Z");
    // What trend_measures counts for the week is still there.
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.trend_themes where week_id = $1 and dismissed_at is not null", [W])).rows[0].n).toBe(1);
  });

  it("leaves the week exactly as it was when the write fails partway", async () => {
    await write([post(1), post(2)], [theme("Trail snacks", [1, 2])], { status: "partial" });
    const before = { posts: await posts(), themes: await themes(), week: await week() };
    // The third post names a platform the table refuses: nothing of the call may stay.
    await expect(write([post(1, { fit: 99 }), post(5), post(6, { platform: "myspace" })], [theme("Camp cooking", [5])])).rejects.toThrow();
    expect(await posts()).toEqual(before.posts);
    expect(await themes()).toEqual(before.themes);
    expect(await week()).toEqual(before.week);
    // The same for a call that is not a week's write at all.
    await expect(write([post(1)], [], { status: "running" })).rejects.toThrow(/done or partial/);
    await expect(write([post(1)], [], { week: "00000000-0000-4000-8000-000000000999" })).rejects.toThrow(/does not exist/);
    await expect(db.query("select public.trend_week_write($1, $2, '{}'::jsonb, '[]'::jsonb, 'done', '{}'::jsonb, 'ok', '{}'::jsonb, now())", [W, C])).rejects.toThrow(/list of posts/);
    expect(await posts()).toEqual(before.posts);
  });

  it("is the service role's alone, and a connected app cannot use it", async () => {
    const can = async (role: string) => (await db.query<{ ok: boolean }>(
      "select has_function_privilege($1, 'public.trend_week_write(uuid, uuid, jsonb, jsonb, text, jsonb, text, jsonb, timestamptz)', 'execute') as ok", [role])).rows[0].ok;
    expect([await can("service_role"), await can("authenticated"), await can("anon")]).toEqual([true, false, false]);
    await db.exec("set test.oauth = 'on';");
    try {
      await expect(write([post(1)], [])).rejects.toThrow(/Connected apps/);
    } finally {
      await db.exec("set test.oauth = 'off';");
    }
    expect(await posts()).toEqual([]);
  });

  it("comes to the same week as the stand-in the pipeline tests write through", async () => {
    const fake = fakeDb({ trend_weeks: [{ id: W, client_id: C, status: "running", platforms: {} }], trend_posts: [], trend_themes: [] });
    const call = (p: Any[], t: Any[]) => fake.rpc("trend_week_write", { p_week: W, p_client: C, p_posts: p, p_themes: t, p_status: "done", p_platforms: {}, p_filter_status: "ok", p_cost: {}, p_finished_at: "2026-11-10T10:00:00Z" });
    const first: [Any[], Any[]] = [[post(1), post(2), post(3)], [theme("Trail snacks", [1]), theme("Gear hauls", [2, 3])]];
    const second: [Any[], Any[]] = [[post(1), post(2), post(4)], [theme("gear hauls", [2]), theme("Camp cooking", [4, 1])]];
    await write(...first);
    await call(...first);
    await db.query("update public.trend_themes set dismissed_at = now(), dismissed_by = $2 where week_id = $1 and title = 'Gear hauls'", [W, STAFF]);
    Object.assign(fake.tables.trend_themes.find((t) => t.title === "Gear hauls")!, { dismissed_at: "2026-11-10T12:00:00Z", dismissed_by: STAFF });
    const real = await write(...second);
    const stand = (await call(...second)).data;
    expect(stand).toEqual(real);
    const urlOf = new Map((await posts()).map((p) => [p.id, p.url]));
    const fakeUrlOf = new Map(fake.tables.trend_posts.map((p) => [p.id, p.url]));
    const shape = (rows: Any[], urls: Map<string, string>) => rows.map((t) => [t.title, t.dismissed_at != null, (t.post_ids as string[]).map((id) => urls.get(id))]).sort();
    expect(shape(fake.tables.trend_themes, fakeUrlOf)).toEqual(shape(await themes(), urlOf));
    expect(fake.tables.trend_posts.map((p) => p.url).sort()).toEqual((await posts()).map((p) => p.url));
  });
});

describe("trend_themes_in_range this_week_collected", () => {
  const answer = async () => (await db.query<{ r: { collected: boolean; this_week_collected: boolean; themes: Any[] } }>("select public.trend_themes_in_range($1, '2026-01-01', '2099-12-31') as r", [C])).rows[0].r;
  const set = (status: string) => db.query("update public.trend_weeks set status = $2 where id = $1", [W, status]);

  it("is false before this week is collected and while it is being collected", async () => {
    expect(await answer()).toMatchObject({ this_week_collected: false, collected: false, themes: [] });
    await db.exec("delete from public.trend_weeks;");
    expect((await answer()).this_week_collected).toBe(false);
  });

  it("is true for a week that was collected and has no theme to show: done with nothing kept, or with too few posts kept", async () => {
    await set("done");
    expect(await answer()).toMatchObject({ this_week_collected: true, themes: [] });
    await write([post(1), post(2)], [], { status: "partial" });
    expect(await answer()).toMatchObject({ this_week_collected: true, themes: [] });
  });

  it("is false for a week that brought nothing back, and says nothing about another week", async () => {
    await set("partial");
    expect((await answer()).this_week_collected).toBe(false);
    // Last week was collected; this week has no row.
    await db.query("update public.trend_weeks set status = 'done', week_start = week_start - 7 where id = $1", [W]);
    expect(await answer()).toMatchObject({ collected: true, this_week_collected: false });
  });

  it("still answers the themes as before, a dismissed one left out", async () => {
    await write([post(1), post(2), post(3)], [theme("Trail snacks", [1, 2]), theme("Rain gear", [3])]);
    await db.query("update public.trend_themes set dismissed_at = now() where week_id = $1 and title = 'Rain gear'", [W]);
    const got = await answer();
    expect(got).toMatchObject({ collected: true, this_week_collected: true });
    expect(got.themes.map((t) => [t.title, t.posts.map((p: Any) => p.url)])).toEqual([["Trail snacks", [post(1).url, post(2).url]]]);
    // A client is not given the team's weighted score.
    expect(got.themes[0].posts[0].engagement).toBeNull();
  });
});
