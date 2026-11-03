// Seasonal posts that fit the client (Lital, 3 Nov 2026): every dated moment
// the planner may use is listed with a source, filtered in code for the
// client's countries, the week, the client's removals and sensitive spaces,
// judged by one model call, and the judge's answer is checked in code.
// Design: docs/superpowers/specs/2026-11-03-seasonal-insights-design.md

import { describe, expect, it } from "vitest";
import {
  belongsToSpace, blockedCategories, checkJudgement, clientCountries, filterMoments, judgePrompt, momentEvidence, momentHistory, momentKey,
  namesMoment, parseMomentsList, type JudgeInput, type Moment,
} from "./moments";
import type { OwnPost } from "./evidence";

const moment = (over: Partial<Moment> = {}): Moment => ({
  key: "us:halloween", name: "Halloween", date: "2026-10-31", last_year_date: "2025-10-31", country: "US", category: "cultural_commercial",
  link: "https://www.timeanddate.com/holidays/us/halloween", hashtags: ["#Halloween"], aliases: [], terms: ["costumes"], ...over,
});

const ELECTION = moment({
  key: "us:election-day", name: "Election Day", date: "2026-11-03", last_year_date: "2025-11-04", category: "civic_political",
  link: "https://www.usa.gov/election-day", hashtags: ["#ElectionDay"], aliases: ["General Election"], terms: ["election", "voting", "politics"],
});
const WORLD_KINDNESS = moment({ key: "global:world-kindness-day", name: "World Kindness Day", date: "2026-11-13", last_year_date: "2025-11-13", country: "GLOBAL", category: "awareness_day", hashtags: ["#WorldKindnessDay"], terms: [] });

const post = (over: Partial<OwnPost>): OwnPost => ({ id: "x", platform: "Instagram", format: "reel", publishedAt: "2025-11-01T15:00:00Z", text: "Hello", link: null, impressions: null, engagement: 10, ...over });

describe("momentKey", () => {
  it("names a moment by its country and its name, never its year", () => {
    expect(momentKey("US", "Election Day 2026")).toBe("us:election-day");
    expect(momentKey("GLOBAL", "World Mental Health Day")).toBe("global:world-mental-health-day");
    expect(momentKey("IL", "Rosh Hashanah")).toBe("il:rosh-hashanah");
  });
});

describe("parseMomentsList", () => {
  const range = { country: "US", from: "2026-11-02", through: "2026-12-06" };
  it("keeps a moment only with a link and a date in range, with its category and its last year's date", () => {
    const text = JSON.stringify({ moments: [
      { name: "Election Day", date: "2026-11-03", last_year_date: "2025-11-04", category: "civic_political", link: "https://www.usa.gov/election-day", hashtags: ["ElectionDay"], aliases: ["General Election"], terms: ["election"] },
      { name: "No link day", date: "2026-11-10", category: "awareness_day", link: "" },
      { name: "Too late", date: "2027-01-01", category: "public_holiday", link: "https://x.test/a" },
      { name: "Bad date", date: "Nov 3", category: "public_holiday", link: "https://x.test/b" },
      { name: "Thanksgiving", date: "2026-11-26", last_year_date: "2025-11-27", category: "made_up", link: "https://x.test/c" },
    ] });
    const out = parseMomentsList(`Here you go:\n${text}`, range);
    expect(out.map((m) => m.key)).toEqual(["us:election-day", "us:thanksgiving"]);
    expect(out[0]).toMatchObject({ country: "US", date: "2026-11-03", last_year_date: "2025-11-04", category: "civic_political", hashtags: ["#ElectionDay"] });
    // A category the list doesn't know is read as cultural or commercial, never as one of the sensitive four.
    expect(out[1].category).toBe("cultural_commercial");
  });

  it("reads nothing from a reply that isn't JSON", () => {
    expect(parseMomentsList("no moments", range)).toEqual([]);
  });
});

describe("clientCountries", () => {
  it("reads the client's countries, else its headquarters, else none (global moments only)", () => {
    expect(clientCountries({ geo: "US, Canada", location: { country: "IL" } })).toEqual(["US", "CA"]);
    expect(clientCountries({ geo: "", location: { country: "IL" } })).toEqual(["IL"]);
    expect(clientCountries({ geo: null, location: null })).toEqual([]);
  });
});

describe("filterMoments", () => {
  const ctx = { countries: ["US"], monday: "2026-11-09", firstDate: "2026-11-09", removedKeys: new Set<string>(), blocked: new Set<string>() };

  it("drops the wrong country, the wrong week, a removed moment and a blocked category, and keeps a global day", () => {
    const inWeek = (over: Partial<Moment>) => moment({ date: "2026-11-11", ...over });
    const all = [
      inWeek({ key: "us:veterans-day", name: "Veterans Day", category: "remembrance_tragedy" }),
      inWeek({ key: "gb:remembrance-day", name: "Remembrance Day", country: "GB" }),
      inWeek({ key: "us:black-friday", name: "Black Friday", date: "2026-11-27" }),
      inWeek({ key: "us:singles-day", name: "Singles Day" }),
      inWeek({ key: "us:world-series", name: "World Series", category: "sports" }),
      WORLD_KINDNESS,
    ];
    const out = filterMoments(all, { ...ctx, removedKeys: new Set(["us:singles-day"]), blocked: new Set(["sports"]) });
    expect(out.kept.map((m) => m.key)).toEqual(["us:veterans-day", "global:world-kindness-day"]);
    expect(Object.fromEntries(out.dropped.map((d) => [d.key, d.why]))).toEqual({
      "gb:remembrance-day": "country", "us:black-friday": "week", "us:singles-day": "removed", "us:world-series": "blocked_category",
    });
  });

  it("drops a moment on a day the week can no longer post on", () => {
    const out = filterMoments([moment({ date: "2026-11-09" }), moment({ key: "us:b", date: "2026-11-12" })], { ...ctx, firstDate: "2026-11-11" });
    expect(out.kept.map((m) => m.key)).toEqual(["us:b"]);
  });

  it("keeps one moment that two lists name, the country's own first", () => {
    const out = filterMoments([moment({ key: "global:world-kindness-day", country: "GLOBAL", name: "World Kindness Day", date: "2026-11-13" }), moment({ key: "us:world-kindness-day", name: "World Kindness Day", date: "2026-11-13" })], ctx);
    expect(out.kept.map((m) => m.key)).toEqual(["us:world-kindness-day"]);
  });

  it("gives a client with no country global moments only", () => {
    const out = filterMoments([moment({ date: "2026-11-11" }), WORLD_KINDNESS], { ...ctx, countries: [] });
    expect(out.kept.map((m) => m.key)).toEqual(["global:world-kindness-day"]);
  });
});

describe("blockedCategories", () => {
  it("blocks a category after two removals with no seasonal post of it kept through its week", () => {
    const removals = [
      { moment_key: "us:election-day", category: "civic_political" },
      { moment_key: "us:primary-day", category: "civic_political" },
      { moment_key: "us:halloween", category: "cultural_commercial" },
      { moment_key: "us:world-series", category: "sports" },
      { moment_key: "us:super-bowl", category: "sports" },
    ];
    expect([...blockedCategories(removals, [{ category: "sports" }])]).toEqual(["civic_political"]);
    expect([...blockedCategories(removals.slice(0, 1), [])]).toEqual([]);
  });
});

describe("whether a brand belongs to a sensitive moment's space", () => {
  it("is shown by the brand's own words naming the moment or its subject, or by its own post on it last year", () => {
    expect(namesMoment("Pillar: Election season campaigns that win votes", ELECTION)).toBe(true);
    expect(namesMoment("We grow apps with paid social and ASO.", ELECTION)).toBe(false);
    // A word inside another word is not a mention.
    expect(namesMoment("Electionday is a hashtag", ELECTION)).toBe(true);
    expect(namesMoment("Selections of apps", ELECTION)).toBe(false);
    expect(belongsToSpace(ELECTION, "We grow apps with paid social and ASO.", null)).toBe(false);
    expect(belongsToSpace(ELECTION, "We grow apps.", { posts: 3, matched: [{ id: "p1" } as never], best: null })).toBe(true);
  });
});

describe("momentHistory", () => {
  const now = Array.from({ length: 6 }, (_, i) => post({ id: `w${i}`, publishedAt: `2025-10-${String(26 + i).padStart(2, "0")}T12:00:00Z`, engagement: 10 }));
  it("scores the client's post on the moment last year against that window's median for its platform and format", () => {
    const posts = [...now, post({ id: "h1", publishedAt: "2025-10-31T18:00:00Z", text: "Happy #Halloween from the team", engagement: 32, link: "https://ig/h1" })];
    const h = momentHistory(moment(), posts)!;
    expect(h.matched.map((m) => m.id)).toEqual(["h1"]);
    expect(h.best).toMatchObject({ id: "h1", platform: "Instagram", format: "reel", metric: "engagement", value: 32, median: 10, multiple: 3, sample: 7, thin: false });
  });

  it("calls it an early signal under 5 posts, and ignores posts outside a week either side of last year's date", () => {
    const posts = [post({ id: "h1", text: "Halloween!", engagement: 20 }), post({ id: "old", publishedAt: "2025-10-01T12:00:00Z", text: "Halloween is coming", engagement: 99 })];
    const h = momentHistory(moment(), posts)!;
    expect(h.matched.map((m) => m.id)).toEqual(["h1"]);
    expect(h.best).toMatchObject({ sample: 1, thin: true });
    expect(momentHistory(moment({ last_year_date: null }), posts)).toBeNull();
  });
});

describe("the judge", () => {
  const input = (over: Partial<JudgeInput> = {}): JudgeInput => ({
    brand: "Moburst",
    pillars: [{ name: "App Growth" }, { name: "Team Culture" }],
    brief: "A mobile growth agency.",
    strategy: "",
    trendAudience: "", fitRubric: "", exclusions: [],
    voice: "", preferences: [],
    moments: [
      { moment: moment({ date: "2026-11-11" }), sensitive: false, own: [{ ref: "O1", id: "h1", text: "Happy Halloween", platform: "Instagram", format: "reel", date: "2025-10-31", multiple: 2.3, metric: "engagement" }], competitors: { BenchApp: 2 } },
      { moment: ELECTION, sensitive: true, own: [], competitors: { BenchApp: 1 } },
    ],
    ...over,
  });

  it("lists each moment with the client's own posts and the competitors who named it, and the client's context", () => {
    const p = judgePrompt(input());
    expect(p).toContain("us:halloween");
    expect(p).toContain("O1");
    expect(p).toContain("BenchApp");
    expect(p).toContain("App Growth");
    expect(p).toContain("never a reason");
  });

  it("keeps a moment whose fit sentence and citations check out", () => {
    const answer = { moments: [{ key: "us:halloween", keep: true, reason: "fits", fit: "Halloween reels are where your audience already engages.", pillars: ["app growth"], posts: ["O1"] }] };
    const out = checkJudgement(JSON.stringify(answer), input());
    expect(out.kept.map((k) => k.key)).toEqual(["us:halloween"]);
    expect(out.kept[0]).toMatchObject({ fit: "Halloween reels are where your audience already engages.", pillars: ["App Growth"], posts: ["h1"], companies: 1 });
    expect(out.dropped).toEqual([expect.objectContaining({ key: "us:election-day", why: "no_answer" })]);
  });

  it("drops a keep that cites a pillar or a post it wasn't given, or has no usable sentence", () => {
    const bad = (over: Record<string, unknown>) => checkJudgement(JSON.stringify({ moments: [{ key: "us:halloween", keep: true, reason: "fits", fit: "Fits the team.", pillars: [], posts: ["O1"], ...over }] }), input());
    expect(bad({ pillars: ["Made Up Pillar"] }).kept).toEqual([]);
    expect(bad({ posts: ["O9"] }).kept).toEqual([]);
    expect(bad({ fit: "O1 shows it works." }).kept).toEqual([]);
    expect(bad({ fit: "" }).kept).toEqual([]);
    expect(bad({ pillars: [], posts: [] }).kept).toEqual([]);
    expect(bad({}).kept.map((k) => k.key)).toEqual(["us:halloween"]);
  });

  it("drops a sensitive keep resting on competitors only", () => {
    const out = checkJudgement(JSON.stringify({ moments: [{ key: "us:election-day", keep: true, reason: "fits", fit: "Ad auctions get pricier on Election Day.", pillars: [], posts: [] }] }), input());
    expect(out.kept).toEqual([]);
    expect(out.dropped.find((d) => d.key === "us:election-day")?.why).toBe("sensitive");
  });

  it("records the judge's reason for a drop", () => {
    const out = checkJudgement(JSON.stringify({ moments: [{ key: "us:halloween", keep: false, reason: "off_brand", fit: "", pillars: [], posts: [] }] }), input());
    expect(out.dropped.find((d) => d.key === "us:halloween")?.why).toBe("off_brand");
  });
});

describe("momentEvidence", () => {
  it("numbers the kept moments M1, M2 by date with their numbers from code", () => {
    const kept = [
      { ...WORLD_KINDNESS, fit: "Kindness is your brand.", pillars: ["Team Culture"], posts: [], companies: 0, history: null },
      { ...moment({ date: "2026-11-11" }), fit: "Fits.", pillars: [], posts: ["h1"], companies: 2, history: { id: "h1", platform: "Instagram", format: "reel", date: "2025-10-31", link: null, metric: "engagement", value: 23, median: 10, multiple: 2.3, sample: 3, thin: true } },
    ];
    const items = momentEvidence(kept);
    expect(items.map((i) => i.id)).toEqual(["M1", "M2"]);
    expect(items[0]).toMatchObject({ kind: "moment", text: "Halloween", key: "us:halloween", category: "cultural_commercial", date: "2026-11-11", fit: "Fits.", platform: "Instagram", format: "reel", multiple: 2.3, metric: "engagement", thin: true, companies: 2 });
    expect(items[1]).toMatchObject({ id: "M2", text: "World Kindness Day", fit: "Kindness is your brand." });
    expect(items[1].multiple).toBeUndefined();
  });
});
