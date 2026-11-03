// Saving a calendar post's copy, the one path for the calendar's Save
// (calendar-posts save_copy) and for copy approved in Claude (the
// connector's socialytics_post_copy_save). The calendar's rows are the rows
// it wrote before the move; a save from Claude carries the updated_at it
// read and is refused, with the current copy, when the post changed since.

import { describe, expect, it } from "vitest";
import { eqs, fakeDb, op } from "../db.fake";
import { copyWrites, sameInstant, saveCopy, type CopyPost, type CopyWrites, type IterationRow } from "./saveCopy";

const CLIENT = "00000000-0000-4000-8000-000000000001";
const PERSON = "00000000-0000-4000-8000-0000000000aa";
const KEY = "plan:2026-11-09:instagram:1";
const AT = "2026-11-03T10:15:42.123456+00:00";
const NOW = new Date("2026-11-03T12:00:00.000Z");

function writes(post: CopyPost | null, over: Partial<CopyWrites> = {}) {
  const iterations: IterationRow[] = [];
  const updates: Array<{ fields: Record<string, unknown>; unchangedSince?: string }> = [];
  let current = post;
  const w: CopyWrites = {
    post: async () => current,
    lastVersion: async () => 2,
    insertIteration: async (row) => { iterations.push(row); },
    updatePost: async (_c, _k, fields, unchangedSince) => {
      updates.push({ fields, unchangedSince });
      if (unchangedSince && current && !sameInstant(unchangedSince, current.updated_at)) return null;
      if (current) current = { ...current, copy: String(fields.copy), updated_at: "2026-11-03T12:00:00.5+00:00" };
      return current?.updated_at ?? null;
    },
    ...over,
  };
  return { w, iterations, updates, set: (p: CopyPost) => { current = p; } };
}
const POST: CopyPost = { copy: "Hurt in a crash? Call us.", hashtags: ["injurylaw"], cta: "Call now", platform: "Instagram", updated_at: AT };

describe("sameInstant", () => {
  it("compares two timestamps to the microsecond, whatever their zone is written as", () => {
    expect(sameInstant(AT, "2026-11-03T10:15:42.123456Z")).toBe(true);
    expect(sameInstant(AT, "2026-11-03 12:15:42.123456+02")).toBe(true);
    expect(sameInstant(AT, "2026-11-03T05:15:42.123456-0500")).toBe(true);
    expect(sameInstant("2026-11-03T10:15:42+00:00", "2026-11-03T10:15:42.000Z")).toBe(true);
    expect(sameInstant(AT, "2026-11-03T10:15:42.123457+00:00")).toBe(false);
    expect(sameInstant(AT, "2026-11-03T10:15:42.123+00:00")).toBe(false);
    for (const bad of ["", "yesterday", null, undefined, 42]) expect(sameInstant(AT, bad)).toBe(false);
  });
});

describe("saveCopy from the calendar", () => {
  it("writes the revision row and the post's copy as calendar-posts did, and teaches the memory from a person's edit", async () => {
    const { w, iterations, updates } = writes(POST);
    const learned: unknown[] = [];
    const r = await saveCopy(w, {
      clientId: CLIENT, key: KEY, copy: "  Hurt in a crash? We answer 24/7. ", hashtags: ["injurylaw", 7], cta: "Call", reportId: "r1", version: "3",
      platform: "instagram", concept: "c", visualDirection: "v", format: "reel", source: "calendar", userId: PERSON, now: NOW,
    }, (s) => learned.push(s));
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(iterations).toEqual([{
      client_id: CLIENT, report_id: "r1", calendar_post_key: KEY, version: 3, platform: "instagram", post_copy: "Hurt in a crash? We answer 24/7.",
      hashtags: ["injurylaw", "7"], cta: "Call", concept: "c", visual_direction: "v", format: "reel", source: "calendar", created_by: PERSON,
    }]);
    expect(updates).toEqual([{ fields: { copy: "Hurt in a crash? We answer 24/7.", touched_at: NOW.toISOString(), hashtags: ["injurylaw", "7"], cta: "Call" }, unchangedSince: undefined }]);
    expect(learned).toEqual([{ kind: "copy_edit", before: POST.copy, after: "Hurt in a crash? We answer 24/7.", platform: "Instagram" }]);
  });

  it("keeps the calendar's defaults: version 1, no hashtags or CTA left untouched, a regeneration teaches nothing", async () => {
    const { w, iterations, updates } = writes(null);
    const learned: unknown[] = [];
    await saveCopy(w, { clientId: CLIENT, key: KEY, copy: "New", source: "regeneration", userId: PERSON, now: NOW }, (s) => learned.push(s));
    expect(iterations[0]).toMatchObject({ version: 1, report_id: null, platform: null, hashtags: null, cta: null, concept: null, visual_direction: null, format: null, source: "regeneration" });
    expect(updates[0].fields).toEqual({ copy: "New", touched_at: NOW.toISOString() });
    expect(learned).toEqual([]);
  });

  it("refuses empty copy", async () => {
    const { w, iterations } = writes(POST);
    expect(await saveCopy(w, { clientId: CLIENT, key: KEY, copy: "  ", source: "calendar", userId: PERSON, now: NOW })).toEqual({ ok: false, status: 400, error: "client_id, calendar_post_key and post_copy are required." });
    expect(iterations).toEqual([]);
  });
});

describe("saveCopy from Claude", () => {
  const claude = (over: Record<string, unknown> = {}) => ({ clientId: CLIENT, key: KEY, copy: "Hurt in a crash? We answer 24/7.", source: "claude" as const, userId: PERSON, now: NOW, basedOn: "2026-11-03T10:15:42.123456Z", ...over });

  it("saves only while the post is as Claude read it, then writes a revision from Claude after the latest one", async () => {
    const { w, iterations, updates } = writes(POST);
    const learned: unknown[] = [];
    const r = await saveCopy(w, claude({ hashtags: ["#injurylaw", " ", "#queens"], cta: "Call today" }), (s) => learned.push(s));
    expect(r).toEqual({ ok: true, changed: true, updatedAt: "2026-11-03T12:00:00.5+00:00" });
    expect(updates).toEqual([{ fields: { copy: "Hurt in a crash? We answer 24/7.", touched_at: NOW.toISOString(), hashtags: ["#injurylaw", "#queens"], cta: "Call today" }, unchangedSince: AT }]);
    expect(iterations).toEqual([{
      client_id: CLIENT, report_id: null, calendar_post_key: KEY, version: 3, platform: "Instagram", post_copy: "Hurt in a crash? We answer 24/7.",
      hashtags: ["#injurylaw", "#queens"], cta: "Call today", concept: null, visual_direction: null, format: null, source: "claude", created_by: PERSON,
    }]);
    expect(learned).toEqual([{ kind: "copy_edit", before: POST.copy, after: "Hurt in a crash? We answer 24/7.", platform: "Instagram" }]);
  });

  it("refuses a save based on an older read, and answers with the copy as it is now", async () => {
    const { w, iterations, updates } = writes({ ...POST, copy: "Edited in the app", updated_at: "2026-11-03T11:00:00.000001+00:00" });
    expect(await saveCopy(w, claude())).toEqual({
      ok: false, status: 409, error: "This post changed in Socialytics after you read it.",
      current: { copy: "Edited in the app", hashtags: ["injurylaw"], cta: "Call now", platform: "Instagram", updated_at: "2026-11-03T11:00:00.000001+00:00" },
    });
    expect(updates).toEqual([]);
    expect(iterations).toEqual([]);
  });

  it("refuses when the post changes between the check and the save, and writes no revision", async () => {
    const t = writes(POST);
    const racing: CopyWrites = { ...t.w, post: async () => POST, updatePost: async () => null };
    let reads = 0;
    racing.post = async () => (reads++ === 0 ? POST : { ...POST, copy: "Changed a moment ago", updated_at: "2026-11-03T11:59:59Z" });
    const r = await saveCopy(racing, claude());
    expect(r).toMatchObject({ ok: false, status: 409, current: { copy: "Changed a moment ago" } });
    expect(t.iterations).toEqual([]);
  });

  it("changes nothing when the copy is what is stored, and says so", async () => {
    const { w, iterations, updates } = writes(POST);
    expect(await saveCopy(w, claude({ copy: ` ${POST.copy} `, basedOn: "2026-10-01T00:00:00Z" }))).toEqual({ ok: true, changed: false, updatedAt: AT });
    expect(await saveCopy(w, claude({ copy: POST.copy, hashtags: ["injurylaw"], cta: "Call now" }))).toEqual({ ok: true, changed: false, updatedAt: AT });
    expect(updates).toEqual([]);
    expect(iterations).toEqual([]);
  });

  it("refuses a post the client's calendar does not have, copy that is empty or too long, and a save with no read", async () => {
    const { w } = writes(null);
    expect(await saveCopy(w, claude())).toEqual({ ok: false, status: 404, error: "No post with that key in this client's calendar." });
    const { w: w2, iterations } = writes(POST);
    expect(await saveCopy(w2, claude({ copy: "" }))).toEqual({ ok: false, status: 400, error: "The copy is empty." });
    expect(await saveCopy(w2, claude({ copy: "x".repeat(10_001) }))).toEqual({ ok: false, status: 400, error: "Copy holds at most 10,000 characters." });
    expect(await saveCopy(w2, claude({ basedOn: "" }))).toEqual({ ok: false, status: 400, error: "Give based_on as the updated_at you read for this post." });
    expect(await saveCopy(w2, claude({ hashtags: "law" }))).toEqual({ ok: false, status: 400, error: "hashtags must be a list of at most 30 hashtags." });
    expect(await saveCopy(w2, claude({ cta: "x".repeat(301) }))).toEqual({ ok: false, status: 400, error: "The call to action holds at most 300 characters." });
    expect(iterations).toEqual([]);
  });
});

describe("copyWrites", () => {
  it("reads the post, the latest revision, and writes as calendar-posts did", async () => {
    const { db, calls } = fakeDb((c) => {
      if (c.table === "calendar_posts" && op(c, "select") && !op(c, "update")) return { data: POST };
      if (c.table === "post_iterations" && op(c, "select")) return { data: [{ version: 4 }] };
      if (op(c, "update")) return { data: [{ updated_at: "2026-11-03T12:00:00.5+00:00" }] };
      return {};
    });
    const w = copyWrites(db);
    expect(await w.post(CLIENT, KEY)).toEqual(POST);
    expect(await w.lastVersion(CLIENT, KEY)).toBe(4);
    await w.insertIteration({ client_id: CLIENT, calendar_post_key: KEY } as IterationRow);
    expect(await w.updatePost(CLIENT, KEY, { copy: "x" })).toBe("2026-11-03T12:00:00.5+00:00");
    expect(await w.updatePost(CLIENT, KEY, { copy: "x" }, AT)).toBe("2026-11-03T12:00:00.5+00:00");
    expect(calls.map((c) => c.table)).toEqual(["calendar_posts", "post_iterations", "post_iterations", "calendar_posts", "calendar_posts"]);
    expect(eqs(calls[0])).toEqual({ client_id: CLIENT, post_key: KEY });
    expect(op(calls[2], "insert")).toEqual([{ client_id: CLIENT, calendar_post_key: KEY }]);
    expect(eqs(calls[3])).toEqual({ client_id: CLIENT, post_key: KEY });
    expect(eqs(calls[4])).toEqual({ client_id: CLIENT, post_key: KEY, updated_at: AT });
  });

  it("throws when the revision cannot be written, and reads a post no row matched as null", async () => {
    const { db } = fakeDb((c) => (op(c, "insert") ? { error: { message: "boom" } } : { data: op(c, "update") ? [] : null }));
    await expect(copyWrites(db).insertIteration({} as IterationRow)).rejects.toThrow("Could not save the copy: boom");
    expect(await copyWrites(db).post(CLIENT, KEY)).toBeNull();
    expect(await copyWrites(db).updatePost(CLIENT, KEY, { copy: "x" }, AT)).toBeNull();
  });
});
