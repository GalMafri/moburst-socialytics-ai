// @vitest-environment node
// The client's own designed posts for the reads that need posts and not
// uploads (posts.ts brandPosts): where its posts put the logo, and the brand
// read's images. A library a person chose can hold uploads only, so those
// reads fall back to the reviewed everyday posts.
import { describe, expect, it } from "vitest";
import { brandPosts } from "../../../functions/_shared/brand-references/posts";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";

const review = (guid: string, day: string, over: Record<string, unknown> = {}) => ({
  client_id: "c1", source_post_id: guid, network: guid.startsWith("li") ? "LINKEDIN_COMPANY" : "INSTAGRAM", posted_at: `${day}T15:00:00Z`, verdict: "designed",
  path: `c1/social-${guid.replace(":", "-")}.jpg`, kind: "everyday", rule: 2, ...over,
});
const reviews = () => [
  review("ig:1", "2026-10-20"), review("li:1", "2026-11-05"), review("ig:2", "2026-11-10"),
  review("ig:halloween", "2026-10-31", { kind: "occasion", occasion: "holiday" }),
  review("ig:silent", "2026-11-12", { kind: null }),
  review("ig:photo", "2026-11-13", { verdict: "not_designed", path: null, kind: null }),
  review("ig:other", "2026-11-14", { client_id: "c2" }),
  review("ig:out", "2026-11-11"),
];

describe("the client's own designed posts", () => {
  it("are the library's posts, as stored and in stored order, when it holds any", async () => {
    const db = fakeDb({ design_reference_reviews: reviews(), design_reference_choices: [] });
    const library = [
      { path: "c1/uploads/flyer.png", upload: true, kept: true },
      { path: "c1/social-b.jpg", platform: "LinkedIn", posted_at: "2026-10-01T15:00:00Z", source_post_id: "li:b", quality_checked: true },
      { path: "c1/social-a.jpg", platform: "Instagram", posted_at: "2026-11-01T15:00:00Z", source_post_id: "ig:a", quality_checked: true, kept: true },
    ];
    expect(await brandPosts(db, { id: "c1", harvested_design_references: library })).toEqual([library[1], library[2]]);
  });

  const uploadsOnly = [{ path: "c1/uploads/a.png", upload: true, kept: true }, { path: "c1/uploads/b.png", upload: true, kept: true }, { path: "c1/uploads/c.png", upload: true, kept: true }];
  const post = (guid: string, day: string) => ({ path: `c1/social-${guid.replace(":", "-")}.jpg`, platform: guid.startsWith("li") ? "LinkedIn" : "Instagram", posted_at: `${day}T15:00:00Z`, source_post_id: guid, quality_checked: true });
  const choices = [{ client_id: "c1", path: "c1/social-ig-out.jpg", choice: "left_out" }, { client_id: "c1", path: "c1/social-ig-1.jpg", choice: "kept" }];

  it("are its reviewed designed posts of any kind, newest first and without the ones left out, when the library holds uploads only", async () => {
    const db = fakeDb({ design_reference_reviews: reviews(), design_reference_choices: choices });
    // Where the logo sits is evidence a holiday post gives as well as any other, and so does a post with no answer yet.
    expect(await brandPosts(db, { id: "c1", harvested_design_references: uploadsOnly })).toEqual([
      post("ig:silent", "2026-11-12"), post("ig:2", "2026-11-10"), post("li:1", "2026-11-05"), post("ig:halloween", "2026-10-31"), post("ig:1", "2026-10-20"),
    ]);
    expect(await brandPosts(db, { id: "c1", harvested_design_references: uploadsOnly }, 2)).toEqual([post("ig:silent", "2026-11-12"), post("ig:2", "2026-11-10")]);
    expect(await brandPosts(db, { id: "c1" })).toHaveLength(5);
  });

  it("are not empty for a client whose posts were all made for occasions, or are not answered yet: the logo's spot is still read from them", async () => {
    const onlyOccasions = [review("ig:halloween", "2026-10-31", { kind: "occasion", occasion: "holiday" }), review("ig:ribbon", "2026-10-09", { kind: "occasion", occasion: "awareness" }), review("ig:before", "2026-09-20", { kind: null, rule: 1 })];
    const db = fakeDb({ design_reference_reviews: onlyOccasions, design_reference_choices: [] });
    expect((await brandPosts(db, { id: "c1", harvested_design_references: uploadsOnly })).map((p) => p.source_post_id)).toEqual(["ig:halloween", "ig:ribbon", "ig:before"]);
    // The brand read asks for everyday posts first, and takes these when there are none.
    expect((await brandPosts(db, { id: "c1", harvested_design_references: uploadsOnly }, 16, { everydayFirst: true })).map((p) => p.source_post_id)).toEqual(["ig:halloween", "ig:ribbon", "ig:before"]);
  });

  it("for the brand read, are the everyday ones alone when there are any", async () => {
    const db = fakeDb({ design_reference_reviews: reviews(), design_reference_choices: choices });
    expect(await brandPosts(db, { id: "c1", harvested_design_references: uploadsOnly }, 16, { everydayFirst: true })).toEqual([post("ig:2", "2026-11-10"), post("li:1", "2026-11-05"), post("ig:1", "2026-10-20")]);
  });

  it("are none, never an error, when the reviews cannot be read", async () => {
    const failing = { from: () => { throw new Error("connection lost"); } };
    expect(await brandPosts(failing, { id: "c1", harvested_design_references: [] })).toEqual([]);
    // A read that is refused: every query answers with an error.
    const refusal = { data: null, error: { message: "permission denied" } };
    // deno-lint-ignore no-explicit-any
    const query: any = { select: () => query, eq: () => query, order: () => query, limit: () => query, then: (ok: (v: unknown) => unknown) => Promise.resolve(refusal).then(ok) };
    const refused = { from: () => query };
    expect(await brandPosts(refused, { id: "c1", harvested_design_references: null })).toEqual([]);
    expect(await brandPosts(fakeDb({ design_reference_reviews: [], design_reference_choices: [] }), { id: "c1" })).toEqual([]);
  });
});
