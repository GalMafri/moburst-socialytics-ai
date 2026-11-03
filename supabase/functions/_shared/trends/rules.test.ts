// @vitest-environment node
// The rules in code that run before Claude reads anything (spec section 4,
// step 1): cheap cuts, each with its reason, so every decision is stored.
import { describe, expect, it } from "vitest";
import { ruleFilter, tripwire, type RuleOptions } from "./rules";
import type { TrendPost } from "./types";

let n = 0;
const post = (over: Partial<TrendPost> = {}): TrendPost => {
  n++;
  return {
    platform: "tiktok", url: `https://www.tiktok.com/@creator/video/${n}`, author: "creator",
    text: "Three things that grow your app installs this week, and why they work for the team",
    posted_at: "2026-10-29T10:00:00.000Z", format: "short_video", views: 1000, likes: 100, comments: 10, shares: 1, saves: 0,
    engagement: 100 + n, search: "app growth", ...over,
  };
};
const opts = (over: Partial<RuleOptions> = {}): RuleOptions => ({
  windowStart: "2026-10-25T00:00:00.000Z", windowEnd: "2026-11-01T10:00:00.000Z", languages: ["en"],
  ownHandles: ["moburst"], ownNames: ["Moburst"], competitorHandles: ["splitmetrics"], competitorNames: ["SplitMetrics"], ...over,
});

describe("the rules before Claude", () => {
  it("keeps a post found by two searches once", () => {
    const a = post();
    const out = ruleFilter([a, { ...a, search: "ASO tactics" }], opts());
    expect(out.candidates).toHaveLength(1);
    expect(out.dropped).toEqual([{ post: { ...a, search: "ASO tactics" }, reason: "duplicate" }]);
  });

  it("tells posts apart by the ID their link carries after the ?", () => {
    // 1 Nov 2026 trial: YouTube links (watch?v=ID) and Facebook permalinks (permalink.php?story_fbid=ID) all looked like one post.
    const yt = (id: string) => post({ platform: "youtube", url: `https://www.youtube.com/watch?v=${id}` });
    const fb = (id: string) => post({ platform: "facebook", url: `https://www.facebook.com/permalink.php?story_fbid=${id}&id=615` });
    const out = ruleFilter([yt("a1"), yt("b2"), fb("111"), fb("222")], opts());
    expect(out.candidates).toHaveLength(4);
    expect(out.dropped).toEqual([]);
    // The same post with tracking added is still the same post.
    const tracked = post({ platform: "youtube", url: "https://www.youtube.com/watch?v=a1&utm_source=x#t=10" });
    expect(ruleFilter([yt("a1"), tracked], opts()).dropped.map((d) => d.reason)).toEqual(["duplicate"]);
  });

  it("drops posts outside the 7-day window, and pins only past 90 days", () => {
    const old = post({ posted_at: "2026-10-20T10:00:00.000Z" });
    const pin = (id: number, posted_at: string | null) => post({ platform: "pinterest", url: `https://www.pinterest.com/pin/${id}/`, posted_at, format: "pin", engagement: 0 });
    const recentPin = pin(1, "2026-10-13T14:00:15.000Z");
    const undatedPin = pin(2, null);
    const stalePin = pin(3, "2026-07-01T10:00:00.000Z");
    const out = ruleFilter([old, recentPin, undatedPin, stalePin], opts());
    expect(out.candidates).toEqual([recentPin, undatedPin]);
    expect(out.dropped.map((d) => [d.post.url, d.reason])).toEqual([[old.url, "outside_window"], [stalePin.url, "outside_window"]]);
  });

  it("ranks pins by their search's own order, the newer first among equals", () => {
    const pin = (id: number, o: Partial<TrendPost>) => post({ platform: "pinterest", url: `https://www.pinterest.com/pin/${id}/`, format: "pin", engagement: 0, ...o });
    const a2 = pin(1, { search: "a", position: 2, posted_at: "2026-10-30T10:00:00.000Z" });
    const a1 = pin(2, { search: "a", position: 1, posted_at: "2026-09-01T10:00:00.000Z" });
    const b1 = pin(3, { search: "b", position: 1, posted_at: "2026-10-20T10:00:00.000Z" });
    const b2 = pin(4, { search: "b", position: 2, posted_at: "2026-10-31T10:00:00.000Z" });
    const out = ruleFilter([a2, a1, b1, b2], opts({ capPerPlatform: 3 }));
    // Each search's first result takes the first turn, the newer of those first; then the second results.
    expect(out.candidates.map((p) => p.url)).toEqual([b1.url, a1.url, b2.url]);
    expect(out.dropped).toEqual([{ post: a2, reason: "over_cap" }]);
  });

  it("never offers again a pin an earlier week kept, and leaves posts with counts alone", () => {
    const seenPin = post({ platform: "pinterest", url: "https://www.pinterest.com/pin/9/", posted_at: null, format: "pin" });
    const tiktok = post();
    const out = ruleFilter([seenPin, tiktok], opts({ keptBefore: ["https://pinterest.com/pin/9", tiktok.url] }));
    expect(out.candidates).toEqual([tiktok]);
    expect(out.dropped).toEqual([{ post: seenPin, reason: "kept_before" }]);
  });

  it("keeps only the client's language, for a Hebrew client too", () => {
    const hebrew = post({ text: "שלוש דרכים להגדיל את ההורדות של האפליקציה שלכם השבוע" });
    const english = post();
    const out = ruleFilter([hebrew, english], opts({ languages: ["he"] }));
    expect(out.candidates).toEqual([hebrew]);
    expect(out.dropped).toEqual([{ post: english, reason: "language" }]);
    // A post too short to tell is left for Claude to judge.
    expect(ruleFilter([post({ text: "wow" })], opts()).candidates).toHaveLength(1);
  });

  it("keeps short or hashtag-heavy English posts for an English client, and leaves Latin-script posts in other languages to Claude", () => {
    // 1 Nov 2026 trial: these English posts were dropped as another language by the two-common-words rule.
    const english = [
      post({ text: "Blessed to secure justice on behalf of our clients 🙌 #lawyer #workcomp #atlantalawyer #settlement" }),
      post({ text: "Teach Teens Safe Habits Phones, speed, and passengers create distractions. Set clear driving rules." }),
      post({ text: "#themorganlegalgroup #PersonalInjuryLawyer #texaslawyer #personalinjury #CarAccidentLawyer" }),
    ];
    const spanish = post({ text: "Comenta CASA y te escribo para revisar tu caso juntos. #seguros #insurance" });
    const hindi = post({ text: "मशहूर सिंगर हनी सिंह के करीबी दोस्त के बेटे की सड़क हादसे में जान चली गई" });
    const out = ruleFilter([...english, spanish, hindi], opts());
    expect(out.candidates).toEqual([...english, spanish].sort((a, b) => b.engagement - a.engagement));
    expect(out.dropped).toEqual([{ post: hindi, reason: "language" }]);
  });

  it("drops the client's own and tracked competitors' posts", () => {
    const own = post({ author: "moburst" });
    const rival = post({ author: "SplitMetrics" });
    const byLink = post({ author: "", url: "https://www.tiktok.com/@splitmetrics/video/9" });
    const out = ruleFilter([own, rival, byLink, post()], opts());
    expect(out.candidates).toHaveLength(1);
    expect(out.dropped.map((d) => d.reason)).toEqual(["own_or_competitor", "own_or_competitor", "own_or_competitor"]);
  });

  it("knows a tracked account by its handle when the post shows only its display name", () => {
    // A YouTube channel shows its title ("Leveling Up with Eric Siu") while the tracked handle is LevelingUpOfficial.
    const video = post({ platform: "youtube", author: "Leveling Up with Eric Siu", handle: "@LevelingUpOfficial", url: "https://www.youtube.com/watch?v=abc" });
    const out = ruleFilter([video, post()], opts({ competitorHandles: ["LevelingUpOfficial"] }));
    expect(out.dropped).toEqual([{ post: video, reason: "own_or_competitor" }]);
  });

  it("gives every search its share of the 60, so one loose search cannot crowd out the rest", () => {
    // A loose search brings back 60 viral posts; a precise one brings back 10 quieter ones.
    const loose = Array.from({ length: 60 }, (_, i) => post({ url: `https://www.tiktok.com/@a/video/l${i}`, search: "mobile user acquisition", engagement: 10_000 + i }));
    const precise = Array.from({ length: 10 }, (_, i) => post({ url: `https://www.tiktok.com/@b/video/p${i}`, search: "app store optimization tips", engagement: 100 + i }));
    const out = ruleFilter([...loose, ...precise], opts());
    expect(out.candidates).toHaveLength(60);
    expect(out.candidates.filter((p) => p.search === "app store optimization tips")).toHaveLength(10);
    // Within a search, the most engaged go first; the loose search's least engaged are the ones left out.
    expect(out.dropped.every((d) => d.reason === "over_cap" && d.post.search === "mobile user acquisition" && d.post.engagement < 10_010)).toBe(true);
  });

  it("sends at most 60 per platform, most engaged first", () => {
    const many = Array.from({ length: 61 }, (_, i) => post({ engagement: i }));
    const other = post({ platform: "linkedin", url: "https://www.linkedin.com/posts/x-1", engagement: 0 });
    const out = ruleFilter([...many, other], opts());
    expect(out.candidates.filter((p) => p.platform === "tiktok")).toHaveLength(60);
    expect(out.candidates.some((p) => p.platform === "linkedin")).toBe(true);
    expect(out.dropped).toEqual([{ post: many[0], reason: "over_cap" }]);
    expect(out.candidates[0].engagement).toBe(60);
  });
});

describe("the junk tripwire", () => {
  it("flags job ads, giveaways and money schemes, and leaves ordinary posts alone", () => {
    expect(tripwire("We're hiring! Apply now for our marketing role")).toBe(true);
    expect(tripwire("GIVEAWAY: enter to win a new phone")).toBe(true);
    expect(tripwire("I made £1,313 online in ONE WEEK with this side hustle")).toBe(true);
    expect(tripwire("Three things that grow your app installs this week")).toBe(false);
  });
});
