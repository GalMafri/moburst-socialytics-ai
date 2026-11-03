import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../_shared/lifecycle/fakeDb";
import { AuthzError } from "../_shared/auth/authz";
import { type StoryDeps, designStory } from "./story";

// "Design as a Story" on a Facebook or Instagram post (Stories design,
// 2 Nov 2026): one Story post linked to its source, designed through the
// same request a post's own "Create design" makes.

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
const PERSON = "person-1";

const feedPost = (over: Row = {}): Row => ({
  id: "p1", client_id: "c1", post_key: "post:p1", post_date: "2026-11-05", posting_time: "9:00 AM", platform: "Instagram", format: "Single image",
  copy: "Captains pay last. Here is why the beer league runs on it.", pillar: "Beer League Truths", language: "en", report_id: null, story_of: null, ...over,
});

function world(tables: Record<string, Row[]> = {}): FakeDb {
  return fakeDb({
    calendar_posts: [feedPost()],
    design_brand_settings: [{ client_id: "c1", confirmed_at: "2026-10-20T10:00:00Z", logo_path: "c1/logo.png", placement: {}, background: "#000000", reference_paths: ["c1/a.jpg"] }],
    post_iterations: [],
    design_requests: [],
    ...tables,
  });
}

function deps(db: FakeDb, over: Partial<StoryDeps> = {}): StoryDeps & { startRequest: ReturnType<typeof vi.fn> } {
  return {
    db,
    requireMember: async () => PERSON,
    // The single post's path, as far as a Story needs it: a request named for the person.
    startRequest: vi.fn(async (_settings: Row, p: Row) => {
      const row = { id: `req-${db.tables.design_requests.length + 1}`, client_id: p.clientId, calendar_post_key: p.postKey, format: p.format, platform: p.platform, post_copy: p.copy, requested_by: p.requestedBy, status: "preparing" };
      db.tables.design_requests.push(row);
      return row;
    }),
    ...over,
  } as StoryDeps & { startRequest: ReturnType<typeof vi.fn> };
}

const stories = (db: FakeDb) => db.tables.calendar_posts.filter((p) => p.format === "Story");

describe("the story action", () => {
  it("adds one Story linked to the post, on its date and time, and starts its design", async () => {
    const db = world();
    const d = deps(db);
    const r = await designStory(d, { client_id: "c1", calendar_post_key: "post:p1" });
    expect(r.status ?? 200).toBe(200);
    expect(stories(db)).toHaveLength(1);
    const story = stories(db)[0];
    expect(story).toMatchObject({
      client_id: "c1", platform: "Instagram", post_date: "2026-11-05", posting_time: "9:00 AM", format: "Story", story_of: "post:p1",
      copy: "Captains pay last. Here is why the beer league runs on it.", source: "ad_hoc", created_by: PERSON, plan_id: null,
    });
    expect(story.post_key).toBe(`post:${story.id}`);
    expect(d.startRequest).toHaveBeenCalledTimes(1);
    expect(d.startRequest.mock.calls[0][1]).toMatchObject({ clientId: "c1", postKey: story.post_key, format: "Story", platform: "Instagram", requestedBy: PERSON, copy: story.copy });
    expect(r.body).toMatchObject({ story: { post_key: story.post_key, story_of: "post:p1" }, request: { calendar_post_key: story.post_key } });
  });

  it("writes the Story from the post's copy as it is now", async () => {
    const db = world({ post_iterations: [{ client_id: "c1", calendar_post_key: "post:p1", post_copy: "Edited: captains pay last.", media_urls: null, created_at: "2026-11-03T09:00:00Z" }] });
    await designStory(deps(db), { client_id: "c1", calendar_post_key: "post:p1" });
    expect(stories(db)[0].copy).toBe("Edited: captains pay last.");
  });

  it("opens the same Story on a second press, starting nothing more", async () => {
    const db = world();
    const first = await designStory(deps(db), { client_id: "c1", calendar_post_key: "post:p1" });
    const d = deps(db);
    const second = await designStory(d, { client_id: "c1", calendar_post_key: "post:p1" });
    expect(stories(db)).toHaveLength(1);
    expect((second.body.story as Row).post_key).toBe((first.body.story as Row).post_key);
    expect(second.body.request ?? null).toBeNull();
    expect(d.startRequest).not.toHaveBeenCalled();
  });

  it("makes a Story for a Facebook post too", async () => {
    const db = world({ calendar_posts: [feedPost({ platform: "Facebook" })] });
    await designStory(deps(db), { client_id: "c1", calendar_post_key: "post:p1" });
    expect(stories(db)[0]).toMatchObject({ platform: "Facebook", format: "Story" });
  });

  it("refuses a post on another network, and a post that is a Story already, writing nothing", async () => {
    for (const post of [feedPost({ platform: "LinkedIn" }), feedPost({ format: "Story" })]) {
      const db = world({ calendar_posts: [post] });
      const d = deps(db);
      const r = await designStory(d, { client_id: "c1", calendar_post_key: "post:p1" });
      expect(r.status).toBe(400);
      expect(db.tables.calendar_posts).toHaveLength(1);
      expect(d.startRequest).not.toHaveBeenCalled();
    }
  });

  it("checks membership as a post's own design does, before anything is read or written", async () => {
    const db = world();
    const outsider = async () => { throw new AuthzError(403, "Not allowed."); };
    await expect(designStory(deps(db, { requireMember: outsider }), { client_id: "c1", calendar_post_key: "post:p1" })).rejects.toThrow(AuthzError);
    expect(stories(db)).toEqual([]);
  });

  // "Add a Story" (notes and Stories design, 3 Nov 2026): before the brand's designs are set up, the Story is added with its message and no design.
  it("adds the Story with its message and no design before the client's designs are set up", async () => {
    for (const settings of [[], [{ client_id: "c1", confirmed_at: null }]]) {
      const db = world({ design_brand_settings: settings });
      const d = deps(db);
      const r = await designStory(d, { client_id: "c1", calendar_post_key: "post:p1" });
      expect(r.status ?? 200).toBe(200);
      expect(stories(db)).toHaveLength(1);
      expect(stories(db)[0]).toMatchObject({ story_of: "post:p1", copy: "Captains pay last. Here is why the beer league runs on it.", created_by: PERSON });
      expect(r.body).toMatchObject({ story: { story_of: "post:p1" }, request: null });
      expect(d.startRequest).not.toHaveBeenCalled();
      expect(db.tables.design_requests).toEqual([]);
    }
  });

  it("starts the Story's design with it once the client's designs are set up", async () => {
    const db = world();
    const d = deps(db);
    await designStory(d, { client_id: "c1", calendar_post_key: "post:p1" });
    expect(d.startRequest).toHaveBeenCalledTimes(1);
    expect(db.tables.design_requests).toHaveLength(1);
  });

  it("answers with the Story another press made at the same moment", async () => {
    const db = world();
    const from = db.from.bind(db);
    // The unique index on (client_id, story_of) lets one insert through; the other is refused.
    db.from = (table: string) => {
      const q = from(table);
      if (table !== "calendar_posts") return q;
      q.insert = () => {
        db.tables.calendar_posts.push(feedPost({ id: "s-other", post_key: "post:s-other", format: "Story", story_of: "post:p1" }));
        const refused = { select: () => refused, single: async () => ({ data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } }) };
        return refused;
      };
      return q;
    };
    const d = deps(db);
    const r = await designStory(d, { client_id: "c1", calendar_post_key: "post:p1" });
    expect((r.body.story as Row).post_key).toBe("post:s-other");
    expect(d.startRequest).not.toHaveBeenCalled();
  });

  it("asks for the post", async () => {
    expect((await designStory(deps(world()), { client_id: "c1" })).status).toBe(400);
    expect((await designStory(deps(world()), { client_id: "c1", calendar_post_key: "post:gone" })).status).toBe(404);
  });
});
