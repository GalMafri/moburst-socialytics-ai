// @vitest-environment node
// 20261113100710_scheduled_posts_sending.sql, applied twice to PGlite over
// scheduled_posts: a row can be 'sending', only one per post, and a failed
// send keeps its reason.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migration = readFileSync(join(functionsDir, "..", "migrations", "20261113100710_scheduled_posts_sending.sql"), "utf8");
const SETUP = `
create table public.scheduled_posts (id uuid primary key default gen_random_uuid(), client_id uuid, calendar_post_key text, status text,
  constraint scheduled_posts_status_check check (status = any (array['scheduled'::text, 'sent_now'::text, 'published'::text, 'failed'::text, 'cancelled'::text])));
`;
const C = "00000000-0000-4000-8000-0000000000c1";

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(migration);
  await db.exec(migration);
});
afterAll(async () => { await db.close(); });

const add = (key: string | null, status: string) => db.query("insert into public.scheduled_posts (client_id, calendar_post_key, status) values ($1, $2, $3)", [C, key, status]);

describe("scheduled_posts sending", () => {
  it("takes a sending row, and one only per post", async () => {
    await add("post:a", "sending");
    await expect(add("post:a", "sending")).rejects.toMatchObject({ code: "23505" });
    await add("post:b", "sending");
  });

  it("holds an asked row the same way, and a post cannot have one of each", async () => {
    await add("post:e", "asked");
    await expect(add("post:e", "asked")).rejects.toMatchObject({ code: "23505" });
    await expect(add("post:e", "sending")).rejects.toMatchObject({ code: "23505" });
  });

  it("holds an unconfirmed row the same way", async () => {
    await add("post:u", "unconfirmed");
    await expect(add("post:u", "unconfirmed")).rejects.toMatchObject({ code: "23505" });
    await expect(add("post:u", "asked")).rejects.toMatchObject({ code: "23505" });
  });

  it("lets a post be sent again once its sending row is finished", async () => {
    await db.query("update public.scheduled_posts set status = 'failed', failure_reason = 'Sprout refused it' where calendar_post_key = 'post:a'");
    await add("post:a", "sending");
    const { rows } = await db.query<{ failure_reason: string }>("select failure_reason from public.scheduled_posts where status = 'failed'");
    expect(rows).toEqual([{ failure_reason: "Sprout refused it" }]);
  });

  it("does not hold sent rows to one per post", async () => {
    await add("post:c", "scheduled");
    await add("post:c", "scheduled");
  });

  it("still refuses a status the rule does not list", async () => {
    await expect(add("post:d", "done")).rejects.toThrow();
  });
});
