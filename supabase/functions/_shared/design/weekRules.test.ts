import { describe, it, expect } from "vitest";
import { type PostFacts, type RunPost, WEEK_AT_ONCE, classifyPost, currentCopyOf, designKind, keepStarts, mergeIntoRun, planPass, runFinished, weekCounts } from "./weekRules";

// Tuesday 3 Nov 2026, noon UTC; the week runs Monday 2 to Sunday 8 Nov.
const NOW = new Date("2026-11-03T12:00:00Z");
const by = "person-1";

const post = (key: string, over: Partial<PostFacts["post"]> = {}): PostFacts["post"] => ({
  post_key: key, post_date: "2026-11-05", posting_time: "9:00 AM", format: "Static", platform: "Instagram", ...over,
});
const facts = (key: string, over: Partial<PostFacts> = {}, postOver: Partial<PostFacts["post"]> = {}): PostFacts => ({
  post: post(key, postOver), requests: [], hasDesign: false, otherMedia: false, copy: "Copy for " + key, ...over,
});
const queued = (key: string, over: Partial<RunPost> = {}): RunPost => ({
  post_key: key, kind: "single", post_at: "2026-11-05T09:00:00.000Z", state: "queued", added_by: by, added_at: NOW.toISOString(), ...over,
});

describe("classifyPost", () => {
  it("takes a post never designed, and one whose last request ended without a design or was stopped", () => {
    expect(classifyPost(facts("a"), "UTC", NOW)).toMatchObject({ in: true, kind: "single", route: null, askFilming: false });
    expect(classifyPost(facts("v", {}, { format: "Reel" }), "UTC", NOW)).toMatchObject({ in: true, kind: "video", route: null, askFilming: true });
    const ended = { status: "closed", end_reason: "no_design", created_at: "2026-11-02T08:00:00Z", video_route: "posts" };
    expect(classifyPost(facts("v", { requests: [ended] }, { format: "Reel" }), "UTC", NOW)).toMatchObject({ in: true, kind: "video", route: "posts", askFilming: false });
    expect(classifyPost(facts("c", { requests: [{ status: "canceled", created_at: "2026-11-02T08:00:00Z" }] }, { format: "Carousel" }), "UTC", NOW)).toMatchObject({ in: true, kind: "carousel" });
  });

  it("makes a filmed post whose footage did not come from the client's posts", () => {
    const closed = { status: "closed", end_reason: "no_footage", created_at: "2026-11-01T08:00:00Z" };
    expect(classifyPost(facts("v", { requests: [closed] }, { format: "Reel" }), "UTC", NOW)).toMatchObject({ in: true, route: "posts", askFilming: false });
  });

  it("leaves out every post it must not spend on, and says why", () => {
    const why = (f: PostFacts) => {
      const c = classifyPost(f, "UTC", NOW);
      return c.in ? null : c.why;
    };
    expect(why(facts("a", { hasDesign: true }))).toBe("designed");
    expect(why(facts("a", { requests: [{ status: "ready", created_at: "2026-11-02T08:00:00Z" }] }))).toBe("designed");
    expect(why(facts("a", { requests: [{ status: "preparing", created_at: "2026-11-03T11:00:00Z" }] }))).toBe("preparing");
    expect(why(facts("a", { requests: [{ status: "needs_filming", created_at: "2026-11-02T08:00:00Z" }] }))).toBe("filming");
    expect(why(facts("a", { otherMedia: true }))).toBe("media_in_use");
    expect(why(facts("a", {}, { format: "Text only" }))).toBe("text_only");
    expect(why(facts("a", {}, { post_date: "2026-11-03", posting_time: "8:00 AM" }))).toBe("passed");
    expect(why(facts("a", { requests: [{ status: "closed", end_reason: "post_removed", created_at: "2026-11-02T08:00:00Z" }] }))).toBe("ended");
  });

  it("reads the post's time in the client's time zone", () => {
    // 6:00 AM in New York on 3 Nov is 11:00 UTC: passed at noon UTC. 9:00 AM is 14:00 UTC: still ahead.
    expect(classifyPost(facts("a", {}, { post_date: "2026-11-03", posting_time: "6:00 AM" }), "America/New_York", NOW)).toEqual({ in: false, why: "passed" });
    expect(classifyPost(facts("a", {}, { post_date: "2026-11-03", posting_time: "9:00 AM" }), "America/New_York", NOW)).toMatchObject({ in: true });
  });
});

describe("designKind", () => {
  it("makes a document a carousel and any short video a video", () => {
    expect(designKind("LinkedIn document", "LinkedIn")).toBe("carousel");
    expect(designKind("Story", "TikTok")).toBe("video");
    expect(designKind("Single image", "Instagram")).toBe("single");
  });
});

describe("currentCopyOf", () => {
  it("is the post's latest saved edit without media, else the copy it was planned with", () => {
    const rows = [
      { post_copy: "A design", media_urls: ["https://x/d.png"], created_at: "2026-11-03T10:00:00Z" },
      { post_copy: "Edited copy", media_urls: null, created_at: "2026-11-03T09:00:00Z" },
      { post_copy: "Older edit", media_urls: [], created_at: "2026-11-02T09:00:00Z" },
    ];
    expect(currentCopyOf(rows, "Planned copy")).toBe("Edited copy");
    expect(currentCopyOf([], " Planned copy ")).toBe("Planned copy");
    expect(currentCopyOf([], null)).toBe("");
  });
});

describe("weekCounts", () => {
  it("counts the posts a press would design by kind, those whose copy is not written yet, and the filmed ones", () => {
    const list = [
      classifyPost(facts("a"), "UTC", NOW),
      classifyPost(facts("b", { copy: "" }), "UTC", NOW),
      classifyPost(facts("c", {}, { format: "Carousel" }), "UTC", NOW),
      classifyPost(facts("v", {}, { format: "Reel" }), "UTC", NOW),
      classifyPost(facts("f", { requests: [{ status: "needs_filming", created_at: "2026-11-02T08:00:00Z" }] }, { format: "Reel" }), "UTC", NOW),
      classifyPost(facts("d", { hasDesign: true }), "UTC", NOW),
    ];
    const copies = new Map([["a", "x"], ["b", ""], ["c", "x"], ["v", "x"], ["f", "x"], ["d", "x"]]);
    const keys = ["a", "b", "c", "v", "f", "d"];
    expect(weekCounts(keys.map((k, i) => ({ post_key: k, copy: copies.get(k)!, result: list[i] })))).toEqual({ single: 2, carousel: 1, video: 1, copy_waits: 1, filming: 1 });
  });
});

describe("mergeIntoRun", () => {
  const eligible = (key: string) => ({ post_key: key, kind: "single" as const, postAt: new Date("2026-11-05T09:00:00Z") });

  it("queues every eligible post on the first press, naming who pressed", () => {
    const { posts, added } = mergeIntoRun([], [eligible("a"), eligible("b")], by, NOW);
    expect(added).toEqual(["a", "b"]);
    expect(posts.map((p) => [p.post_key, p.state, p.added_by])).toEqual([["a", "queued", by], ["b", "queued", by]]);
  });

  it("adds only newly eligible posts on a second press, by anyone", () => {
    const first = mergeIntoRun([], [eligible("a")], by, NOW).posts;
    const again = mergeIntoRun(first, [eligible("a")], "person-2", NOW);
    expect(again.added).toEqual([]);
    expect(again.posts).toEqual(first);
    const later = mergeIntoRun(first, [eligible("a"), eligible("new")], "person-2", NOW);
    expect(later.added).toEqual(["new"]);
    expect(later.posts.find((p) => p.post_key === "new")?.added_by).toBe("person-2");
    expect(later.posts.find((p) => p.post_key === "a")?.added_by).toBe(by);
  });

  it("queues again a post of the run that ended without a design and is eligible again", () => {
    const run = [queued("a", { state: "started", request_id: "r1" }), queued("b", { state: "left_out", why: "passed" })];
    const { posts, added } = mergeIntoRun(run, [eligible("a")], "person-2", NOW);
    expect(added).toEqual(["a"]);
    expect(posts.find((p) => p.post_key === "a")).toMatchObject({ state: "queued", added_by: "person-2", request_id: null });
    expect(posts.find((p) => p.post_key === "b")).toMatchObject({ state: "left_out" });
  });
});

describe("planPass", () => {
  const run = (id: string, client: string, posts: RunPost[], revising = false) => ({ id, client_id: client, posts, revising });
  const base = (over: Partial<Parameters<typeof planPass>[0]> = {}) => ({
    now: NOW, room: WEEK_AT_ONCE, runs: [], facts: new Map(), zones: new Map(), planning: new Set<string>(), preparing: new Set<string>(),
    settings: new Set(["c1", "c2", "c3"]), clipAffordable: true, ...over,
  });

  it("starts the soonest posts across every running week, two at a time across the app", () => {
    const runs = [
      run("r1", "c1", [queued("late", { post_at: "2026-11-07T09:00:00.000Z" })]),
      run("r2", "c2", [queued("soon", { post_at: "2026-11-04T09:00:00.000Z" })]),
      run("r3", "c3", [queued("mid", { post_at: "2026-11-05T09:00:00.000Z" })]),
    ];
    const f = new Map<string, PostFacts | null>([
      ["c1|late", facts("late", {}, { post_date: "2026-11-07" })],
      ["c2|soon", facts("soon", {}, { post_date: "2026-11-04" })],
      ["c3|mid", facts("mid", {}, { post_date: "2026-11-05" })],
    ]);
    const out = planPass(base({ runs, facts: f }));
    expect(out.starts.map((s) => s.post_key)).toEqual(["soon", "mid"]);
    expect(out.starts[0]).toMatchObject({ runId: "r2", client_id: "c2", copy: "Copy for soon", added_by: by, route: null, askFilming: false });
    // Week posts already designing take their places.
    expect(planPass(base({ runs, facts: f, room: 1 })).starts.map((s) => s.post_key)).toEqual(["soon"]);
    expect(planPass(base({ runs, facts: f, room: 0 })).starts).toEqual([]);
  });

  it("starts one post per client at a time, and none while one of the client's requests is planning", () => {
    const runs = [run("r1", "c1", [queued("a", { post_at: "2026-11-04T09:00:00.000Z" }), queued("b")])];
    const f = new Map<string, PostFacts | null>([["c1|a", facts("a", {}, { post_date: "2026-11-04" })], ["c1|b", facts("b")]]);
    expect(planPass(base({ runs, facts: f })).starts.map((s) => s.post_key)).toEqual(["a"]);
    expect(planPass(base({ runs, facts: f, planning: new Set(["c1"]) })).starts).toEqual([]);
  });

  it("starts nothing while the week is being revised", () => {
    const runs = [run("r1", "c1", [queued("a")], true)];
    const out = planPass(base({ runs, facts: new Map([["c1|a", facts("a")]]) }));
    expect(out.starts).toEqual([]);
    expect(out.runs.get("r1")?.[0].state).toBe("queued");
    expect(out.finished).toEqual([]);
  });

  it("keeps a post whose copy is not written yet queued, and leaves it out once its time passes", () => {
    const runs = [run("r1", "c1", [queued("a")])];
    const waiting = planPass(base({ runs, facts: new Map([["c1|a", facts("a", { copy: "  " })]]) }));
    expect(waiting.starts).toEqual([]);
    expect(waiting.runs.get("r1")?.[0]).toMatchObject({ state: "queued", waits_for: "copy" });
    const passed = planPass(base({ runs, facts: new Map([["c1|a", facts("a", { copy: "" }, { post_date: "2026-11-02" })]]) }));
    expect(passed.runs.get("r1")?.[0]).toMatchObject({ state: "left_out", why: "passed" });
    expect(passed.finished).toEqual(["r1"]);
  });

  it("checks each post again at its start: removed, designed or given media in the meantime, it leaves", () => {
    const runs = [run("r1", "c1", [queued("gone"), queued("designed"), queued("media")])];
    const f = new Map<string, PostFacts | null>([["c1|gone", null], ["c1|designed", facts("designed", { hasDesign: true })], ["c1|media", facts("media", { otherMedia: true })]]);
    const out = planPass(base({ runs, facts: f }));
    expect(out.starts).toEqual([]);
    expect(out.runs.get("r1")?.map((p) => [p.post_key, p.state, p.why])).toEqual([["gone", "left_out", "removed"], ["designed", "left_out", "designed"], ["media", "left_out", "media_in_use"]]);
    expect(out.finished).toEqual(["r1"]);
  });

  it("holds a video while the Higgsfield balance cannot cover a clip, and lets other posts go ahead", () => {
    const runs = [run("r1", "c1", [queued("v", { kind: "video", post_at: "2026-11-04T09:00:00.000Z" })]), run("r2", "c2", [queued("s")])];
    const f = new Map<string, PostFacts | null>([["c1|v", facts("v", {}, { format: "Reel", post_date: "2026-11-04" })], ["c2|s", facts("s")]]);
    const out = planPass(base({ runs, facts: f, clipAffordable: false }));
    expect(out.starts.map((s) => s.post_key)).toEqual(["s"]);
    expect(out.runs.get("r1")?.[0].state).toBe("queued");
  });

  it("leaves out a client's posts once its design settings are gone", () => {
    const runs = [run("r1", "c1", [queued("a")])];
    const out = planPass(base({ runs, facts: new Map([["c1|a", facts("a")]]), settings: new Set() }));
    expect(out.runs.get("r1")?.[0]).toMatchObject({ state: "left_out", why: "not_set_up" });
  });

  it("finishes a run once nothing is queued and none of its posts is still being prepared", () => {
    const started = queued("a", { state: "started", request_id: "req-a" });
    const runs = [run("r1", "c1", [started, queued("f", { state: "filming", request_id: "req-f" })])];
    expect(planPass(base({ runs, preparing: new Set(["req-a"]) })).finished).toEqual([]);
    expect(planPass(base({ runs })).finished).toEqual(["r1"]);
  });
});

describe("runFinished", () => {
  it("is true when nothing is queued and no started post is being prepared", () => {
    expect(runFinished([queued("a")], new Set())).toBe(false);
    expect(runFinished([queued("a", { state: "started", request_id: "r" })], new Set(["r"]))).toBe(false);
    expect(runFinished([queued("a", { state: "started", request_id: "r" }), queued("b", { state: "left_out", why: "stopped" })], new Set())).toBe(true);
  });
});

describe("keepStarts", () => {
  it("records the posts a pass started on a run that was stopped meanwhile, and nothing else", () => {
    const stopped = [queued("a", { state: "left_out", why: "stopped" }), queued("b", { state: "left_out", why: "stopped" })];
    const pass = [queued("a", { state: "started", request_id: "req-a", started_at: NOW.toISOString() }), queued("b", { state: "queued", waits_for: "copy" })];
    expect(keepStarts(stopped, pass).map((p) => [p.post_key, p.state, p.request_id ?? null])).toEqual([["a", "started", "req-a"], ["b", "left_out", null]]);
  });
});
