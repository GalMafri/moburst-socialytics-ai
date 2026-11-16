// @vitest-environment node
// 20261113100720_calendar_delete_post.sql, applied twice to PGlite over the
// calendar tables. Deleting a post archives it and its Story, archives their
// designs and closes their open design requests; the same migration archives
// designs whose post is already gone.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migration = readFileSync(join(functionsDir, "..", "migrations", "20261113100720_calendar_delete_post.sql"), "utf8");
const C = "00000000-0000-4000-8000-0000000000c1";
const P1 = "00000000-0000-4000-8000-000000000001";
const S1 = "00000000-0000-4000-8000-000000000002";
const P2 = "00000000-0000-4000-8000-000000000003";

// The tables as far as this migration needs them; the two rules stand in for the real access checks.
const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create table public.calendar_posts (id uuid primary key, client_id uuid not null, post_key text not null, story_of text, platform text, copy text);
create table public.calendar_posts_archive (like public.calendar_posts);
alter table public.calendar_posts_archive add column archived_at timestamptz not null default now();
alter table public.calendar_posts_archive add column archive_reason text;
create table public.post_iterations (id uuid primary key default gen_random_uuid(), client_id uuid, calendar_post_key text, archived_at timestamptz);
create table public.design_requests (id uuid primary key default gen_random_uuid(), client_id uuid, calendar_post_key text, status text, end_reason text, ended_at timestamptz);
create function public.is_oauth_session() returns boolean language sql as $$ select current_setting('test.oauth', true) = 'on' $$;
create function public.can_write_client(c uuid) returns boolean language sql as $$ select coalesce(current_setting('test.staff', true), 'on') = 'on' $$;
`;

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(`
    insert into public.calendar_posts (id, client_id, post_key, story_of, platform, copy) values
      ('${P1}', '${C}', 'post:${P1}', null, 'Instagram', 'A feed post'),
      ('${S1}', '${C}', 'post:${S1}', 'post:${P1}', 'Instagram', 'Its Story'),
      ('${P2}', '${C}', 'post:${P2}', null, 'LinkedIn', 'Another post');
    insert into public.post_iterations (client_id, calendar_post_key) values
      ('${C}', 'post:${P1}'), ('${C}', 'post:${S1}'), ('${C}', 'post:${P2}'),
      ('${C}', 'post:00000000-0000-4000-8000-0000000000ff'), ('${C}', '["9a106024",0,1,"Monday"]');
    insert into public.design_requests (client_id, calendar_post_key, status) values
      ('${C}', 'post:${P1}', 'preparing'), ('${C}', 'post:${S1}', 'needs_filming'), ('${C}', 'post:${P2}', 'preparing'), ('${C}', 'post:${P1}', 'ready');
  `);
  await db.exec(migration);
  await db.exec(migration);
}, 30_000);
afterAll(async () => { await db.close(); });

describe("the migration's own clean-up", () => {
  it("archives designs whose post is already gone, and no others", async () => {
    const { rows } = await db.query<{ calendar_post_key: string; archived: boolean }>("select calendar_post_key, archived_at is not null as archived from public.post_iterations order by calendar_post_key");
    const gone = rows.filter((r) => r.archived).map((r) => r.calendar_post_key);
    expect(gone).toEqual(["post:00000000-0000-4000-8000-0000000000ff"]);
  });
});

describe("calendar_delete_post", () => {
  it("archives the post and its Story, their designs, and closes their open requests", async () => {
    await db.query("select public.calendar_delete_post($1)", [P1]);
    const left = await db.query<{ id: string }>("select id from public.calendar_posts order by id");
    expect(left.rows.map((r) => r.id)).toEqual([P2]);
    const archive = await db.query<{ id: string; archive_reason: string }>("select id, archive_reason from public.calendar_posts_archive order by id");
    expect(archive.rows.map((r) => r.id)).toEqual([P1, S1]);
    expect(archive.rows[0].archive_reason).toMatch(/deleted/i);
    const designs = await db.query<{ calendar_post_key: string; archived: boolean }>("select calendar_post_key, archived_at is not null as archived from public.post_iterations where calendar_post_key like 'post:0000%' and calendar_post_key <> 'post:00000000-0000-4000-8000-0000000000ff' order by calendar_post_key");
    expect(designs.rows).toEqual([
      { calendar_post_key: `post:${P1}`, archived: true },
      { calendar_post_key: `post:${S1}`, archived: true },
      { calendar_post_key: `post:${P2}`, archived: false },
    ]);
    const requests = await db.query<{ calendar_post_key: string; status: string; end_reason: string | null }>("select calendar_post_key, status, end_reason from public.design_requests order by calendar_post_key, status");
    expect(requests.rows).toEqual([
      { calendar_post_key: `post:${P1}`, status: "closed", end_reason: "post_removed" },
      { calendar_post_key: `post:${P1}`, status: "ready", end_reason: null },
      { calendar_post_key: `post:${S1}`, status: "closed", end_reason: "post_removed" },
      { calendar_post_key: `post:${P2}`, status: "preparing", end_reason: null },
    ]);
  });

  it("answers a second press for a post that is gone without error", async () => {
    await db.query("select public.calendar_delete_post($1)", [P1]);
  });

  it("refuses a caller who cannot write the client's calendar, and a connected app", async () => {
    await db.exec("set test.staff = 'off'");
    await expect(db.query("select public.calendar_delete_post($1)", [P2])).rejects.toMatchObject({ code: "42501" });
    await db.exec("set test.staff = 'on'; set test.oauth = 'on'");
    await expect(db.query("select public.calendar_delete_post($1)", [P2])).rejects.toMatchObject({ code: "42501" });
    await db.exec("set test.oauth = 'off'");
    const { rows } = await db.query("select id from public.calendar_posts");
    expect(rows).toHaveLength(1);
  });
});
