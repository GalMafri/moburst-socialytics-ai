// @vitest-environment node
// The six trend sources (spec section 2): what each is asked for, and how its
// answer becomes the one post shape every later step reads. The fixtures are
// trimmed rows of real answers recorded on 1 Nov 2026 (Instagram's from the
// 19 Oct social fixture), plus a few labeled edge rows: a row with no link, a
// blank row, a null hashtag, a Shorts video.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { engagementOf, MAX_POSTS_PER_PLATFORM, MAX_SEARCHES, POSTS_PER_SEARCH, searchesFor, TREND_SOURCES } from "./sources";
import { TREND_PLATFORMS, type TrendPlatform } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
// deno-lint-ignore no-explicit-any
const rows = (p: TrendPlatform): any[] => JSON.parse(readFileSync(join(here, "..", "..", "..", "fixtures", "trends", `${p}.json`), "utf8"));
const read = (p: TrendPlatform) => rows(p).map((r) => TREND_SOURCES[p].normalize(r, "run search"));
const opts = { region: "US", language: "en", windowStart: "2026-10-25", windowEnd: "2026-11-01" };
const eight = ["a", "b", "c", "d", "e", "f", "g", "h"];

describe("each source's answer in the shared post shape", () => {
  it.each(TREND_PLATFORMS)("reads a real %s answer into the shared post shape", (platform) => {
    const posts = read(platform).filter((p) => p !== null);
    expect(posts.length).toBeGreaterThan(0);
    for (const p of posts) {
      expect(p.platform).toBe(platform);
      expect(p.url).toMatch(/^https:\/\//);
      expect(typeof p.text).toBe("string");
      expect(p.engagement).toBe(engagementOf(p));
      expect(p.search).not.toBe("");
    }
  });

  it("leaves out rows that are not a post: no link, a blank row, a hashtag page", () => {
    expect(read("tiktok").map((p) => p === null)).toEqual([false, false, true]);
    expect(read("instagram").map((p) => p === null)).toEqual([true, true, false]);
    expect(read("pinterest").map((p) => p === null)).toEqual([false, false, true]);
  });

  it("keeps the author's handle where the source gives one, to tell tracked accounts apart", () => {
    expect(read("youtube")[0]).toMatchObject({ author: "BUZZ SEARCH", handle: "buzzsearch" });
    expect(read("linkedin")[0]).toMatchObject({ author: "Neil Haley", handle: "themediagiant" });
    expect(read("tiktok")[0]).toMatchObject({ handle: "techdropp" });
    expect(read("pinterest")[0]).toMatchObject({ handle: "RMpincreator" });
  });

  it("reads TikTok's saves and a row with an unreadable hashtag", () => {
    const p = read("tiktok")[1]!;
    expect(p).toMatchObject({ author: "monetiza_con_yanet", views: 52231, likes: 3240, comments: 210, shares: 964, saves: 2199, format: "short_video", posted_at: "2026-10-30T18:32:39.000Z", search: "app marketing" });
  });

  it("reads Instagram's post type and the hashtag it was found by", () => {
    expect(read("instagram")[2]).toMatchObject({ format: "carousel", author: "paytoplayapp", likes: 21, comments: 1, search: "#stopchasingstartplaying", posted_at: "2026-09-03T13:33:30.000Z" });
  });

  it("reads a LinkedIn post's author, date and reactions", () => {
    expect(read("linkedin")[1]).toMatchObject({ author: "Kehinde Dawood MBA", likes: 4, comments: 4, shares: 0, format: "short_video", posted_at: "2026-10-26T07:51:56.237Z", search: "app marketing" });
    expect(read("linkedin")[2]!.format).toBe("text");
  });

  it("tells a YouTube Short from a long video and links each", () => {
    const [, long, short] = read("youtube");
    expect(long).toMatchObject({ format: "long_video", url: "https://www.youtube.com/watch?v=m3TCHv5MeeI", views: 61, author: "Anshika Digital Media Academy", search: "run search" });
    expect(short).toMatchObject({ format: "short_video", url: "https://www.youtube.com/shorts/Zq9x1shortAA", views: 18400 });
  });

  it("dates a pin by when it was made, keeps its place in the search, and counts saves where a row has them", () => {
    const pin = read("pinterest")[1]!;
    expect(pin).toMatchObject({ posted_at: "2026-10-19T13:45:05.000Z", saves: 312, likes: 4, format: "pin", author: "UnitedIncome", search: "marketing tips" });
    expect(pin.text).toContain("45 Marketing Tips");
    expect(pin.position).toBeUndefined();
    // Places count every row of the run's results, including one that is not a pin (the third here).
    const placed = rows("pinterest").map((r, i) => TREND_SOURCES.pinterest.normalize(r, "run search", i + 1));
    expect(placed.map((p) => p?.position ?? null)).toEqual([1, 2, null]);
    // A post from a source with counts never carries a place.
    expect(TREND_SOURCES.tiktok.normalize(rows("tiktok")[0], "run search", 1)?.position).toBeUndefined();
  });

  it("reads a Facebook post's time, reactions and kind", () => {
    const [photo, reel, text] = read("facebook");
    expect(photo).toMatchObject({ format: "image", posted_at: new Date(1793206944000).toISOString(), author: "Application Testing And Play Store App Reviews" });
    expect(reel).toMatchObject({ format: "short_video", likes: 515, comments: 50, shares: 12 });
    expect(text!.format).toBe("text");
  });
});

describe("engagement", () => {
  it("counts views below a thousand, so small videos still rank against each other", () => {
    const base = { likes: 0, comments: 0, shares: 0, saves: 0 };
    expect(engagementOf({ ...base, views: 620 })).toBeGreaterThan(engagementOf({ ...base, views: 61 }));
    expect(engagementOf({ ...base, views: 0, likes: 3, comments: 1 })).toBe(5);
  });
});

describe("what each source is asked for", () => {
  // deno-lint-ignore no-explicit-any
  const inputs = (p: TrendPlatform, searches = eight): any[] => TREND_SOURCES[p].inputs(searches, opts);

  it("asks each source for the last 7 days, most engaged first, in the client's region, within the post budget", () => {
    expect(inputs("tiktok")).toEqual([{ search: "", input: { keywords: eight, dateRange: "THIS_WEEK", sortType: "MOST_LIKED", location: "US", maxItems: 200, includeSearchKeywords: true } }]);
    expect(inputs("linkedin")).toEqual([{ search: "", input: { searchQueries: eight, maxPosts: POSTS_PER_SEARCH, postedLimit: "week", sortBy: "relevance" } }]);
    expect(inputs("instagram", ["#ASO", "appmarketing"])).toEqual([{ search: "", input: { hashtags: ["ASO", "appmarketing"], keywordSearch: false, resultsLimit: POSTS_PER_SEARCH, resultsType: "posts" } }]);
    const yt = inputs("youtube");
    expect(yt).toHaveLength(8);
    expect(yt[0]).toEqual({ search: "a", input: { query: "a", type: "video", maxResults: POSTS_PER_SEARCH, sortBy: "popularity", uploadDate: "week", geo: "US", lang: "en" } });
    expect(inputs("facebook")[7]).toEqual({ search: "h", input: { query: "h", resultsCount: POSTS_PER_SEARCH, searchType: "top", startDate: "2026-10-25", endDate: "2026-11-01" } });
    expect(inputs("pinterest")[0]).toEqual({ search: "a", input: { search: "a", maxItems: POSTS_PER_SEARCH, getDetails: false } });
  });

  it("never asks a platform for more than 200 posts in a week", () => {
    const twelve = [...eight, "i", "j", "k", "l"];
    for (const p of TREND_PLATFORMS) {
      const runs = inputs(p, twelve);
      const searched = runs.flatMap((r) => (r.search ? [r.search] : (r.input.keywords ?? r.input.searchQueries ?? r.input.hashtags)));
      expect(searched.length).toBeLessThanOrEqual(MAX_SEARCHES);
      expect(searched.length * POSTS_PER_SEARCH).toBeLessThanOrEqual(MAX_POSTS_PER_PLATFORM);
    }
  });

  it("sends Instagram each hashtag as letters, digits and underscores only, once each, and drops one with nothing left", () => {
    expect(inputs("instagram", ["#ASO", "app marketing", "#café-life!", "#", " # . ", "#a#b", "#aso", "#עורך_דין"])[0].input.hashtags)
      .toEqual(["ASO", "appmarketing", "cafélife", "ab", "עורך_דין"]);
    // A tag with nothing left takes no place: eight good tags after it are all sent.
    expect(inputs("instagram", ["#!!", ...eight])[0].input.hashtags).toEqual(eight);
    // Nothing left at all: no run.
    expect(inputs("instagram", ["#", "#-!", "  "])).toEqual([]);
  });

  it("leaves the region out when the client has none", () => {
    expect(TREND_SOURCES.tiktok.inputs(["a"], { ...opts, region: undefined })[0].input).not.toHaveProperty("location");
    expect(TREND_SOURCES.youtube.inputs(["a"], { ...opts, region: undefined })[0].input).not.toHaveProperty("geo");
  });
});

describe("what each platform searches for", () => {
  const terms = {
    topics: [{ term: "app growth tips", reason: "r" }, { term: "ASO tactics", reason: "r" }],
    hashtags: { instagram: [{ term: "#aso", reason: "r" }], tiktok: [{ term: "#appmarketing", reason: "r" }], linkedin: [] },
    exclusions: [],
  };

  it("searches Instagram by the profile's hashtags and the rest by topics, unless a rewrite replaced them", () => {
    expect(searchesFor("instagram", terms, {})).toEqual(["#aso"]);
    expect(searchesFor("tiktok", terms, {})).toEqual(["app growth tips", "ASO tactics"]);
    expect(searchesFor("facebook", terms, { facebook: ["mobile game ads"] })).toEqual(["mobile game ads"]);
    expect(searchesFor("tiktok", terms, { facebook: ["mobile game ads"] })).toEqual(["app growth tips", "ASO tactics"]);
  });

  // A profile can hold more terms than a week searches, and a person can add more.
  const ten = Array.from({ length: 10 }, (_, i) => ({ term: `topic ${String(i).padStart(2, "0")}`, reason: "r" }));
  const added = { term: "mobile game UA", reason: "r", source: "person" as const };
  const many = { ...terms, topics: [...ten, added], hashtags: { ...terms.hashtags, instagram: [...ten.map((t) => ({ ...t, term: `#${t.term.replace(" ", "")}` })), { ...added, term: "#gameua" }] } };

  it("always searches what a person added, first", () => {
    for (const week of ["2026-11-02", "2026-11-09", "2026-11-16"]) {
      expect(searchesFor("tiktok", many, {}, week)[0]).toBe("mobile game UA");
      expect(searchesFor("instagram", many, {}, week)[0]).toBe("#gameua");
      expect(searchesFor("tiktok", many, {}, week)).toHaveLength(MAX_SEARCHES);
    }
  });

  it("lets the profile's own terms take turns when they do not all fit, so each is searched within two weeks", () => {
    const week1 = searchesFor("tiktok", many, {}, "2026-11-02");
    const week2 = searchesFor("tiktok", many, {}, "2026-11-09");
    expect(new Set([...week1, ...week2]).size).toBe(11);
    expect(week1).not.toEqual(week2);
  });

  it("puts a coverage rewrite in place of the profile's own terms, after what a person added", () => {
    // Ruled 2 Nov: a rewrite replaces only the profile's own terms; a person's are still searched first, every week.
    expect(searchesFor("tiktok", many, { tiktok: ["new one", "MOBILE GAME UA", "new two"] }, "2026-11-02")).toEqual(["mobile game UA", "new one", "new two"]);
    expect(searchesFor("instagram", many, { instagram: ["#new"] }, "2026-11-02")).toEqual(["#gameua", "#new"]);
    const nine = Array.from({ length: 9 }, (_, i) => `rewrite ${i}`);
    expect(searchesFor("tiktok", many, { tiktok: nine }, "2026-11-09")).toEqual(["mobile game UA", ...nine.slice(0, MAX_SEARCHES - 1)]);
    // Another platform's rewrite leaves this one's terms as they were.
    expect(searchesFor("youtube", many, { tiktok: nine }, "2026-11-02")).toEqual(searchesFor("youtube", many, {}, "2026-11-02"));
  });

  it("searches the same terms in a week whatever order the rows came in", () => {
    const reversed = { ...many, topics: [...many.topics].reverse() };
    expect(searchesFor("tiktok", reversed, {}, "2026-11-02")).toEqual(searchesFor("tiktok", many, {}, "2026-11-02"));
    // Terms that all fit are all searched, every week.
    expect([...searchesFor("tiktok", { ...terms, topics: ten.slice(0, MAX_SEARCHES) }, {}, "2026-11-02")].sort()).toEqual(ten.slice(0, MAX_SEARCHES).map((t) => t.term));
  });
});
