// @vitest-environment node
// 20261113100730_calendar_post_worked_sent_only.sql, applied twice to PGlite:
// a scheduled_posts row marks a post as worked on only when the post was
// sent to Sprout. A send in progress or one Sprout refused does not.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migration = readFileSync(join(functionsDir, "..", "migrations", "20261113100730_calendar_post_worked_sent_only.sql"), "utf8");
const C = "00000000-0000-4000-8000-0000000000c1";

const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema if not exists auth;
create function auth.role() returns text language sql as $$ select 'service_role' $$;
create function public.is_moburst_staff() returns boolean language sql as $$ select true $$;
create function public.is_client_member(c uuid) returns boolean language sql as $$ select true $$;
create table public.post_iterations (id uuid primary key default gen_random_uuid(), client_id uuid, calendar_post_key text);
create table public.design_requests (id uuid primary key default gen_random_uuid(), client_id uuid, calendar_post_key text, status text);
create table public.scheduled_posts (id uuid primary key default gen_random_uuid(), client_id uuid, calendar_post_key text, status text, platform text, post_content text);
`;

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(migration);
  await db.exec(migration);
}, 30_000);
afterAll(async () => { await db.close(); });

const worked = async (key: string, copy: string | null = null) =>
  (await db.query<{ w: boolean }>("select public.calendar_post_worked($1, $2, 'LinkedIn', $3, null) as w", [C, key, copy])).rows[0].w;
const add = (key: string | null, status: string, content = "") => db.query("insert into public.scheduled_posts (client_id, calendar_post_key, status, platform, post_content) values ($1, $2, $3, 'LinkedIn', $4)", [C, key, status, content]);

describe("calendar_post_worked and scheduled_posts rows", () => {
  it("counts a post sent to Sprout, by key and by copy", async () => {
    await add("post:sent", "scheduled");
    await add("post:old", "asked");
    await add("post:ended", "unconfirmed");
    await add(null, "sent_now", "Copy of an older post");
    expect(await worked("post:sent")).toBe(true);
    expect(await worked("post:old")).toBe(true);
    expect(await worked("post:ended")).toBe(true);
    expect(await worked("post:other", "Copy of an older post")).toBe(true);
  });

  it("does not count a send that is going or that Sprout refused", async () => {
    await add("post:going", "sending");
    await add("post:refused", "failed", "Refused copy");
    expect(await worked("post:going")).toBe(false);
    expect(await worked("post:refused")).toBe(false);
    expect(await worked("post:elsewhere", "Refused copy")).toBe(false);
  });
});
