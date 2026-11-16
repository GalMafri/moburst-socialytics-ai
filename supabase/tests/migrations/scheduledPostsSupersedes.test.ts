// @vitest-environment node
// 20261113103300_scheduled_posts_supersedes.sql, applied twice to PGlite on top
// of the sending migration: a row that supersedes another closes it in the same
// statement, and an insert that does not happen leaves it as it was.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";
import { SUPERSEDED_REASON } from "../../functions/schedule-sprout-post/store";

const migrations = join(functionsDir, "..", "migrations");
const sending = readFileSync(join(migrations, "20261113100710_scheduled_posts_sending.sql"), "utf8");
const supersedes = readFileSync(join(migrations, "20261113103300_scheduled_posts_supersedes.sql"), "utf8");
const SETUP = `
create table public.scheduled_posts (id uuid primary key default gen_random_uuid(), client_id uuid, calendar_post_key text, status text, sprout_post_id text,
  constraint scheduled_posts_status_check check (status = any (array['scheduled'::text, 'sent_now'::text, 'published'::text, 'failed'::text, 'cancelled'::text])));
`;
const C = "00000000-0000-4000-8000-0000000000c1";
const E = "00000000-0000-4000-8000-0000000000e1";

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(sending);
  await db.exec(supersedes);
  await db.exec(supersedes);
});
afterAll(async () => { await db.close(); });

const earlier = async (key: string, status = "unconfirmed", postId: string | null = null) => {
  await db.query("delete from public.scheduled_posts where calendar_post_key = $1 or id = $2", [key, E]);
  await db.query("insert into public.scheduled_posts (id, client_id, calendar_post_key, status, sprout_post_id) values ($1, $2, $3, $4, $5)", [E, C, key, status, postId]);
};
const send = (key: string, status: string, over: string | null = E) =>
  db.query<{ id: string }>("insert into public.scheduled_posts (client_id, calendar_post_key, status, supersedes) values ($1, $2, $3, $4) returning id", [C, key, status, over]);
const stateOf = async (id: string) => (await db.query<{ status: string; failure_reason: string | null; supersedes: string | null }>("select status, failure_reason, supersedes from public.scheduled_posts where id = $1", [id])).rows[0];

describe("scheduled_posts supersedes", () => {
  it("writes the same reason the function reopens by", () => {
    expect(supersedes).toContain(`'${SUPERSEDED_REASON}'`);
  });

  it("closes the superseded unconfirmed row in the same statement as the new row", async () => {
    await earlier("post:a");
    const { rows } = await send("post:a", "sending");
    expect(await stateOf(E)).toEqual({ status: "failed", failure_reason: SUPERSEDED_REASON, supersedes: null });
    expect((await stateOf(rows[0].id)).supersedes).toBe(E);
  });

  it("closes an asked row the same way", async () => {
    await earlier("post:b", "asked");
    await send("post:b", "sending");
    expect((await stateOf(E)).status).toBe("failed");
  });

  it("leaves the earlier row as it was when the insert does not happen", async () => {
    await earlier("post:c");
    await expect(send("post:c", "done")).rejects.toThrow();
    expect(await stateOf(E)).toEqual({ status: "unconfirmed", failure_reason: null, supersedes: null });
  });

  it("leaves a row that has a post id alone, and the held-row index then refuses the new row", async () => {
    await earlier("post:d", "asked", "p1");
    await expect(send("post:d", "sending")).rejects.toMatchObject({ code: "23505" });
    expect((await stateOf(E)).status).toBe("asked");
  });

  it("writes no link when it closed nothing", async () => {
    await earlier("post:e", "scheduled");
    const { rows } = await send("post:e", "sending");
    expect((await stateOf(rows[0].id)).supersedes).toBeNull();
    expect((await stateOf(E)).status).toBe("scheduled");
  });

  describe("a send that ends without making anything in Sprout puts the earlier row back, from the database", () => {
    const back = { status: "unconfirmed", failure_reason: null, supersedes: null };
    const SEND_DID_NOT_START = "The send did not start.";

    it("when it settles as failed", async () => {
      await earlier("post:f");
      const { rows } = await send("post:f", "sending");
      expect((await stateOf(E)).status).toBe("failed");
      await db.query("update public.scheduled_posts set status = 'failed', failure_reason = 'Sprout did not make the post' where id = $1", [rows[0].id]);
      expect(await stateOf(E)).toEqual(back);
    });

    it("when a later press closes it as 'The send did not start.'", async () => {
      await earlier("post:g");
      const { rows } = await send("post:g", "sending");
      await db.query("update public.scheduled_posts set status = 'failed', failure_reason = $2 where id = $1", [rows[0].id, SEND_DID_NOT_START]);
      expect(await stateOf(E)).toEqual(back);
    });

    it("when it is deleted", async () => {
      await earlier("post:h");
      const { rows } = await send("post:h", "sending");
      await db.query("delete from public.scheduled_posts where id = $1", [rows[0].id]);
      expect(await stateOf(E)).toEqual(back);
    });

    it("not when it was sent, or is unconfirmed itself", async () => {
      await earlier("post:i");
      const sent = await send("post:i", "sending");
      await db.query("update public.scheduled_posts set status = 'scheduled', sprout_post_id = '9' where id = $1", [sent.rows[0].id]);
      expect((await stateOf(E)).status).toBe("failed");
      await earlier("post:j");
      const lost = await send("post:j", "sending");
      await db.query("update public.scheduled_posts set status = 'unconfirmed' where id = $1", [lost.rows[0].id]);
      expect((await stateOf(E)).status).toBe("failed");
    });

    it("not when another held row has the post", async () => {
      await earlier("post:k");
      const { rows } = await send("post:k", "sending");
      // The new send leaves the held states without the earlier row coming back, another send takes the post, and only then is the first closed as failed.
      await db.query("update public.scheduled_posts set status = 'cancelled' where id = $1", [rows[0].id]);
      await send("post:k", "sending", null);
      await db.query("update public.scheduled_posts set status = 'failed', failure_reason = 'x' where id = $1", [rows[0].id]);
      expect((await stateOf(E)).status).toBe("failed");
    });

    it("not when the earlier row was closed by anything but the superseding", async () => {
      await earlier("post:l");
      const { rows } = await send("post:l", "sending");
      await db.query("update public.scheduled_posts set status = 'failed', failure_reason = 'other' where id = $1", [E]);
      await db.query("update public.scheduled_posts set status = 'failed', failure_reason = 'x' where id = $1", [rows[0].id]);
      expect(await stateOf(E)).toEqual({ status: "failed", failure_reason: "other", supersedes: null });
    });

    it("not for a send that was itself closed by a later press: that press holds the post", async () => {
      await earlier("post:m");
      const first = await send("post:m", "sending");
      await db.query("update public.scheduled_posts set status = 'unconfirmed' where id = $1", [first.rows[0].id]);
      const second = await send("post:m", "sending", first.rows[0].id);
      expect((await stateOf(first.rows[0].id)).status).toBe("failed");
      expect((await stateOf(E)).status).toBe("failed");
      expect((await stateOf(second.rows[0].id)).status).toBe("sending");
    });
  });
});
