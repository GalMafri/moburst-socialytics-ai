import { describe, expect, it } from "vitest";
import { sproutCandidates } from "../../../functions/_shared/brand-references/candidates";
import { choicesKey, type CorpusInput, LIBRARY_MAX, PER_PLATFORM, relearnReason, type Review, reviewQueue, selectLibrary } from "../../../functions/_shared/brand-references/corpus";

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
  content_hash: `h-${guid}`, verdict: "designed", path: `c1/social-${guid.replace(":", "-")}.jpg`, confidence: 0.92, reason: "Branded type over a color block", reviewed_at: "2026-10-01T00:00:00Z", ...over,
});
const plain = (guid: string, day: string): Review => ({ ...designed(guid, day), verdict: "not_designed", path: null, reason: "A plain photograph" });
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

  it("never shrinks below 3 by age alone: an old post leaves only when a newer one replaces it", () => {
    // One new designed post in the window; the three from the summer aged out of it.
    const previous = ["06-10", "06-12", "06-14"].map((d, i) => ({ path: `c1/social-old${i}.jpg`, platform: "INSTAGRAM", posted_at: `2026-${d}T15:00:00Z`, quality_checked: true }));
    const sel = selectLibrary(input([row("ig:new", "2026-10-30")], [designed("ig:new", "2026-10-30")], { previous }));
    expect(sel.library.map((e) => e.path)).toEqual([pathOf("ig:new"), "c1/social-old2.jpg", "c1/social-old1.jpg"]);
    expect(sel.enough).toBe(true);
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

  it("with 2 designed posts in all, waits and keeps the old set", () => {
    const previous = [{ path: "c1/social-a.jpg", quality_checked: true, platform: "INSTAGRAM", posted_at: "2026-09-01T00:00:00Z" }];
    const sel = selectLibrary(input([row("ig:1", "2026-10-30"), row("ig:2", "2026-10-29"), row("ig:3", "2026-10-28")], [designed("ig:1", "2026-10-30"), plain("ig:2", "2026-10-29"), designed("ig:3", "2026-10-28")]));
    expect(sel.enough).toBe(false);
    expect(sel.library).toHaveLength(2);
    // With a previous library to fill from, age alone does not leave it short.
    expect(selectLibrary(input([row("ig:1", "2026-10-30"), row("ig:3", "2026-10-28")], [designed("ig:1", "2026-10-30"), designed("ig:3", "2026-10-28")], { previous })).enough).toBe(true);
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

  it("skips posts from before a new look", () => {
    const rows = [row("ig:new", "2026-10-30"), row("ig:old", "2026-10-01")];
    expect(reviewQueue(input(rows, [], { lookSince: "2026-10-20" })).map((c) => c.source_post_id)).toEqual(["ig:new"]);
  });
});

describe("when the look is learned again", () => {
  const rows = days(6).map((d, i) => row(`ig:${i}`, d));
  const reviews = days(6).map((d, i) => designed(`ig:${i}`, d));
  const learned = (sel: ReturnType<typeof selectLibrary>, key = choicesKey({}, [])) => ({
    reference_pipeline_version: 2, choices_key: key, platforms: { Instagram: { rules: "r", posts: 6, learned_at: "2026-10-01T00:00:00Z" } },
    source_posts: sel.library.map((e) => ({ path: e.path })),
  });

  it("on the first check after this change, and never while nothing changed", () => {
    const sel = selectLibrary(input(rows, reviews));
    expect(relearnReason(sel, null, choicesKey({}, []))).toBe("first");
    expect(relearnReason(sel, { reference_pipeline_version: 1 }, choicesKey({}, []))).toBe("first");
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
