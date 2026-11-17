import { describe, expect, it } from "vitest";
import { sproutCandidates } from "../../../functions/_shared/brand-references/candidates";
import {
  captionHash, carriedCandidates, choicesKey, type CorpusInput, goneReviews, readVerdict, LIBRARY_MAX, LIBRARY_RULE, occasionPosts, PER_PLATFORM, PIPELINE_VERSION, relearnReason, type Review, REVIEW_RULE, reviewCounts,
  reviewQueue, selectLibrary, siblings,
} from "../../../functions/_shared/brand-references/corpus";

// Mon 2 Nov 2026: the 90-day window runs from Aug 4.
const NOW = new Date("2026-11-02T10:00:00Z");
const NETWORK: Record<string, string> = { ig: "INSTAGRAM", li: "LINKEDIN_COMPANY", fb: "FACEBOOK", tt: "TIKTOK" };

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
/** A Sprout analytics/posts row as the posts endpoint sends it. */
const row = (guid: string, day: string, over: Row = {}): Row => ({
  guid, perma_link: `https://social.example/${guid}`, customer_profile_id: "7", network: NETWORK[guid.split(":")[0]] ?? "INSTAGRAM",
  created_time: `${day}T15:00:00Z`, content_category: "PHOTO", visual_media: [{ media_type: "PHOTO", media_url: `https://network-media.sproutsocial.com/${guid}.jpg` }], ...over,
});
const designed = (guid: string, day: string, over: Partial<Review> = {}): Review => ({
  source_post_id: guid, network: NETWORK[guid.split(":")[0]] ?? "INSTAGRAM", posted_at: `${day}T15:00:00Z`, source_url: `https://social.example/${guid}`,
  content_hash: `h-${guid}`, verdict: "designed", path: `c1/social-${guid.replace(":", "-")}.jpg`, confidence: 0.92, reason: "Branded type over a color block", reviewed_at: "2026-10-01T00:00:00Z",
  kind: "everyday", occasion: null, evidence: null, caption_hash: null, rule: 2, ...over,
});
/** A designed post the reviewer said was made for an occasion. */
const occasion = (guid: string, day: string, over: Partial<Review> = {}): Review =>
  designed(guid, day, { kind: "occasion", occasion: "holiday", evidence: "Happy Halloween from Harbor Coffee", ...over });
const plain = (guid: string, day: string): Review => ({ ...designed(guid, day), verdict: "not_designed", path: null, reason: "A plain photograph", kind: null });
const pathOf = (guid: string) => `c1/social-${guid.replace(":", "-")}.jpg`;
const days = (n: number, from = "2026-10-31") => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) - i * 86400_000).toISOString().slice(0, 10));

function input(rows: Row[], reviews: Review[], over: Partial<CorpusInput> = {}): CorpusInput {
  return { candidates: sproutCandidates(rows, ["7"]), reviews, choices: {}, uploads: [], previous: [], lookSince: null, profilePlatforms: [], now: NOW, ...over };
}

describe("which posts count", () => {
  it("are the client's organic designed posts: no boosted posts, Stories, text, links or videos", () => {
    const found = sproutCandidates([
      row("ig:1", "2026-10-30"),
      row("ig:2", "2026-10-29", { is_boosted: true }),
      row("igst:3", "2026-10-28"),
      row("li:4", "2026-10-27", { content_category: "TEXT", visual_media: [] }),
      row("fb:5", "2026-10-26", { content_category: "LINK" }),
      row("tt:6", "2026-10-25", { content_category: "VIDEO", visual_media: [{ media_type: "VIDEO", media_url: "https://network-media.sproutsocial.com/tt6.mp4" }] }),
      row("li:7", "2026-10-24", { content_category: "ALBUM" }),
    ], ["7"]);
    expect(found.map((c) => c.source_post_id)).toEqual(["ig:1", "li:7"]);
    expect(found.map((c) => c.platform)).toEqual(["Instagram", "LinkedIn"]);
  });

  it("take one frame per post", () => {
    const album = row("ig:1", "2026-10-30", { content_category: "ALBUM", visual_media: [
      { media_type: "PHOTO", media_url: "https://network-media.sproutsocial.com/first.jpg" }, { media_type: "PHOTO", media_url: "https://network-media.sproutsocial.com/second.jpg" }] });
    const found = sproutCandidates([album], ["7"]);
    expect(found).toHaveLength(1);
    expect(found[0].image_url).toBe("https://network-media.sproutsocial.com/first.jpg");
  });

  it("are ordered by the date they were posted, never by how many people saw them", () => {
    const found = sproutCandidates([
      row("ig:old", "2026-08-10", { metrics: { "lifetime.impressions": 90000 } }),
      row("ig:new", "2026-10-30", { metrics: { "lifetime.impressions": 12 } }),
      row("ig:mid", "2026-09-15", { metrics: { "lifetime.impressions": 4000 } }),
    ], ["7"]);
    expect(found.map((c) => c.source_post_id)).toEqual(["ig:new", "ig:mid", "ig:old"]);
  });
});

describe("the library", () => {
  it("keeps 6 per platform and 16 overall, newest first, taken in turn across platforms", () => {
    const platforms = ["ig", "li", "fb", "tt"];
    const rows: Row[] = [], reviews: Review[] = [];
    // Instagram posted most recently, then LinkedIn, Facebook and TikTok; each has 8 designed posts.
    platforms.forEach((p, k) => days(8, `2026-10-${31 - k}`).forEach((d, i) => { rows.push(row(`${p}:${i}`, d)); reviews.push(designed(`${p}:${i}`, d)); }));
    const sel = selectLibrary(input(rows, reviews));
    expect(sel.library).toHaveLength(LIBRARY_MAX);
    expect(sel.library.slice(0, 5).map((e) => e.path)).toEqual([pathOf("ig:0"), pathOf("li:0"), pathOf("fb:0"), pathOf("tt:0"), pathOf("ig:1")]);
    for (const p of ["Instagram", "LinkedIn", "Facebook", "TikTok"]) {
      expect(sel.library.filter((e) => e.platform === p)).toHaveLength(4);
      expect(sel.platforms[p]).toMatchObject({ posts: PER_PLATFORM, own_rules: true });
    }
    expect(sel.platforms.Instagram.newest).toBe("2026-10-31T15:00:00Z");
    expect(sel.library.every((e) => e.quality_checked === true)).toBe(true);
  });

  it("puts kept posts first, keeps them past 90 days, and puts the client's uploads first of all", () => {
    const rows = days(7).map((d, i) => row(`ig:${i}`, d));
    const reviews = [...days(7).map((d, i) => designed(`ig:${i}`, d)), designed("ig:summer", "2026-06-20")];
    const sel = selectLibrary(input(rows, reviews, { choices: { [pathOf("ig:summer")]: "kept" }, uploads: ["c1/uploads/flyer.png"] }));
    expect(sel.library.map((e) => e.path)).toEqual(["c1/uploads/flyer.png", pathOf("ig:summer"), ...[0, 1, 2, 3, 4].map((i) => pathOf(`ig:${i}`))]);
    expect(sel.library[0]).toMatchObject({ upload: true, kept: true });
    expect(sel.library[1]).toMatchObject({ kept: true, platform: "Instagram", posted_at: "2026-06-20T15:00:00Z" });
  });

  it("never brings back a post or an upload a person left out", () => {
    const rows = days(4).map((d, i) => row(`ig:${i}`, d));
    const reviews = days(4).map((d, i) => designed(`ig:${i}`, d));
    const sel = selectLibrary(input(rows, reviews, {
      choices: { [pathOf("ig:0")]: "left_out", "c1/uploads/old.png": "left_out" }, uploads: ["c1/uploads/old.png"],
      previous: [{ path: pathOf("ig:0"), quality_checked: true, platform: "INSTAGRAM", posted_at: "2026-10-31T15:00:00Z" }],
    }));
    expect(sel.library.map((e) => e.path)).toEqual([pathOf("ig:1"), pathOf("ig:2"), pathOf("ig:3")]);
  });

  it("never shrinks below 3 by age alone, and fills only from everyday posts: an old post made for an occasion does not come back", () => {
    // One new everyday post in the window; four from the summer aged out of it, the newest of them made for a holiday.
    const old = ["06-10", "06-12", "06-14", "06-16"].map((d, i) => ({ guid: `ig:old${i}`, day: `2026-${d}` }));
    const previous = old.map((o) => ({ path: pathOf(o.guid), source_post_id: o.guid, platform: "INSTAGRAM", posted_at: `${o.day}T15:00:00Z`, quality_checked: true }));
    const reviews = [designed("ig:new", "2026-10-30"), designed("ig:old0", old[0].day), designed("ig:old1", old[1].day), designed("ig:old2", old[2].day), occasion("ig:old3", old[3].day)];
    const sel = selectLibrary(input([row("ig:new", "2026-10-30")], reviews, { previous }));
    expect(sel.library.map((e) => e.path)).toEqual([pathOf("ig:new"), pathOf("ig:old2"), pathOf("ig:old1")]);
    expect(sel.enough).toBe(true);
    // A stored post no review answers for (an older library) does not fill either.
    const unknown = [{ path: "c1/social-unknown.jpg", platform: "INSTAGRAM", posted_at: "2026-06-20T15:00:00Z", quality_checked: true }];
    expect(selectLibrary(input([row("ig:new", "2026-10-30")], [designed("ig:new", "2026-10-30")], { previous: unknown })).library.map((e) => e.path)).toEqual([pathOf("ig:new")]);
  });

  it("leaves out posts from before a new look, except kept ones", () => {
    const rows = ["10-30", "10-25", "10-21", "10-15", "10-10"].map((d, i) => row(`ig:${i}`, `2026-${d}`));
    const reviews = ["10-30", "10-25", "10-21", "10-15", "10-10"].map((d, i) => designed(`ig:${i}`, `2026-${d}`));
    const sel = selectLibrary(input(rows, reviews, { lookSince: "2026-10-20", choices: { [pathOf("ig:4")]: "kept" } }));
    expect(sel.library.map((e) => e.path)).toEqual([pathOf("ig:4"), pathOf("ig:0"), pathOf("ig:1"), pathOf("ig:2")]);
  });
});

describe("minimum samples", () => {
  it("gives a platform rules of its own at 4 posts; with 3 it borrows", () => {
    const rows = [...days(5).map((d, i) => row(`ig:${i}`, d)), ...days(3).map((d, i) => row(`li:${i}`, d))];
    const reviews = [...days(5).map((d, i) => designed(`ig:${i}`, d)), ...days(3).map((d, i) => designed(`li:${i}`, d))];
    const sel = selectLibrary(input(rows, reviews, { profilePlatforms: ["Instagram", "LinkedIn", "TikTok"] }));
    expect(sel.platforms).toEqual({
      Instagram: { posts: 5, newest: "2026-10-31T15:00:00Z", own_rules: true },
      LinkedIn: { posts: 3, newest: "2026-10-31T15:00:00Z", own_rules: false },
      TikTok: { posts: 0, newest: null, own_rules: false },
    });
  });

  it("with 2 everyday posts in all, there is not enough", () => {
    const previous = [{ path: pathOf("ig:a"), source_post_id: "ig:a", quality_checked: true, platform: "INSTAGRAM", posted_at: "2026-07-01T15:00:00Z" }];
    const sel = selectLibrary(input([row("ig:1", "2026-10-30"), row("ig:2", "2026-10-29"), row("ig:3", "2026-10-28")], [designed("ig:1", "2026-10-30"), plain("ig:2", "2026-10-29"), designed("ig:3", "2026-10-28")]));
    expect(sel.enough).toBe(false);
    expect(sel.library).toHaveLength(2);
    expect(sel).toMatchObject({ owner: "app", suggestions: [] });
    // With an everyday post in the previous library to fill from, age alone does not leave it short.
    const two = [row("ig:1", "2026-10-30"), row("ig:3", "2026-10-28")];
    expect(selectLibrary(input(two, [designed("ig:1", "2026-10-30"), designed("ig:3", "2026-10-28"), designed("ig:a", "2026-07-01")], { previous })).enough).toBe(true);
  });

  it("counts cross-posts of one post once: three of them are not enough, three different posts are", () => {
    const caption = captionHash("Our new autumn menu is here. Come in and try the maple latte today.");
    const guids = ["ig:1", "li:1", "fb:1"];
    const rows = guids.map((g) => row(g, "2026-10-30"));
    const same = selectLibrary(input(rows, guids.map((g) => designed(g, "2026-10-30", { caption_hash: caption }))));
    expect(same.library).toHaveLength(3);
    expect(same.enough).toBe(false);
    const different = selectLibrary(input(rows, guids.map((g) => designed(g, "2026-10-30"))));
    expect(different.library).toHaveLength(3);
    expect(different.enough).toBe(true);
  });
});

describe("whose library it is (the library's rules, 17 Nov 2026)", () => {
  const rows = days(5).map((d, i) => row(`ig:${i}`, d));
  const reviews = [...days(5).map((d, i) => designed(`ig:${i}`, d)), designed("ig:summer", "2026-06-20")];

  it("is the team's alone at 3 chosen references: exactly those, in that order, with the everyday posts offered", () => {
    const sel = selectLibrary(input(rows, reviews, { uploads: ["c1/uploads/flyer.png", "c1/uploads/menu.png"], choices: { [pathOf("ig:summer")]: "kept" }, profilePlatforms: ["Instagram", "LinkedIn"] }));
    expect(sel.owner).toBe("person");
    expect(sel.library.map((e) => e.path)).toEqual(["c1/uploads/flyer.png", "c1/uploads/menu.png", pathOf("ig:summer")]);
    expect(sel.suggestions.map((e) => e.path)).toEqual([0, 1, 2, 3, 4].map((i) => pathOf(`ig:${i}`)));
    expect(sel.enough).toBe(true);
    // Its lines count the posts the team kept, never the posts on offer.
    expect(sel.platforms).toEqual({ Instagram: { posts: 1, newest: "2026-06-20T15:00:00Z", own_rules: false }, LinkedIn: { posts: 0, newest: null, own_rules: false } });
  });

  it("offers at most 8 posts, and none the team left out or already chose", () => {
    const many = [...days(6).map((d, i) => `ig:${i}`), ...days(6).map((d, i) => `li:${i}`)];
    const all = many.map((g, i) => ({ g, d: days(6)[i % 6] }));
    const sel = selectLibrary(input(all.map((x) => row(x.g, x.d)), all.map((x) => designed(x.g, x.d)), {
      uploads: ["c1/uploads/a.png", "c1/uploads/b.png", "c1/uploads/c.png"], choices: { [pathOf("ig:0")]: "left_out", [pathOf("li:0")]: "kept" },
    }));
    expect(sel.library.map((e) => e.path)).toEqual(["c1/uploads/a.png", "c1/uploads/b.png", "c1/uploads/c.png", pathOf("li:0")]);
    expect(sel.suggestions).toHaveLength(8);
    expect(sel.suggestions.map((e) => e.path)).not.toContain(pathOf("ig:0"));
    expect(sel.suggestions.map((e) => e.path)).not.toContain(pathOf("li:0"));
  });

  it("with 2 chosen references, pins them inside the automatic library", () => {
    const sel = selectLibrary(input(rows, reviews, { uploads: ["c1/uploads/flyer.png"], choices: { [pathOf("ig:summer")]: "kept" } }));
    expect(sel.owner).toBe("app");
    expect(sel.library.map((e) => e.path)).toEqual(["c1/uploads/flyer.png", pathOf("ig:summer"), ...[0, 1, 2, 3, 4].map((i) => pathOf(`ig:${i}`))]);
    expect(sel.suggestions).toEqual([]);
  });

  it("returns to automatic when an upload is left out so that 2 remain", () => {
    const uploads = ["c1/uploads/a.png", "c1/uploads/b.png", "c1/uploads/c.png"];
    expect(selectLibrary(input(rows, reviews, { uploads })).owner).toBe("person");
    const sel = selectLibrary(input(rows, reviews, { uploads, choices: { "c1/uploads/c.png": "left_out", "c1/uploads/a.png": "kept" } }));
    expect(sel.owner).toBe("app");
    expect(sel.library.map((e) => e.path)).toEqual(["c1/uploads/a.png", "c1/uploads/b.png", ...[0, 1, 2, 3, 4].map((i) => pathOf(`ig:${i}`))]);
  });
});

describe("everyday posts only (the library's rules, 17 Nov 2026)", () => {
  const four = days(4);

  it("never takes a post made for an occasion, one with no answer, or one answered under the old question", () => {
    const rows = ["ig:plain", "ig:halloween", "ig:silent", "ig:old", "ig:also"].map((g, i) => row(g, days(5)[i]));
    const reviews = [
      designed("ig:plain", days(5)[0]),
      occasion("ig:halloween", days(5)[1]),
      designed("ig:silent", days(5)[2], { kind: null, reviewed_at: "2026-10-30T00:00:00Z" }),
      // Reviewed yesterday under the old question: asked again at once, with no week's wait.
      designed("ig:old", days(5)[3], { rule: 1, kind: undefined, reviewed_at: "2026-11-01T10:00:00Z" }),
      designed("ig:also", days(5)[4]),
    ];
    const i = input(rows, reviews);
    expect(selectLibrary(i).library.map((e) => e.source_post_id)).toEqual(["ig:plain", "ig:also"]);
    // The one answered under the old question is asked once more; the one with no answer waits its week.
    expect(reviewQueue(i).map((c) => c.source_post_id)).toEqual(["ig:old"]);
    expect([REVIEW_RULE, LIBRARY_RULE, PIPELINE_VERSION]).toEqual([2, 2, 3]);
    // An answer stored under the old question does not count, whatever it says.
    const stale = [designed("ig:plain", days(5)[0]), designed("ig:old", days(5)[3], { rule: 1, kind: "everyday" })];
    expect(selectLibrary(input(rows, stale)).library.map((e) => e.source_post_id)).toEqual(["ig:plain"]);
  });

  it("takes an occasion post a person kept", () => {
    const rows = four.map((d, i) => row(`ig:${i}`, d));
    const reviews = [occasion("ig:0", four[0]), ...four.slice(1).map((d, i) => designed(`ig:${i + 1}`, d))];
    expect(selectLibrary(input(rows, reviews)).library.map((e) => e.source_post_id)).toEqual(["ig:1", "ig:2", "ig:3"]);
    const kept = selectLibrary(input(rows, reviews, { choices: { [pathOf("ig:0")]: "kept" } }));
    expect(kept.library.map((e) => e.source_post_id)).toEqual(["ig:0", "ig:1", "ig:2", "ig:3"]);
    expect(kept.library[0]).toMatchObject({ kept: true });
  });

  it("gives an occasion post no slot in the review queue, so the next older post is reviewed", () => {
    const rows = days(8).map((d, i) => row(`ig:${i}`, d));
    const six = days(6).map((d, i) => designed(`ig:${i}`, d));
    expect(reviewQueue(input(rows, six))).toEqual([]);
    const withOccasion = [occasion("ig:0", days(8)[0]), ...six.slice(1)];
    expect(reviewQueue(input(rows, withOccasion)).map((c) => c.source_post_id)).toEqual(["ig:6"]);
  });

  it("gives a cross-post its sibling's occasion answer within 3 days, and not 4 days apart", () => {
    const caption = captionHash("Happy Halloween from all of us at Harbor Coffee! Trick or treat at the counter.");
    const rows = [row("ig:1", "2026-10-30"), row("fb:1", "2026-10-31"), row("li:1", "2026-10-29"), row("li:2", "2026-10-28")];
    const near = [occasion("ig:1", "2026-10-30", { caption_hash: caption }), designed("fb:1", "2026-10-31", { caption_hash: caption }), designed("li:1", "2026-10-29"), designed("li:2", "2026-10-28")];
    expect(siblings(near).get("fb:1")).toMatchObject({ kind: "occasion", occasion: "holiday", disagreement: true });
    expect(siblings(near).get("fb:1")!.group).toBe(siblings(near).get("ig:1")!.group);
    expect(selectLibrary(input(rows, near)).library.map((e) => e.source_post_id)).toEqual(["li:1", "li:2"]);
    // The same caption 4 days later is another post: it keeps its own answer.
    const far = [occasion("ig:1", "2026-10-27", { caption_hash: caption }), designed("fb:1", "2026-10-31", { caption_hash: caption }), designed("li:1", "2026-10-29"), designed("li:2", "2026-10-28")];
    expect(siblings(far).get("fb:1")).toMatchObject({ kind: "everyday", occasion: null, disagreement: false });
    expect(selectLibrary(input([row("ig:1", "2026-10-27"), ...rows.slice(1)], far)).library.map((e) => e.source_post_id)).toContain("fb:1");
    // A sibling with no answer of its own takes the everyday answer too.
    const silent = [designed("ig:1", "2026-10-30", { caption_hash: caption }), designed("fb:1", "2026-10-31", { caption_hash: caption, kind: null })];
    expect(siblings(silent).get("fb:1")).toMatchObject({ kind: "everyday" });
  });

  it("never lets the same stored image in through another post of it once one post of it is an occasion", () => {
    const rows = [row("ig:1", "2026-10-30"), row("fb:1", "2026-10-20"), row("li:1", "2026-10-29")];
    const reviews = [occasion("ig:1", "2026-10-30", { path: "c1/social-shared.jpg" }), designed("fb:1", "2026-10-20", { path: "c1/social-shared.jpg" }), designed("li:1", "2026-10-29")];
    expect(selectLibrary(input(rows, reviews)).library.map((e) => e.path)).toEqual([pathOf("li:1")]);
  });

  it("lists the occasion posts left out, newest first, and counts what the window's posts came to", () => {
    const caption = captionHash("Our team is at the Harbor Street Fair this Saturday. Come say hello to us.");
    const rows = [row("ig:1", "2026-10-30"), row("fb:1", "2026-10-30"), row("ig:2", "2026-10-28"), row("ig:3", "2026-10-26"), row("ig:4", "2026-10-24"), row("ig:5", "2026-10-22"), row("ig:6", "2026-10-21")];
    const reviews = [
      occasion("ig:1", "2026-10-30", { caption_hash: caption, occasion: "event", evidence: "this Saturday" }), designed("fb:1", "2026-10-30", { caption_hash: caption }),
      occasion("ig:2", "2026-10-28", { occasion: "contest", evidence: "word search" }), designed("ig:3", "2026-10-26"), designed("ig:4", "2026-10-24", { kind: null }),
      occasion("ig:5", "2026-10-22"), occasion("ig:6", "2026-10-21"),
    ];
    const i = input(rows, reviews, { choices: { [pathOf("ig:5")]: "kept", [pathOf("ig:6")]: "left_out" } });
    expect(reviewCounts(i)).toEqual({ everyday: 1, occasion: 5, unanswered: 1, sibling_disagreements: 1 });
    // The kept one is in the library and the one left out is in its own list: neither is listed here.
    expect(occasionPosts(i).map((e) => [e.source_post_id, e.occasion])).toEqual([["ig:1", "event"], ["fb:1", "event"], ["ig:2", "contest"]]);
    expect(occasionPosts(i)[0]).toMatchObject({ path: pathOf("ig:1"), platform: "Instagram", posted_at: "2026-10-30T15:00:00Z", source_url: "https://social.example/ig:1" });
  });
});

describe("a caption's key", () => {
  it("is the same for one caption posted with other hashtags, mentions and links, and absent for a short caption", () => {
    const a = captionHash("Fresh beans roasted every morning at Harbor Coffee. Stop by! #coffee #harbor https://harbor.example/menu");
    const b = captionHash("Fresh beans roasted every morning at Harbor Coffee... stop by @harborcoffee #latte www.harbor.example");
    expect(a).toBeTruthy();
    expect(a).toBe(b);
    expect(captionHash("Fresh beans roasted every evening at Harbor Coffee. Stop by!")).not.toBe(a);
    expect(captionHash("Stop by! #coffee")).toBeNull();
    expect(captionHash(null)).toBeNull();
  });
});

describe("posts that are no longer the client's (rule 6)", () => {
  const window = { since: new Date("2026-08-04T10:00:00Z"), until: NOW };
  // One Instagram account (profile 7) and one LinkedIn account (profile 8), both active.
  const BOTH = [{ id: "7", network: "fb_instagram_account" }, { id: "8", network: "linkedin_company" }];
  const on = (profile: string, over: Partial<Review> = {}) => ({ profile_id: profile, ...over });
  const reviews = [
    designed("ig:here", "2026-10-30", on("7")), designed("ig:gone", "2026-10-20", on("7")), designed("ig:kept", "2026-10-10", on("7")),
    designed("ig:summer", "2026-06-20", on("7")), designed("ig:undated", "2026-10-01", on("7", { posted_at: null })), { ...plain("ig:photo", "2026-09-01"), profile_id: "7" },
    designed("li:quiet", "2026-10-15", on("8")),
  ];
  const kept = new Set([pathOf("ig:kept")]);
  const ids = (found: Review[]) => found.map((r) => r.source_post_id);

  it("go when their account answered and they are absent inside the days the read reached; a kept one, one outside the window and one with no date stay", () => {
    // Instagram answered with two posts, the older from Aug 20: everything of it since then that is missing is gone.
    const rows = [row("ig:here", "2026-10-30"), row("ig:first", "2026-08-20")];
    expect(ids(goneReviews(reviews, rows, BOTH, window, kept))).toEqual(["ig:gone", "ig:photo"]);
  });

  it("never go because an active account returned nothing: that read is not trusted", () => {
    // LinkedIn is active and the read holds none of its posts: its review stays, whatever Instagram returned.
    const rows = [row("ig:here", "2026-10-30"), row("ig:first", "2026-08-20")];
    expect(ids(goneReviews(reviews, rows, BOTH, window, kept))).not.toContain("li:quiet");
    // A read that returned nothing at all removes nothing at all.
    expect(goneReviews(reviews, [], BOTH, window, kept)).toEqual([]);
    // Rows of some other client's account are not an answer either.
    expect(goneReviews(reviews, [row("ig:else", "2026-10-30", { customer_profile_id: "99" })], BOTH, window, kept)).toEqual([]);
  });

  it("never go because a read stopped short: nothing older than its oldest post is judged", () => {
    // The read came back with only its newest page, down to Oct 25. A post from Oct 20 may simply be on the next page.
    const rows = [row("ig:here", "2026-10-30"), row("ig:page-end", "2026-10-25")];
    expect(goneReviews(reviews, rows, BOTH, window, kept)).toEqual([]);
    // Once the read reaches Oct 20, that post's absence is known.
    expect(ids(goneReviews(reviews, [...rows, row("ig:older", "2026-10-18")], BOTH, window, kept))).toEqual(["ig:gone"]);
  });

  it("go when their account is no longer one of the client's active accounts, whatever the read returned", () => {
    // LinkedIn was parked: only Instagram is active.
    const onlyInstagram = [BOTH[0]];
    expect(ids(goneReviews(reviews, [row("ig:here", "2026-10-30")], onlyInstagram, window, kept))).toEqual(["li:quiet"]);
    expect(ids(goneReviews(reviews, [], onlyInstagram, window, kept))).toEqual(["li:quiet"]);
    // A second Instagram account that was parked: its posts go, the active account's stay.
    const second = designed("ig:second-account", "2026-10-22", on("70"));
    expect(ids(goneReviews([...reviews, second], [], BOTH, window, kept))).toEqual(["ig:second-account"]);
    // A kept post of a parked account stays.
    expect(goneReviews([...reviews, second], [], BOTH, window, new Set([...kept, second.path!]))).toEqual([]);
  });

  it("judge a row from before the account was stored by its network, the same way", () => {
    const old = [designed("ig:here", "2026-10-30"), designed("ig:gone", "2026-10-20"), designed("li:quiet", "2026-10-15"), designed("tt:parked", "2026-10-12"), designed("ig:unknown", "2026-10-11", { network: "" })];
    const rows = [row("ig:here", "2026-10-30"), row("ig:first", "2026-08-20")];
    // Instagram answered: its missing post goes. LinkedIn is active and silent: it stays. No TikTok account is active: it goes. A row with no network is never judged.
    expect(ids(goneReviews(old, rows, BOTH, window, new Set()))).toEqual(["ig:gone", "tt:parked"]);
  });
});

describe("what a read proves nothing about keeps its place", () => {
  const window = { since: new Date("2026-08-04T10:00:00Z"), until: NOW };
  const BOTH = [{ id: "7", network: "fb_instagram_account" }, { id: "8", network: "linkedin_company" }];
  const reviews = [
    designed("ig:here", "2026-10-30", { profile_id: "7" }), designed("ig:gone", "2026-10-20", { profile_id: "7" }), designed("ig:early", "2026-08-10", { profile_id: "7" }),
    designed("li:quiet", "2026-10-15", { profile_id: "8" }), { ...plain("li:photo", "2026-10-14"), profile_id: "8" }, designed("ig:summer", "2026-06-20", { profile_id: "7" }),
  ];

  it("a designed post of a silent account, or one older than the read reached, is carried into the library's selection; one proven gone is not", () => {
    const rows = [row("ig:here", "2026-10-30"), row("ig:other", "2026-09-01")];
    const verdict = readVerdict(reviews, rows, BOTH, window, new Set());
    expect(verdict.gone.map((r) => r.source_post_id)).toEqual(["ig:gone"]);
    // LinkedIn was silent, and the Aug 10 post is older than the read reached. A plain photo and a post outside the window are not carried.
    expect(verdict.unproven.map((c) => [c.source_post_id, c.carried])).toEqual([["li:quiet", true], ["ig:early", true]]);
    const sel = selectLibrary(input(rows, reviews.filter((r) => r.source_post_id !== "ig:gone"), { candidates: [...sproutCandidates(rows, ["7"]), ...verdict.unproven] }));
    expect(sel.library.map((e) => e.source_post_id).sort()).toEqual(["ig:early", "ig:here", "li:quiet"]);
  });

  it("an empty read, and a read cut at its cap, remove nothing and carry every designed post in the window", () => {
    const empty = readVerdict(reviews, [], BOTH, window, new Set());
    expect(empty.gone).toEqual([]);
    expect(empty.unproven.map((c) => c.source_post_id)).toEqual(["ig:here", "ig:gone", "li:quiet", "ig:early"]);
    const cut = readVerdict(reviews, [row("ig:here", "2026-10-30"), row("ig:other", "2026-09-01")], [BOTH[0]], window, new Set(), true);
    expect(cut.gone).toEqual([]);
    expect(cut.unproven.map((c) => c.source_post_id)).toEqual(["ig:gone", "li:quiet", "ig:early"]);
  });
});

describe("a check that goes on from an earlier run", () => {
  it("knows the posts it already read from their reviews, and never sends one to the reviewer again", () => {
    const reviews = [
      designed("ig:1", "2026-10-30"), occasion("ig:2", "2026-10-20"), designed("ig:3", "2026-09-10", { kind: null, reviewed_at: "2026-09-12T00:00:00Z" }),
      designed("ig:4", "2026-08-01", { rule: 1, kind: undefined }), plain("ig:5", "2026-10-25"), designed("ig:6", "2026-07-30"),
    ];
    const carried = carriedCandidates(reviews, "2026-08-01");
    // Designed posts from that day on, newest first; a plain photo and an older post are not among them.
    expect(carried.map((c) => c.source_post_id)).toEqual(["ig:1", "ig:2", "ig:3", "ig:4"]);
    expect(carried[0]).toMatchObject({ platform: "Instagram", posted_at: "2026-10-30T15:00:00Z", source_url: "https://social.example/ig:1", carried: true, image_url: "", text: "" });
    const i: CorpusInput = { candidates: carried, reviews, choices: {}, uploads: [], previous: [], lookSince: null, profilePlatforms: [], now: NOW };
    // Neither the one with no answer for over a week nor the one under the old question is asked: they have no caption here.
    expect(reviewQueue(i)).toEqual([]);
    expect(selectLibrary(i).library.map((e) => [e.source_post_id, e.platform, e.source_url])).toEqual([["ig:1", "Instagram", "https://social.example/ig:1"]]);
    expect(occasionPosts(i).map((e) => e.source_post_id)).toEqual(["ig:2"]);
    // A newly read post beside them is asked as usual.
    expect(reviewQueue({ ...i, candidates: [...carried, ...sproutCandidates([row("ig:new", "2026-07-20")], ["7"])] }).map((c) => c.source_post_id)).toEqual(["ig:new"]);
  });
});

describe("what is reviewed", () => {
  it("is only posts never reviewed, at most what each platform still needs, in turn across platforms", () => {
    const rows = [...days(9).map((d, i) => row(`ig:${i}`, d)), ...days(3).map((d, i) => row(`li:${i}`, d))];
    // Instagram's four newest were reviewed: three designed, one plain photo.
    const reviews = [designed("ig:0", days(9)[0]), plain("ig:1", days(9)[1]), designed("ig:2", days(9)[2]), designed("ig:3", days(9)[3])];
    const queue = reviewQueue(input(rows, reviews));
    // Instagram has 3 of its 6, so its next 3; LinkedIn all 3. Taken in turn.
    expect(queue.map((c) => c.source_post_id)).toEqual(["ig:4", "li:0", "ig:5", "li:1", "ig:6", "li:2"]);
    expect(reviewQueue(input(rows, reviews), 2)).toHaveLength(2);
  });

  it("leaves a platform alone once it has 6, and looks at an unreadable image again only on a later weekly check", () => {
    const rows = days(8).map((d, i) => row(`ig:${i}`, d));
    const full = days(6).map((d, i) => designed(`ig:${i}`, d));
    expect(reviewQueue(input(rows, full))).toEqual([]);
    const unreadable = (at: string): Review => ({ ...plain("ig:0", days(8)[0]), verdict: "unreadable", reviewed_at: at });
    const recent = [unreadable("2026-10-30T00:00:00Z"), ...full.slice(1)];
    expect(reviewQueue(input(rows, recent)).map((c) => c.source_post_id)).toEqual(["ig:6"]);
    const old = [unreadable("2026-10-20T00:00:00Z"), ...full.slice(1)];
    expect(reviewQueue(input(rows, old)).map((c) => c.source_post_id)).toEqual(["ig:0"]);
  });

  it("asks a post with no answer again only after a week, and never one that is not designed", () => {
    const rows = [row("ig:silent", "2026-10-30"), row("ig:photo", "2026-10-29")];
    const silent = (at: string) => [designed("ig:silent", "2026-10-30", { kind: null, reviewed_at: at }), { ...plain("ig:photo", "2026-10-29"), rule: 1, reviewed_at: "2026-08-01T00:00:00Z" }];
    // Reviewed 6 days and 23 hours before the check: not yet. Exactly 7 days before: asked again.
    expect(reviewQueue(input(rows, silent("2026-10-26T11:00:00Z")))).toEqual([]);
    expect(reviewQueue(input(rows, silent("2026-10-26T10:00:00Z"))).map((c) => c.source_post_id)).toEqual(["ig:silent"]);
  });

  it("skips posts from before a new look", () => {
    const rows = [row("ig:new", "2026-10-30"), row("ig:old", "2026-10-01")];
    expect(reviewQueue(input(rows, [], { lookSince: "2026-10-20" })).map((c) => c.source_post_id)).toEqual(["ig:new"]);
  });
});

describe("when the look is learned again", () => {
  const rows = days(6).map((d, i) => row(`ig:${i}`, d));
  const reviews = days(6).map((d, i) => designed(`ig:${i}`, d));
  const learned = (sel: ReturnType<typeof selectLibrary>, key = choicesKey({}, [])) => ({
    reference_pipeline_version: 3, choices_key: key, platforms: { Instagram: { rules: "r", posts: 6, learned_at: "2026-10-01T00:00:00Z" } },
    source_posts: sel.library.map((e) => ({ path: e.path })),
  });

  it("on the first check after this change, and never while nothing changed", () => {
    const sel = selectLibrary(input(rows, reviews));
    expect(relearnReason(sel, null, choicesKey({}, []))).toBe("first");
    expect(relearnReason(sel, { reference_pipeline_version: 1 }, choicesKey({}, []))).toBe("first");
    // A rulebook learned before the library's rules (version 2) is learned once more.
    expect(relearnReason(sel, { ...learned(sel), reference_pipeline_version: 2 }, choicesKey({}, []))).toBe("first");
    expect(relearnReason(sel, learned(sel), choicesKey({}, []))).toBeNull();
  });

  it("when the library changes by two posts, not by one", () => {
    const before = selectLibrary(input(rows, reviews));
    const one = selectLibrary(input([row("ig:new1", "2026-11-01"), ...rows], [designed("ig:new1", "2026-11-01"), ...reviews]));
    expect(relearnReason(one, learned(before), choicesKey({}, []))).toBeNull();
    const two = selectLibrary(input([row("ig:new1", "2026-11-01"), row("ig:new2", "2026-11-01"), ...rows], [designed("ig:new1", "2026-11-01"), designed("ig:new2", "2026-11-01"), ...reviews]));
    expect(relearnReason(two, learned(before), choicesKey({}, []))).toBe("posts");
  });

  it("when a platform reaches its minimum, and when a person keeps or leaves out a post or uploads one", () => {
    const sel = selectLibrary(input(rows, reviews));
    const withLinkedIn = selectLibrary(input([...rows, ...days(4).map((d, i) => row(`li:${i}`, d))], [...reviews, ...days(4).map((d, i) => designed(`li:${i}`, d))]));
    expect(relearnReason(withLinkedIn, { ...learned(sel), source_posts: withLinkedIn.library.map((e) => ({ path: e.path })) }, choicesKey({}, []))).toBe("platforms");
    expect(relearnReason(sel, learned(sel), choicesKey({ [pathOf("ig:0")]: "kept" }, []))).toBe("choices");
    expect(relearnReason(sel, learned(sel), choicesKey({}, ["c1/uploads/flyer.png"]))).toBe("choices");
    expect(choicesKey({ b: "kept", a: "left_out" }, ["u"])).toBe(choicesKey({ a: "left_out", b: "kept" }, ["u"]));
  });
});

describe("performance inside each platform's slots (onboarding from social profiles, section 5)", () => {
  // Eight Instagram posts: the two oldest did best against the platform's median.
  const ig = days(8).map((d, i) => `ig:${i + 1}`);
  const rows = ig.map((g, i) => row(g, days(8)[i]));
  const reviews = ig.map((g, i) => designed(g, days(8)[i]));
  const multiples = { "ig:7": 2.4, "ig:8": 1.6, "ig:1": 0.5, "ig:2": 0.7, "ig:3": 1, "ig:4": 0.4, "ig:5": 0.3, "ig:6": 0.2 };

  it("takes kept posts first, then posts at or above the median newest first, then the rest newest first", () => {
    const sel = selectLibrary(input(rows, reviews, { multiples, choices: { [pathOf("ig:5")]: "kept" } }));
    expect(sel.library.map((e) => e.source_post_id)).toEqual(["ig:5", "ig:3", "ig:7", "ig:8", "ig:1", "ig:2"]);
    expect(sel.library.find((e) => e.source_post_id === "ig:7")?.multiple).toBe(2.4);
    // Without the scores, newest first as before.
    expect(selectLibrary(input(rows, reviews)).library.map((e) => e.source_post_id)).toEqual(["ig:1", "ig:2", "ig:3", "ig:4", "ig:5", "ig:6"]);
  });

  it("reviews the posts that could reach the library in the same order", () => {
    expect(reviewQueue(input(rows, [], { multiples })).map((c) => c.source_post_id)).toEqual(["ig:3", "ig:7", "ig:8", "ig:1", "ig:2", "ig:4"]);
  });

  it("lends a platform the strategy marks not now its posts, without a section of its own", () => {
    const li = days(5).map((d, i) => row(`li:${i + 1}`, d));
    const liReviews = days(5).map((d, i) => designed(`li:${i + 1}`, d));
    const sel = selectLibrary(input([...rows, ...li], [...reviews, ...liReviews], { notNow: ["LinkedIn"] }));
    expect(sel.platforms.LinkedIn).toMatchObject({ posts: 5, own_rules: false });
    expect(sel.platforms.Instagram.own_rules).toBe(true);
    expect(sel.library.some((e) => e.platform === "LinkedIn")).toBe(true);
  });
});
