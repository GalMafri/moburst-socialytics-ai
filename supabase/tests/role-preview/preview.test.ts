// @vitest-environment node
// Preview as a client (18 Nov 2026): what each request asks of the database
// and what it answers (role-preview/preview.ts). The rules themselves are
// two database functions, tested against a real database in
// supabase/tests/migrations/rolePreviews.test.ts; here a stand-in answers
// for them, so each answer's reply, and the reply when the database does not
// answer at all, can be pinned.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleRolePreview, PREVIEW_MS, type BeginCode, type EndedReason, type OpenPreview, type PreviewStore } from "../../functions/role-preview/preview.ts";

const USER = "00000000-0000-4000-8000-0000000000a1";
const NORTH = "00000000-0000-4000-8000-0000000000c1";
const OPEN: OpenPreview = { id: "p1", client_id: NORTH, client_name: "North Bakery", started_at: "2026-11-18T09:00:00.000Z" };

/** A stand-in database: what each call answers, and every call made, in order. */
function standIn(answers: {
  open?: OpenPreview | null;
  begin?: { code: BeginCode | "something_new"; preview: OpenPreview | null } | Error;
  end?: { open: boolean; ended: EndedReason | null } | Error;
} = {}) {
  const calls: string[] = [];
  const store: PreviewStore = {
    async openPreview(userId) { calls.push(`openPreview:${userId}`); return answers.open ?? null; },
    async begin(userId, clientId) {
      calls.push(`begin:${userId}:${clientId}`);
      if (answers.begin instanceof Error) throw answers.begin;
      return (answers.begin ?? { code: "started", preview: OPEN }) as { code: BeginCode; preview: OpenPreview | null };
    },
    async end(id, reason) {
      calls.push(`end:${id}:${reason}`);
      if (answers.end instanceof Error) throw answers.end;
      return answers.end ?? { open: true, ended: null };
    },
  };
  return { store, calls };
}
const lost = () => new Error("connection reset (secret detail)");

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("start", () => {
  it("asks the database for the whole switch in one call, for the caller and nobody else, and tells the page what is open", async () => {
    const { store, calls } = standIn();
    const reply = await handleRolePreview(store, USER, { action: "start", client_id: NORTH });
    expect(calls).toEqual([`openPreview:${USER}`, `begin:${USER}:${NORTH}`]);
    expect(reply).toEqual({ status: 200, body: { ended: null, preview: { ...OPEN, expires_at: new Date(Date.parse(OPEN.started_at) + PREVIEW_MS).toISOString() } } });
  });

  it("first lets a preview that is already over end, so it does not stand in the way", async () => {
    const { store, calls } = standIn({ open: OPEN, end: { open: false, ended: "expired" } });
    expect((await handleRolePreview(store, USER, { action: "start", client_id: NORTH })).status).toBe(200);
    expect(calls).toEqual([`openPreview:${USER}`, "end:p1:check", `begin:${USER}:${NORTH}`]);
  });

  it.each([
    ["not_staff", 403],
    ["client_not_found", 404],
    ["client_archived", 409],
  ] as const)("answers %s as a refusal with no preview", async (code, status) => {
    const { store } = standIn({ begin: { code, preview: null } });
    const reply = await handleRolePreview(store, USER, { action: "start", client_id: NORTH });
    expect(reply).toMatchObject({ status, body: { code } });
    expect(reply.body.preview).toBeUndefined();
  });

  it("answers a person already in a preview with that preview", async () => {
    const { store } = standIn({ begin: { code: "already_previewing", preview: OPEN } });
    expect(await handleRolePreview(store, USER, { action: "start", client_id: NORTH })).toMatchObject({ status: 409, body: { code: "already_previewing", preview: { client_id: NORTH } } });
  });

  it("asks nothing of the database without a client id", async () => {
    for (const client of [undefined, null, "north", 7]) {
      const { store, calls } = standIn();
      expect(await handleRolePreview(store, USER, { action: "start", client_id: client })).toMatchObject({ status: 400, body: { code: "client_required" } });
      expect(calls).toEqual([]);
    }
  });

  it("never answers that a preview started when the database did not say so", async () => {
    for (const begin of [lost(), { code: "something_new" as const, preview: OPEN }]) {
      const { store } = standIn({ begin });
      const reply = await handleRolePreview(store, USER, { action: "start", client_id: NORTH });
      expect(reply).toMatchObject({ status: 500, body: { code: "unavailable" } });
      expect(reply.body.preview).toBeUndefined();
      expect(JSON.stringify(reply.body)).not.toContain("secret detail");
    }
  });
});

describe("status", () => {
  it("is no preview, with no check made, for a person with no open row", async () => {
    const { store, calls } = standIn();
    expect(await handleRolePreview(store, USER, { action: "status" })).toEqual({ status: 200, body: { preview: null, ended: null } });
    expect(calls).toEqual([`openPreview:${USER}`]);
  });

  it("has the open preview checked every time, and reports it while it holds", async () => {
    const { store, calls } = standIn({ open: OPEN });
    expect((await handleRolePreview(store, USER, { action: "status" })).body).toMatchObject({ preview: { id: "p1", client_name: "North Bakery" }, ended: null });
    expect(calls).toEqual([`openPreview:${USER}`, "end:p1:check"]);
  });

  it.each(["expired", "role_changed"] as const)("reports no preview and why when the check ended it as %s", async (ended) => {
    const { store } = standIn({ open: OPEN, end: { open: false, ended } });
    expect(await handleRolePreview(store, USER, { action: "status" })).toEqual({ status: 200, body: { preview: null, ended } });
  });

  it("claims nothing when the check could not be made", async () => {
    const { store } = standIn({ open: OPEN, end: lost() });
    const reply = await handleRolePreview(store, USER, { action: "status" });
    expect(reply).toMatchObject({ status: 500, body: { code: "unavailable" } });
    expect(reply.body.preview).toBeUndefined();
  });
});

describe("stop", () => {
  it("is refused without an open row, and nothing is asked to end", async () => {
    const { store, calls } = standIn();
    expect(await handleRolePreview(store, USER, { action: "stop" })).toMatchObject({ status: 409, body: { code: "no_preview" } });
    expect(calls).toEqual([`openPreview:${USER}`]);
  });

  it("ends the caller's own open preview, in one call", async () => {
    const { store, calls } = standIn({ open: OPEN, end: { open: false, ended: "exited" } });
    expect(await handleRolePreview(store, USER, { action: "stop" })).toEqual({ status: 200, body: { preview: null, ended: "exited" } });
    expect(calls).toEqual([`openPreview:${USER}`, "end:p1:exited"]);
  });

  it("says so when a sign-in had already replaced the preview", async () => {
    const { store } = standIn({ open: OPEN, end: { open: false, ended: "role_changed" } });
    expect(await handleRolePreview(store, USER, { action: "stop" })).toEqual({ status: 200, body: { preview: null, ended: "role_changed" } });
  });

  it("does not say the person left when the database did not answer", async () => {
    const { store } = standIn({ open: OPEN, end: lost() });
    expect(await handleRolePreview(store, USER, { action: "stop" })).toMatchObject({ status: 500, body: { code: "unavailable" } });
  });
});

describe("a request", () => {
  it("is refused for an unknown action", async () => {
    const { store, calls } = standIn();
    expect(await handleRolePreview(store, USER, { action: "become_admin" })).toMatchObject({ status: 400, body: { code: "unknown_action" } });
    expect(calls).toEqual([]);
  });
});
