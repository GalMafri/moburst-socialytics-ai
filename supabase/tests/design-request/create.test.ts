import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../support/lifecycleFakeDb";
import { AuthzError } from "../../functions/_shared/auth/authz";
import { type CreateDeps, createDesign } from "../../functions/design-request/create";

// A person's "Create design": who may press it, for which client, and what a
// video does when its idea is a person on camera.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const NOW = new Date("2026-11-03T12:00:00Z");
const body = (over: Row = {}): Row => ({ client_id: "c1", calendar_post_key: "post:1", post_copy: "Captains pay last.", platform: "Instagram", format: "Single image", ...over });

function setup(over: { client?: Row; settings?: Row | null; postDate?: string } = {}) {
  const db: FakeDb = fakeDb({
    clients: [{ id: "c1", name: "Pay The Pyper", timezone: "UTC", archived_at: null, ...over.client }],
    design_brand_settings: over.settings === null ? [] : [{ client_id: "c1", confirmed_at: "2026-10-20T10:00:00Z", ...over.settings }],
    calendar_posts: [{ client_id: "c1", post_key: "post:1", post_date: over.postDate ?? "2026-11-10", posting_time: "9:00 AM" }],
  });
  const d = {
    db,
    requireMember: vi.fn(async () => "person-1"),
    now: () => NOW,
    filmedReason: vi.fn(async (): Promise<string | null> => null),
    recordFilming: vi.fn(async () => ({ id: "film-1" })),
    start: vi.fn(async (_s: Row, p: Row) => ({ id: "req-1", ...p })),
  } satisfies CreateDeps;
  return { db, d };
}

describe("create", () => {
  it("starts a design named for the person who asked, with the note cleaned", async () => {
    const { d } = setup();
    const answer = await createDesign(d, body({ note: "  Show the rink  " }));
    expect(d.requireMember).toHaveBeenCalledWith("c1");
    expect(d.start.mock.calls[0][1]).toMatchObject({ clientId: "c1", postKey: "post:1", requestedBy: "person-1", note: "Show the rink", learnNote: true, route: null });
    expect(answer.body.request).toMatchObject({ id: "req-1" });
  });

  it("refuses a caller without access, and starts nothing", async () => {
    const { d } = setup();
    d.requireMember.mockRejectedValue(new AuthzError(403, "You do not have access to this client."));
    await expect(createDesign(d, body())).rejects.toMatchObject({ status: 403 });
    expect(d.start).not.toHaveBeenCalled();
  });

  it("makes nothing for an archived client", async () => {
    const { d } = setup({ client: { archived_at: "2026-10-30T10:00:00Z" } });
    expect(await createDesign(d, body())).toMatchObject({ status: 409 });
    expect(d.start).not.toHaveBeenCalled();
  });

  it("answers not_set_up, starting nothing, until the client's designs are confirmed", async () => {
    for (const settings of [null, { confirmed_at: null }]) {
      const { d } = setup({ settings });
      expect(await createDesign(d, body())).toEqual({ body: { code: "not_set_up" } });
      expect(d.start).not.toHaveBeenCalled();
    }
  });

  it("asks for the three fields", async () => {
    const { d } = setup();
    expect(await createDesign(d, body({ post_copy: " " }))).toMatchObject({ status: 400 });
    expect(d.requireMember).not.toHaveBeenCalled();
  });

  it("records a video of a person on camera as filmed, and starts no design", async () => {
    const { d } = setup();
    d.filmedReason.mockResolvedValue("it needs the founder on camera");
    const answer = await createDesign(d, body({ format: "Reel" }));
    expect(answer.body).toMatchObject({ code: "needs_filming", who: "it needs the founder on camera", request: { id: "film-1" } });
    expect(d.start).not.toHaveBeenCalled();
  });

  it("makes a video from the client's posts, without asking about filming, when the post is under a day away", async () => {
    const { d } = setup({ postDate: "2026-11-03" });
    await createDesign(d, body({ format: "Reel" }));
    expect(d.filmedReason).not.toHaveBeenCalled();
    expect(d.start.mock.calls[0][1]).toMatchObject({ route: "posts" });
  });
});
