import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../functions/_shared/lifecycle/fakeDb";
import { AuthzError } from "../../functions/_shared/auth/authz";
import { type FootageDeps, footageFor } from "../../functions/design-request/footage";

// A filmed clip for a video post: the clip must be this client's and really
// there, and the post must be a video.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const body = (over: Row = {}): Row => ({ client_id: "c1", calendar_post_key: "post:1", post_copy: "Captains pay last.", path: "c1/clip.mp4", platform: "Instagram", format: "Reel", ...over });

function setup(over: { posts?: Row[]; exists?: boolean; waiting?: boolean } = {}) {
  const db: FakeDb = fakeDb({
    design_brand_settings: [{ client_id: "c1", confirmed_at: "2026-10-20T10:00:00Z" }],
    calendar_posts: over.posts ?? [{ client_id: "c1", post_key: "post:1", format: "Reel", platform: "Instagram" }],
    design_requests: over.waiting === false ? [] : [{ id: "wait-1", client_id: "c1", calendar_post_key: "post:1", status: "needs_filming", on_camera: "the founder", updated_at: "2026-11-02T10:00:00Z" }],
    canva_finish_jobs: [],
  });
  const d = {
    db,
    requireMember: vi.fn(async () => "person-1"),
    clipExists: vi.fn(async () => over.exists ?? true),
    start: vi.fn(async (_s: Row, p: Row) => ({ id: "req-new", ...p })),
  } satisfies FootageDeps;
  return { db, d };
}

describe("footage", () => {
  it("starts the video from the clip, names who is on camera, and ends the post's wait for filming", async () => {
    const { db, d } = setup();
    const answer = await footageFor(d, body());
    expect(d.start).toHaveBeenCalledTimes(1);
    expect(d.start.mock.calls[0][1]).toMatchObject({ footagePath: "c1/clip.mp4", onCamera: "the founder", requestedBy: "person-1" });
    expect(answer.body.request).toMatchObject({ id: "req-new" });
    expect(db.tables.design_requests[0]).toMatchObject({ status: "closed", end_reason: "filmed" });
  });

  it("starts nothing for a path nobody uploaded", async () => {
    const { d } = setup({ exists: false });
    expect(await footageFor(d, body())).toMatchObject({ status: 400 });
    expect(d.clipExists).toHaveBeenCalledWith("c1/clip.mp4");
    expect(d.start).not.toHaveBeenCalled();
  });

  it("starts nothing when the calendar's post is a still image, whatever the screen sent", async () => {
    const { d } = setup({ waiting: false, posts: [{ client_id: "c1", post_key: "post:1", format: "Single image", platform: "Instagram" }] });
    expect(await footageFor(d, body({ format: "Reel" }))).toMatchObject({ status: 400 });
    expect(d.start).not.toHaveBeenCalled();
  });

  it("takes a post that waits for filming as a video, whatever its calendar row says now", async () => {
    const { db, d } = setup({ posts: [{ client_id: "c1", post_key: "post:1", format: "Single image", platform: "Instagram" }] });
    const answer = await footageFor(d, body());
    expect(d.start).toHaveBeenCalledTimes(1);
    expect(answer.body.request).toMatchObject({ id: "req-new" });
    expect(db.tables.design_requests[0]).toMatchObject({ status: "closed", end_reason: "filmed" });
  });

  it("takes a post that is not in the calendar yet as the screen sent it", async () => {
    const { d } = setup({ waiting: false, posts: [] });
    await footageFor(d, body());
    expect(d.start).toHaveBeenCalledTimes(1);
    const { d: still } = setup({ waiting: false, posts: [] });
    expect(await footageFor(still, body({ format: "Single image" }))).toMatchObject({ status: 400 });
  });

  it("refuses a clip of another client, a path that climbs out, and a caller without access", async () => {
    const { d } = setup();
    expect(await footageFor(d, body({ path: "c2/clip.mp4" }))).toMatchObject({ status: 400 });
    expect(await footageFor(d, body({ path: "c1/../c2/clip.mp4" }))).toMatchObject({ status: 400 });
    d.requireMember.mockRejectedValue(new AuthzError(403, "no"));
    await expect(footageFor(d, body())).rejects.toMatchObject({ status: 403 });
    expect(d.start).not.toHaveBeenCalled();
  });
});
