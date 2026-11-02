import { describe, it, expect } from "vitest";
import { buildReason, clientFit, headline, parseRevision, parseWeekPlan, revisePrompt, STRATEGY_PRECEDENCE, weekPrompt, type WeekContext } from "./weekPlan";
import { wordReason } from "./reasonText";
import type { EvidenceItem } from "./evidence";

const EVIDENCE: EvidenceItem[] = [
  { id: "P1", kind: "own", text: "Our playoff checklist", platform: "Instagram", format: "carousel", date: "2026-10-05", link: "https://x/p1", metric: "impressions", value: 3000, median: 1100, multiple: 2.7, sample: 12 },
  { id: "C1", kind: "competitor", text: "Captain meme", company: "BenchApp", platform: "Instagram", format: "video", date: "2026-10-14", link: "https://c/1", metric: "engagement per follower", value: 0.04, median: 0.01, multiple: 4, sample: 9, thin: true },
  { id: "T1", kind: "topic", text: "Playoff scheduling: two apps posted reminders", companies: 2 },
  { id: "R1", kind: "report", text: "LinkedIn drove 464 of 465 clicks. More detail." },
];

const CTX: WeekContext = {
  brand: "Pay The Pyper",
  voiceBlock: "How Pay The Pyper writes.",
  pillars: [{ name: "Beer League Truths" }],
  market: ["US"],
  languages: ["en"],
  monday: "2026-10-26",
  firstDate: "2026-10-26",
  rhythm: [
    { platform: "Instagram", perWeek: 2, days: ["Tuesday", "Thursday"], time: "17:00", average: 2.1, source: "published_8w" },
    { platform: "Facebook", perWeek: 1, days: ["Wednesday"], time: null, average: 0.9, source: "published_8w" },
  ],
  evidence: EVIDENCE,
  avoid: ["Instagram image from Oct 1 got 0.3x the usual impressions"],
  competitiveBrief: "Rejected by the team: Don't mock other apps",
  existing: [],
  recent: [],
  thin: [],
  canFilm: true,
  hashtags: {},
};

const post = (over: Record<string, unknown>) => ({ date: "2026-10-27", platform: "Instagram", format: "Reel", posting_time: "17:00", pillar: "Beer League Truths", copy: "Copy", hashtags: ["#a"], cta: "Download", visual_direction: "A rink", reason_type: "competitor", evidence_ids: ["C1"], fit: "Captains live this every week", moment: "", test: false, ...over });

describe("weekPrompt", () => {
  it("states the rhythm, the usable dates and every piece of evidence by id", () => {
    const p = weekPrompt({ ...CTX, firstDate: "2026-10-28" });
    expect(p).toContain("- Instagram: 2 posts, usually Tuesday, Thursday around 17:00");
    expect(p).toContain("Dates you can use: Wednesday 2026-10-28");
    expect(p).not.toContain("Tuesday 2026-10-27");
    for (const id of ["P1", "C1", "T1", "R1"]) expect(p).toContain(`${id} [`);
    expect(p).toContain("Don't mock other apps");
  });

  it("gives each trend with its theme and its example post, not as a monthly report finding", () => {
    const trend: EvidenceItem = {
      id: "N1", kind: "trend", text: "POV: you are the captain", theme: "Captain POV skits", company: "@benchpro", platform: "TikTok", format: "short_video",
      date: "2026-10-14", link: "https://t/1", metric: "engagement", value: 5400,
    };
    const p = weekPrompt({ ...CTX, evidence: [...EVIDENCE, trend] });
    expect(p).toContain('N1 [@benchpro TikTok short_video, 2026-10-14, theme "Captain POV skits"] POV: you are the captain');
    expect(p).toContain("Industry trends this week");
    expect(p).not.toContain("Platform trends from the latest monthly report");
  });

  it("leaves out ideas that need filming when the client hasn't uploaded footage in 60 days", () => {
    const rule = "don't plan ideas that need a specific person on camera";
    expect(weekPrompt(CTX)).not.toContain(rule);
    expect(weekPrompt({ ...CTX, canFilm: false })).toContain(rule);
  });

  it("gives each platform the week posts on one line of its suggested hashtags, and leaves out a platform with none", () => {
    const rhythm = [...CTX.rhythm, { platform: "TikTok", perWeek: 1, days: ["Friday"], time: null, average: 1, source: "published_8w" as const }, { platform: "LinkedIn", perWeek: 1, days: ["Monday"], time: null, average: 1, source: "published_8w" as const }];
    // Facebook has slots but is no hashtag platform; TikTok has slots and no hashtags; Twitter has hashtags and no slots.
    const p = weekPrompt({ ...CTX, rhythm, hashtags: { instagram: ["#beerleague", "#hockeylife"], tiktok: [], linkedin: ["#teamwork"], twitter: ["#nope"] } });
    expect(p).toContain("- Instagram: #beerleague, #hockeylife");
    expect(p).toContain("- LinkedIn: #teamwork");
    expect(p).not.toContain("- TikTok: #");
    expect(p).not.toContain("- Facebook: #");
    expect(p).not.toContain("#nope");
  });

  it("offers the hashtags to use as the post suits, never as required, and never calls them trending", () => {
    const p = weekPrompt({ ...CTX, hashtags: { instagram: ["#beerleague"] } });
    const section = p.split("\n\n").find((s) => s.includes("#beerleague")) ?? "";
    expect(section).toBe("Hashtags the brand's space uses, by platform. Add the ones that suit a post to its hashtags; none is required:\n- Instagram: #beerleague");
    expect(section.toLowerCase()).not.toContain("trend");
  });

  it("has no hashtag section when no platform has suggestions", () => {
    expect(weekPrompt({ ...CTX, hashtags: {} })).not.toContain("Hashtags the brand's space uses");
    expect(weekPrompt({ ...CTX, hashtags: { instagram: [], tiktok: [], linkedin: [] } })).not.toContain("Hashtags the brand's space uses");
    // The platform has suggestions but the week has no slot on it.
    expect(weekPrompt({ ...CTX, rhythm: [], hashtags: { instagram: ["#a"] } })).not.toContain("Hashtags the brand's space uses");
  });

  it("has no rhythm section when there is no rhythm, rather than an empty one", () => {
    expect(weekPrompt({ ...CTX, rhythm: [] })).not.toContain("Posts for this week, per platform");
  });
});

describe("the client's content strategy in the planner's prompts", () => {
  const STRATEGY = "The client's content strategy, as the team keeps it:\nGoals:\nGrow saves on Instagram.";
  const REVISE = { brand: "Pay The Pyper", voiceBlock: "Voice.", note: "Less formal", scope: "untouched" as const, posts: [{ id: "a", date: "2026-10-27", platform: "Instagram", format: null, pillar: null, copy: "Old copy", reason: "Why" }], pillars: [{ name: "Beer League Truths" }], languages: ["en"], evidence: EVIDENCE, others: [] };

  it("leaves both prompts exactly as they were for a client without a strategy", () => {
    expect(weekPrompt({ ...CTX, strategy: "" })).toBe(weekPrompt(CTX));
    expect(revisePrompt({ ...REVISE, strategy: "" })).toBe(revisePrompt(REVISE));
    expect(weekPrompt(CTX)).not.toContain("content strategy");
  });

  it("gives the strategy once, right after the pillars, with the line that the rhythm, dates and evidence rules win", () => {
    for (const [withIt, without] of [[weekPrompt({ ...CTX, strategy: STRATEGY }), weekPrompt(CTX)], [revisePrompt({ ...REVISE, strategy: STRATEGY }), revisePrompt(REVISE)]]) {
      const sections = withIt.split("\n\n");
      const at = sections.findIndex((s) => s.startsWith(STRATEGY));
      expect(at).toBeGreaterThan(0);
      expect(sections[at - 1]).toMatch(/^Content pillars:/);
      expect(sections[at]).toBe(`${STRATEGY}\n${STRATEGY_PRECEDENCE}`);
      expect(STRATEGY_PRECEDENCE).toMatch(/^The posting rhythm, the dates and the evidence rules here win/);
      expect(withIt.split(STRATEGY).length).toBe(2);
      // Nothing else in the prompt moves.
      expect(withIt.replace(`\n\n${STRATEGY}\n${STRATEGY_PRECEDENCE}`, "")).toBe(without);
    }
  });
});

describe("parseWeekPlan", () => {
  it("keeps a trend's theme on the post's reason and types the post as a trend", () => {
    const trend: EvidenceItem = { id: "N1", kind: "trend", text: "POV: you are the captain", theme: "Captain POV skits", company: "@benchpro", platform: "TikTok", format: "short_video", date: "2026-10-14", link: "https://t/1", metric: "engagement", value: 5400 };
    const [p] = parseWeekPlan(JSON.stringify({ posts: [post({ reason_type: "trend", evidence_ids: ["N1"] })] }), { ...CTX, evidence: [...EVIDENCE, trend] });
    expect(p.reasons[0].type).toBe("trend");
    expect(p.reasons[0].evidence?.[0]).toMatchObject({ theme: "Captain POV skits", link: "https://t/1" });
    expect(p.reasons[0].label).toBe('Inspired by "Captain POV skits": @benchpro\'s TikTok short video from Oct 14. Captains live this every week.');
  });

  it("builds each reason from the evidence's own numbers and the model's fit sentence", () => {
    const [p] = parseWeekPlan(JSON.stringify({ posts: [post({})] }), CTX);
    expect(p.reasons[0].type).toBe("competitor");
    expect(p.reasons[0].label).toBe("BenchApp's Instagram video from Oct 14 got 4x their usual engagement per follower. Captains live this every week. Early signal.");
    expect(p.reasons[0].evidence?.[0]).toMatchObject({ id: "C1", link: "https://c/1", multiple: 4 });
    expect(p.reasons[0]).toMatchObject({ fit: "Captains live this every week", test: false });
    expect(p.source).toBe("plan");
  });

  it("drops posts outside the usable dates, beyond a platform's rhythm, or on platforms outside it", () => {
    const posts = parseWeekPlan(JSON.stringify({ posts: [
      post({ date: "2026-10-25" }),
      post({ date: "2026-10-27" }),
      post({ date: "2026-10-29" }),
      post({ date: "2026-10-30" }),
      post({ platform: "LinkedIn" }),
      post({ platform: "Facebook", evidence_ids: ["P1"] }),
      post({ copy: "" }),
    ] }), CTX);
    expect(posts.map((p) => `${p.post_date} ${p.platform}`)).toEqual(["2026-10-27 Instagram", "2026-10-29 Instagram", "2026-10-27 Facebook"]);
  });

  it("counts posts people already added toward the rhythm", () => {
    const posts = parseWeekPlan(JSON.stringify({ posts: [post({}), post({ date: "2026-10-29" })] }), { ...CTX, existing: [{ date: "2026-10-28", platform: "Instagram", copy: "Added by the team" }] });
    expect(posts).toHaveLength(1);
  });

  it("keeps only the first test, and ignores evidence ids that don't exist", () => {
    const posts = parseWeekPlan(JSON.stringify({ posts: [post({ test: true, evidence_ids: ["Z9", "P1"] }), post({ date: "2026-10-29", test: true })] }), CTX);
    expect(posts[0].reasons[0].type).toBe("test");
    expect(posts[0].reasons[0].label.startsWith("Test: Your Instagram carousel from Oct 5 got 2.7x your usual impressions.")).toBe(true);
    expect(posts[0].reasons[0].evidence?.map((e) => e.id)).toEqual(["P1"]);
    expect(posts[1].reasons[0].type).toBe("competitor");
  });

  it("returns nothing for a reply that isn't JSON", () => {
    expect(parseWeekPlan("Sorry, I can't.", CTX)).toEqual([]);
  });
});

describe("what clients read in a reason", () => {
  it("keeps the first sentence of the fit, and drops one that names an evidence id or runs long", () => {
    expect(clientFit("Captains live this every week. It doesn't repeat this week's topics.")).toBe("Captains live this every week.");
    expect(clientFit("This takes P7's strong topic and cuts it down.")).toBeUndefined();
    expect(clientFit("Pairs a hook with share asks, which R4 found drives engagement.")).toBeUndefined();
    expect(clientFit("x".repeat(200))).toBeUndefined();
    expect(clientFit(undefined)).toBeUndefined();
  });

  it("uses a report finding's headline, unless the part before the colon is only a label", () => {
    expect(headline("Carousel education can support clicks: Publish 1 rights-focused carousel weekly.")).toBe("Carousel education can support clicks");
    expect(headline("TikTok: post 3 weekly Myth vs Fact videos; measure completion.")).toBe("TikTok: post 3 weekly Myth vs Fact videos; measure completion");
    expect(headline("LinkedIn drove 464 of 465 clicks. More detail.")).toBe("LinkedIn drove 464 of 465 clicks");
  });
});

describe("buildReason", () => {
  it("writes topic, report and seasonal reasons in plain words", () => {
    expect(buildReason({ type: "competitor", evidence: [EVIDENCE[2]] }).label).toBe("2 competitors posted about Playoff scheduling this week.");
    expect(buildReason({ type: "performance", evidence: [EVIDENCE[3]], fit: "Lead with LinkedIn." }).label).toBe("From the monthly report: LinkedIn drove 464 of 465 clicks. Lead with LinkedIn.");
    expect(buildReason({ type: "seasonal", evidence: [], moment: "Halloween on Oct 31" })).toMatchObject({ type: "seasonal", label: "Halloween on Oct 31." });
  });

  it("stores the parts a reason is worded from, so it reads the same when worded again on screen", () => {
    const seasonal = buildReason({ type: "seasonal", evidence: [], moment: " Halloween on Oct 31 ", fit: "Fits the team. More notes." });
    expect(seasonal).toEqual({ type: "seasonal", label: "Halloween on Oct 31. Fits the team.", fit: "Fits the team.", moment: "Halloween on Oct 31", test: false });
    const test = buildReason({ type: "competitor", evidence: [EVIDENCE[1]], fit: "Captains live this.", test: true });
    expect(test).toMatchObject({ type: "test", test: true, thin: true });
    for (const r of [seasonal, test, buildReason({ type: "performance", evidence: [] })]) expect(wordReason(r)).toBe(r.label);
  });
});

describe("revising", () => {
  it("asks for every post by id with the note, and reads back only known posts once", () => {
    const prompt = revisePrompt({ brand: "Moburst", voiceBlock: "Voice.", note: "Less formal", scope: "untouched", posts: [{ id: "a", date: "2026-10-27", platform: "LinkedIn", format: null, pillar: null, copy: "Old copy", reason: "Why" }], pillars: [], languages: [], evidence: [], others: [] });
    expect(prompt).toContain('The note: "Less formal"');
    expect(prompt).toContain("[a] 2026-10-27 LinkedIn");
    const out = parseRevision(JSON.stringify({ posts: [{ id: "a", copy: "New copy" }, { id: "a", copy: "Again" }, { id: "zz", copy: "Unknown" }] }), ["a"]);
    expect(out).toEqual([{ id: "a", copy: "New copy", pillar: null, hashtags: [], cta: null, visual_direction: null }]);
  });

  it("gives posts written from empty slots a reason from the evidence they cite", () => {
    const [p] = parseRevision(JSON.stringify({ posts: [{ id: "a", copy: "New", reason_type: "trend", evidence_ids: ["T1"], fit: "Fits" }] }), ["a"], EVIDENCE, true);
    expect(p.reason?.label).toBe("2 competitors posted about Playoff scheduling this week. Fits.");
  });
});
