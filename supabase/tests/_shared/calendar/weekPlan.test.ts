import { describe, it, expect } from "vitest";
import { assetRule, buildReason, clientFit, factsRule, headline, outsideRule, parseRevision, parseWeekPlan, reasonForPlanner, revisePrompt, STRATEGY_PRECEDENCE, storyPlan, trendLines, weekPrompt, withStories, type PlannedPost, type WeekContext } from "../../../functions/_shared/calendar/weekPlan";
import type { CopyCheck, RefusedPost } from "../../../functions/_shared/calendar/copyChecks";
import { wordReason } from "../../../functions/_shared/calendar/reasonText";
import type { EvidenceItem } from "../../../functions/_shared/calendar/evidence";
import { imageAspectRatio, videoAspectRatio } from "../../../functions/_shared/design-prompts/aspect";

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
    // The theme, then the post by platform, format and date: never its caption, never who posted it (copy sources, 17 Nov 2026).
    expect(p).toContain('Theme "Captain POV skits".\nN1 [TikTok short_video, 2026-10-14] Lesson: not summarized');
    expect(p).toContain("Industry trends this week");
    expect(p).not.toContain("Platform trends from the latest monthly report");
    expect(p).not.toContain("POV: you are the captain");
    expect(p).not.toContain("@benchpro");
  });

  // Copy sources, 17 Nov 2026: an outside post gives the planner a subject and nothing more. Invented companies below.
  describe("what the planner reads of outside posts", () => {
    const OUTSIDE: EvidenceItem[] = [
      { id: "P1", kind: "own", text: "Our aftercare guide", platform: "Instagram", format: "carousel", date: "2026-10-05", metric: "impressions", multiple: 2.7 },
      { id: "C1", kind: "competitor", text: "Our summer membership is back. Unlimited waxing.", company: "Brightside Wax", platform: "Instagram", format: "video", date: "2026-10-14", metric: "engagement per follower", multiple: 4, thin: true, subject: "Summer memberships" },
      { id: "C2", kind: "competitor", text: "Meet our new esthetician Priya.", company: "Glow Parlor", platform: "Facebook", format: "photo", date: "2026-10-15", metric: "engagement per follower", multiple: 2 },
      { id: "T1", kind: "topic", text: "Summer memberships: three studios posted offers", companies: 3 },
      { id: "N1", kind: "trend", text: "0:00 Why month-end drags 1:45 The checklist", company: "@ledgerlane", theme: "Aftercare myths", platform: "TikTok", format: "short_video", date: "2026-10-14", link: "https://t/1", metric: "engagement", value: 640,
        lesson: "Myth-busting in the first three seconds holds viewers.", matters: "People search these questions before they book", angle: "Answer the three questions guests ask at the desk." },
      { id: "N2", kind: "trend", text: "Hosted by Priya Nand, part 4 of the series", company: "@waxfacts", theme: "Aftercare myths", platform: "Instagram", format: "carousel", date: "2026-10-13", link: "https://t/2", metric: "engagement", value: 300, thin: true },
      { id: "N3", kind: "trend", text: "A trend with no theme", company: "@someone", platform: "LinkedIn", format: "image", link: "https://t/3", metric: "engagement", value: 10, lesson: "Short lists get saved." },
    ];
    const ctx = { ...CTX, brand: "Harbor Wax", evidence: OUTSIDE };
    const REVISE = { brand: "Harbor Wax", voiceBlock: "Voice.", note: "Warmer", posts: [{ id: "a", date: "2026-10-27", platform: "Instagram", format: "image", pillar: "Care", copy: "Old copy about aftercare", reason: "Why it was planned" }], pillars: [], languages: [], evidence: OUTSIDE, others: [] };

    it("shows a trend by its theme, why it matters, the angle and the post's lesson, and never its caption or author", () => {
      const p = weekPrompt(ctx);
      expect(p).toContain([
        "Industry trends this week: subjects other companies are covering now, described in our words (their captions are left out on purpose):",
        'Theme "Aftercare myths". Why it matters: People search these questions before they book. Angle for Harbor Wax: Answer the three questions guests ask at the desk.',
        "N1 [TikTok short_video, 2026-10-14] Lesson: Myth-busting in the first three seconds holds viewers.",
        "N2 [Instagram carousel, 2026-10-13, early signal] Lesson: not summarized",
        "N3 [LinkedIn image] Lesson: Short lists get saved.",
      ].join("\n"));
      for (const hidden of ["0:00 Why month-end drags", "Hosted by Priya Nand", "A trend with no theme", "@ledgerlane", "@waxfacts", "@someone"]) expect(p).not.toContain(hidden);
    });

    it("leaves out the part of a theme's line it does not have", () => {
      expect(trendLines("Harbor Wax", [{ id: "N1", kind: "trend", text: "x", theme: "Aftercare myths", platform: "TikTok", format: "short_video", angle: "Answer the desk questions!" }])).toEqual([
        'Theme "Aftercare myths". Angle for Harbor Wax: Answer the desk questions!',
        "N1 [TikTok short_video] Lesson: not summarized",
      ]);
      expect(trendLines("Harbor Wax", [])).toEqual([]);
    });

    it("shows a competitor's post by its format, date, numbers and subject, and never its caption or company", () => {
      const p = weekPrompt(ctx);
      expect(p).toContain([
        "Competitor posts that beat that competitor's usual numbers this week, by format and subject (their captions are left out on purpose):",
        "C1 [Instagram video, 2026-10-14, 4x their usual engagement per follower, early signal] Subject: Summer memberships",
        "C2 [Facebook photo, 2026-10-15, 2x their usual engagement per follower] Subject: not summarized",
      ].join("\n"));
      for (const hidden of ["Our summer membership is back", "Meet our new esthetician", "Brightside Wax", "Glow Parlor"]) expect(p).not.toContain(hidden);
      // The client's own post, the topic and the report read as they always did.
      expect(p).toContain("P1 [Instagram carousel, 2026-10-05, 2.7x the client's usual impressions] Our aftercare guide");
      expect(p).toContain("T1 [3 companies] Summer memberships: three studios posted offers");
    });

    it("gives both prompts the same three rules, word for word", () => {
      expect(outsideRule("Harbor Wax")).toBe("- C, T and N evidence is what other companies posted. It says which subject is timely and nothing more. Write the post from Harbor Wax's own material: its P and R evidence, pillars, notes and voice. Never take an outside post's wording, facts, figures, people, examples or production details (chapters, series names, who appears), and never name who posted it. Use an outside subject only when it fits the client's pillars, audience and services, and say how in fit.");
      expect(factsRule("Harbor Wax")).toBe("- Never invent facts: no names, titles, numbers, quotes, client results, launches or claims about people that aren't in Harbor Wax's own evidence (P, R and M), the pillars or the voice section.");
      // The asset rule names exactly the client's own material the prompt holds, so an ordinary call to action stays allowed.
      expect(assetRule("Harbor Wax")).toBe('- Tell the reader to watch, read, download, join or attend only something that Harbor Wax\'s own material here shows exists: its own posts (P), its report (R) or the voice section (what Harbor Wax told the team, and its own example posts). An outside post (C, T, N) never shows that Harbor Wax has one. Then refers_to is {"what":"video|guide|page|event|offer","evidence_id":"P1"}: the P or R id that shows it, or "notes" or "voice" for the part of Harbor Wax\'s material that names it. When the post points to nothing that already exists, refers_to is null. Never write a list of video chapters or their times: a planned video has none yet.');
      expect(assetRule("Harbor Wax", { pillars: true, strategy: true })).toContain("shows exists: its own posts (P), its report (R), its pillars, its content strategy or the voice section (what Harbor Wax told the team, and its own example posts).");
      expect(assetRule("Harbor Wax", { pillars: true, strategy: true })).toContain('or "notes", "pillars", "strategy" or "voice" for the part');
      expect(assetRule("Harbor Wax", { pillars: true })).toContain('or "notes", "pillars" or "voice" for the part');
      expect(assetRule("Harbor Wax", { strategy: true })).not.toContain("pillars");
      // A clock time is ordinary copy: the rule forbids a chapter list and nothing else about times.
      expect(assetRule("Harbor Wax")).not.toMatch(/time codes/);
      const week = weekPrompt(ctx);
      expect(week).toContain(`- Every post acts on the evidence above: list the ids in evidence_ids.\n${outsideRule("Harbor Wax")}\n`);
      // This client has pillars and no strategy; the revision below has neither.
      expect(week).toContain(`${factsRule("Harbor Wax")}\n${assetRule("Harbor Wax", { pillars: true })}\n`);
      expect(weekPrompt({ ...ctx, strategy: "Lead with aftercare." })).toContain(assetRule("Harbor Wax", { pillars: true, strategy: true }));
      expect(weekPrompt({ ...ctx, pillars: [] })).toContain(assetRule("Harbor Wax"));
      for (const scope of ["empty", "replan"] as const) {
        expect(revisePrompt({ ...REVISE, scope })).toContain([factsRule("Harbor Wax"), outsideRule("Harbor Wax"), assetRule("Harbor Wax")].join("\n"));
      }
      // A rewrite from a note keeps what its posts already say: the facts rule names them, and the other two are the same.
      const untouched = revisePrompt({ ...REVISE, scope: "untouched" });
      expect(untouched).toContain(["- Never invent facts: no names, titles, numbers, quotes, client results, launches or claims about people that aren't in the posts as they stand, Harbor Wax's own evidence (P, R and M), the pillars or the voice section.", outsideRule("Harbor Wax"), assetRule("Harbor Wax")].join("\n"));
      // The rule both prompts had before named "the evidence", which included other companies' posts.
      for (const p of [week, untouched]) expect(p).not.toContain("that aren't in the evidence");
    });

    it("asks for refers_to in both replies", () => {
      expect(weekPrompt(ctx)).toContain('"fit":"...","refers_to":null,"test":false}]}');
      expect(revisePrompt({ ...REVISE, scope: "untouched" })).toMatch(/"visual_direction":"\.\.\.","refers_to":null\}\]\}$/);
      for (const scope of ["empty", "replan"] as const) expect(revisePrompt({ ...REVISE, scope })).toMatch(/"visual_direction":"\.\.\.","reason_type":"performance\|competitor\|trend\|seasonal","evidence_ids":\["\.\.\."\],"fit":"\.\.\.","refers_to":null\}\]\}$/);
    });

    it("shows a rewrite the evidence the same way: no caption, no author, trends under their theme", () => {
      const p = revisePrompt({ ...REVISE, scope: "empty" });
      expect(p).toContain("Evidence, by id:\nP1 [");
      expect(p).toContain('Theme "Aftercare myths". Why it matters:');
      expect(p).toContain("C1 [Instagram video, 2026-10-14, 4x their usual engagement per follower, early signal] Subject: Summer memberships");
      for (const hidden of ["Our summer membership is back", "Brightside Wax", "@ledgerlane", "0:00 Why month-end drags"]) expect(p).not.toContain(hidden);
    });

    it("writes a post again without its earlier copy or its earlier reason", () => {
      const p = revisePrompt({ ...REVISE, scope: "replan", note: "Write these posts again from the client's own material.", posts: [{ ...REVISE.posts[0], copy: "", reason: "" }] });
      expect(p).toContain("Write each of these posts again from the evidence. Keep its date, platform and format. Pick evidence for each and cite its ids. Its earlier copy is left out on purpose.");
      expect(p).toContain("- [a] 2026-10-27 Instagram image (pillar: Care)");
      expect(p).not.toContain("Current copy:");
      expect(p).not.toContain("Why it's planned:");
      // The other two scopes keep their own instruction.
      expect(revisePrompt({ ...REVISE, scope: "empty" })).toContain("Write each of these posts, which have no copy yet.");
      expect(revisePrompt({ ...REVISE, scope: "untouched" })).toContain("Rewrite each of these posts following the note.");
      expect(revisePrompt({ ...REVISE, scope: "untouched" })).toContain("Current copy: Old copy about aftercare");
    });

    it("words a rewrite's reason by its subject, and never names who posted an outside post", () => {
      const trend = buildReason({ type: "trend", evidence: [OUTSIDE[4]], fit: "Guests ask this at the desk." });
      const rival = buildReason({ type: "competitor", evidence: [OUTSIDE[1]], fit: "Memberships suit regulars." });
      expect(trend.label).toContain("@ledgerlane");
      expect(reasonForPlanner(trend)).toBe('Trend theme "Aftercare myths"');
      expect(rival.label).toContain("Brightside Wax");
      expect(reasonForPlanner(rival)).toBe("A competitor's Instagram video");
      for (const words of [reasonForPlanner(trend), reasonForPlanner(rival)]) expect(words).not.toMatch(/ledgerlane|Brightside/);
      // Any other reason reads as it does on screen.
      const own = buildReason({ type: "performance", evidence: [OUTSIDE[0]], fit: "Guests save these." });
      expect(reasonForPlanner(own)).toBe(wordReason(own));
      const topic = buildReason({ type: "competitor", evidence: [OUTSIDE[3]] });
      expect(reasonForPlanner(topic)).toBe("3 competitors posted about Summer memberships this week.");
    });

    it("keeps what only the planner reads off a post's reason", () => {
      const [p] = parseWeekPlan(JSON.stringify({ posts: [post({ reason_type: "trend", evidence_ids: ["N1", "C1"] })] }), { ...CTX, evidence: OUTSIDE });
      const refs = p.reasons[0].evidence!;
      expect(refs.map((r) => r.id)).toEqual(["N1", "C1"]);
      for (const ref of refs) for (const key of ["lesson", "matters", "angle", "subject"]) expect(ref).not.toHaveProperty(key);
      // What a reason is worded from stays: the theme, the excerpt, the author, the link, the numbers.
      expect(refs[0]).toEqual({ id: "N1", kind: "trend", text: "0:00 Why month-end drags 1:45 The checklist", company: "@ledgerlane", theme: "Aftercare myths", platform: "TikTok", format: "short_video", date: "2026-10-14", link: "https://t/1", metric: "engagement", value: 640 });
      expect(refs[1]).toMatchObject({ company: "Brightside Wax", multiple: 4, thin: true });
      const [r] = parseRevision(JSON.stringify({ posts: [{ id: "a", copy: "New", evidence_ids: ["C1"] }] }), ["a"], OUTSIDE, true);
      expect(r.reason?.evidence?.[0]).not.toHaveProperty("subject");
    });
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
      // Nothing else in the prompt moves, but the asset rule: it now counts the strategy as the client's own material.
      const rule = assetRule(CTX.brand, { pillars: true });
      expect(without).toContain(rule);
      expect(withIt.replace(`\n\n${STRATEGY}\n${STRATEGY_PRECEDENCE}`, "").replace(assetRule(CTX.brand, { pillars: true, strategy: true }), rule)).toBe(without);
    }
  });
});

/** A moment the judge kept (moments.ts momentEvidence). */
const M1: EvidenceItem = {
  id: "M1", kind: "moment", text: "Halloween", key: "us:halloween", category: "cultural_commercial", date: "2026-10-31", link: "https://www.timeanddate.com/holidays/us/halloween",
  fit: "Costume reels are where your followers already show up.", platform: "Instagram", format: "reel", metric: "engagement", value: 23, median: 10, multiple: 2.3, sample: 8,
};

describe("dated moments in the plan", () => {
  it("lists the checked moments by M id and asks every seasonal post to cite one, with no moments of the model's own", () => {
    const p = weekPrompt({ ...CTX, evidence: [...EVIDENCE, M1] });
    expect(p).toContain("Dated moments this week, each checked against the client");
    expect(p).toMatch(/M1 \[2026-10-31, cultural or commercial moment, [^\]]*2\.3x the client's usual engagement[^\]]*\] Halloween/);
    expect(p).toContain("A seasonal post cites one M id");
    expect(p).not.toContain("can carry a post instead");
    expect(p).not.toContain('"moment"');
  });

  it("tells the planner no post is seasonal in a week with no checked moment", () => {
    const p = weekPrompt(CTX);
    expect(p).not.toContain("Dated moments this week");
    expect(p).toContain("No dated moment checked out for this client this week, so no post is seasonal");
  });

  it("drops a seasonal post that cites no M id and notes it for staff", () => {
    const dropped: Array<Record<string, unknown>> = [];
    const posts = parseWeekPlan(JSON.stringify({ posts: [
      post({ reason_type: "seasonal", evidence_ids: [], moment: "Election Day on Nov 3", fit: "Ad auctions get pricier." }),
      post({ reason_type: "seasonal", evidence_ids: ["P1"], moment: "Black Friday", date: "2026-10-29" }),
      post({ platform: "Facebook", evidence_ids: ["P1"], reason_type: "performance" }),
    ] }), { ...CTX, evidence: [...EVIDENCE, M1] }, { dropped });
    expect(posts.map((p) => p.platform)).toEqual(["Facebook"]);
    expect(dropped).toEqual([
      expect.objectContaining({ date: "2026-10-27", platform: "Instagram", why: "seasonal post without a checked moment" }),
      expect.objectContaining({ date: "2026-10-29", platform: "Instagram" }),
    ]);
  });

  it("makes a post that cites a moment seasonal, worded from the evidence and the judge's sentence, never the model's moment", () => {
    const [p] = parseWeekPlan(JSON.stringify({ posts: [post({ reason_type: "performance", evidence_ids: ["P1", "M1"], moment: "Halloween on Oct 30", fit: "Spooky fun for captains." })] }), { ...CTX, evidence: [...EVIDENCE, M1] });
    expect(p.reasons[0]).toMatchObject({ type: "seasonal", fit: M1.fit, test: false });
    expect(p.reasons[0].moment).toBeUndefined();
    expect(p.reasons[0].evidence?.map((e) => e.id)).toEqual(["M1", "P1"]);
    expect(p.reasons[0].label).toBe("Halloween, Oct 31. Your Instagram reel for it last year got 2.3x your usual engagement. Costume reels are where your followers already show up.");
    expect(wordReason(p.reasons[0])).toBe(p.reasons[0].label);
  });

  it("never gives a rewritten empty slot a moment the evidence doesn't have", () => {
    const [p] = parseRevision(JSON.stringify({ posts: [{ id: "a", copy: "New", reason_type: "seasonal", evidence_ids: [], moment: "Election Day", fit: "Fits" }] }), ["a"], EVIDENCE, true);
    expect(p.reason).toMatchObject({ type: "performance" });
    expect(p.reason?.moment).toBeUndefined();
    const [q] = parseRevision(JSON.stringify({ posts: [{ id: "a", copy: "New", reason_type: "seasonal", evidence_ids: ["M1"], fit: "Fits" }] }), ["a"], [...EVIDENCE, M1], true);
    expect(q.reason).toMatchObject({ type: "seasonal", fit: M1.fit });
  });
});

describe("parseWeekPlan", () => {
  it("stores a fixed kind for any format the planner writes, not the text cut at 40 characters", () => {
    const formats: Array<[string, string]> = [
      ["video (animated text on soft designed background)", "video"], ["short_video", "short video"], ["Reel", "short video"], ["Reel (designed text-and-motion video)", "short video"], ["Carousel (5 slides)", "carousel"],
      ["Single Image", "image"], ["static image with quote", "image"], ["Text only", "text"], ["LinkedIn document", "document"],
    ];
    const text = JSON.stringify({ posts: formats.map(([format], i) => post({ format, date: "2026-10-27", platform: i % 2 ? "Facebook" : "Instagram" })) });
    const got = parseWeekPlan(text, { ...CTX, rhythm: [] }).map((p) => p.format);
    expect(got).toEqual(formats.map(([, kind]) => kind));
  });

  it("keeps a tall video tall: a planned Short or Reel is made 9:16, a plain video keeps the platform's shape", () => {
    const text = JSON.stringify({ posts: [
      post({ format: "Short", platform: "YouTube" }), post({ format: "reel", platform: "Facebook" }), post({ format: "short video", platform: "Facebook" }),
      post({ format: "video", platform: "YouTube" }),
    ] });
    const got = parseWeekPlan(text, { ...CTX, rhythm: [] });
    expect(got.map((p) => videoAspectRatio(p.platform, p.format))).toEqual(["9:16", "9:16", "9:16", "16:9"]);
    expect(got.map((p) => imageAspectRatio(p.platform, p.format))).toEqual(["9:16", "9:16", "9:16", "16:9"]);
  });

  it("stores the posting time as HH:MM whatever form the planner sends", () => {
    const times = ["6:45 PM", "18:45", "6 pm EST", "10:00 PM", "evening", ""];
    const text = JSON.stringify({ posts: times.map((posting_time) => post({ posting_time })) });
    expect(parseWeekPlan(text, { ...CTX, rhythm: [] }).map((p) => p.posting_time)).toEqual(["18:45", "18:45", "18:00", "22:00", null, null]);
  });

  it("asks the planner for one of the kinds and a 24-hour time", () => {
    const prompt = weekPrompt(CTX);
    expect(prompt).toContain('"format":"image|carousel|video|short video|text|document"');
    expect(prompt).toContain('"posting_time":"HH:MM"');
  });

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
    expect(posts[0].reasons[0].label.startsWith("Your Instagram carousel from Oct 5 got 2.7x your usual impressions.")).toBe(true);
    expect(posts[0].reasons[0].evidence?.map((e) => e.id)).toEqual(["P1"]);
    expect(posts[1].reasons[0].type).toBe("competitor");
  });

  // Copy sources, 17 Nov 2026 (invented names): a display name the client's Sprout account lists with decorations is saved plain.
  it("writes a listed display name plainly in copy, cta and visual direction, and leaves a reply alone when none is listed", () => {
    const names = [{ name: "Dana Reed ★★★★★", plain: "Dana Reed" }, { name: "Northwind Law - Trial Lawyers", plain: "Northwind Law" }];
    const reply = JSON.stringify({ posts: [post({ copy: "Congrats to Dana Reed ★★★★★ on five years with us.", cta: "Meet Dana Reed ★★★★★", visual_direction: "Dana Reed ★★★★★ outside Northwind Law - Trial Lawyers" })] });
    const [plain] = parseWeekPlan(reply, CTX, { names });
    expect(plain).toMatchObject({ copy: "Congrats to Dana Reed on five years with us.", cta: "Meet Dana Reed", visual_direction: "Dana Reed outside Northwind Law" });
    const [asWritten] = parseWeekPlan(reply, CTX);
    expect(asWritten.copy).toBe("Congrats to Dana Reed ★★★★★ on five years with us.");
    expect(asWritten.cta).toBe("Meet Dana Reed ★★★★★");
  });

  // Copy sources, 17 Nov 2026 (invented companies): a post that fails a copy check is not saved.
  describe("with the copy checks", () => {
    const check: CopyCheck = {
      outside: [{ id: "C1", kind: "competitor", author: "Brightside Wax", text: "Our summer membership is back. Unlimited waxing for one flat price every single month." }],
      own: { hosts: ["harborwax.example"], handles: ["harborwax"], text: "harbor wax", hasNotes: false },
    };
    const reply = (...posts: Array<Record<string, unknown>>) => JSON.stringify({ posts });

    it("refuses a post that borrows from an outside post: it takes no slot, and is listed with the reason and the outside id", () => {
      const refused: RefusedPost[] = [];
      // Instagram has 2 slots. The first post is refused; the two after it both fit.
      const posts = parseWeekPlan(reply(
        post({ date: "2026-10-27", copy: "Unlimited waxing for one flat price every single month.\nStarts today." }),
        post({ date: "2026-10-28", copy: "First wax free for new guests." }),
        post({ date: "2026-10-29", copy: "Aftercare, in three steps." }),
      ), CTX, { check, refused });
      expect(posts.map((p) => p.copy)).toEqual(["First wax free for new guests.", "Aftercare, in three steps."]);
      expect(refused).toEqual([{ date: "2026-10-27", platform: "Instagram", copy: "Unlimited waxing for one flat price every single month.", why: "shares wording with C1", ids: ["C1"], kind: "borrowed" }]);
    });

    it("refuses a chapter list, an outside link or handle, and a pointer the client's evidence does not show", () => {
      const refused: RefusedPost[] = [];
      const posts = parseWeekPlan(reply(
        post({ date: "2026-10-26", platform: "Facebook", copy: "0:00 Intro to waxing" }),
        post({ date: "2026-10-27", copy: "Clean copy.", cta: "More at brightside.shop" }),
        post({ date: "2026-10-28", copy: "Thanks @brightside_wax" }),
        post({ date: "2026-10-29", copy: "Watch our new video.", refers_to: { what: "video", evidence_id: "C1" } }),
        post({ date: "2026-10-30", copy: "Read our playoff checklist.", refers_to: { what: "guide", evidence_id: "P1" } }),
      ), CTX, { check, refused });
      expect(posts.map((p) => p.copy)).toEqual(["Read our playoff checklist."]);
      expect(refused.map((r) => r.why)).toEqual(["lists video chapter times", "links to brightside.shop, which is not the client's", "names @brightside_wax, which is not the client's", "points to something the client's evidence does not show"]);
      expect(refused.map((r) => r.kind)).toEqual(["chapters", "link", "handle", "pointer"]);
      expect(refused.every((r) => r.ids.length === 0)).toBe(true);
    });

    it("keeps a post that gives a clock time, a time range or opening hours", () => {
      const refused: RefusedPost[] = [];
      const posts = parseWeekPlan(reply(
        post({ date: "2026-10-27", copy: "Happy hour 4:00-6:00, live music 8:30." }),
        post({ date: "2026-10-28", copy: "Doors 6:30, show 7:00.", cta: "Open 9:00 to 17:30 on Saturday" }),
      ), CTX, { check, refused });
      expect(posts).toHaveLength(2);
      expect(refused).toEqual([]);
    });

    it("lets a post point to the pillars, the strategy or the voice section only when the planner was given them", () => {
      const pointing = (id: string) => reply(post({ date: "2026-10-27", copy: "Join our Thursday webinar.", refers_to: { what: "event", evidence_id: id } }));
      const given = { ...check, own: { ...check.own, material: ["pillars", "voice"] } };
      expect(parseWeekPlan(pointing("pillars"), CTX, { check: given })).toHaveLength(1);
      expect(parseWeekPlan(pointing("voice"), CTX, { check: given })).toHaveLength(1);
      expect(parseWeekPlan(pointing("strategy"), CTX, { check: given })).toHaveLength(0);
      expect(parseWeekPlan(pointing("pillars"), CTX, { check })).toHaveLength(0);
    });

    it("checks nothing when no check is given, as before", () => {
      expect(parseWeekPlan(reply(post({ copy: "0:00 Intro @brightside_wax" })), CTX)).toHaveLength(1);
    });

    it("keeps the week's one test when a second reply is read", () => {
      const again = parseWeekPlan(reply(post({ test: true })), CTX, { noTest: true });
      expect(again[0].reasons[0]).toMatchObject({ type: "competitor", test: false });
      expect(parseWeekPlan(reply(post({ test: true })), CTX)[0].reasons[0]).toMatchObject({ type: "test", test: true });
    });

    it("leaves a refused rewrite out, with its id and the reason, so the post keeps its copy", () => {
      const refused: RefusedPost[] = [];
      const out = parseRevision(reply({ id: "a", copy: "Unlimited waxing for one flat price every single month." }, { id: "b", copy: "First wax free, 9:00 to 17:30.", refers_to: null }, { id: "c", copy: "Chapters: 0:00 Intro, 1:20 The close" }), ["a", "b", "c"], [], false, { check, refused });
      expect(out.map((p) => p.id)).toEqual(["b"]);
      expect(refused).toEqual([
        { id: "a", date: "", platform: "", copy: "Unlimited waxing for one flat price every single month.", why: "shares wording with C1", ids: ["C1"], kind: "borrowed" },
        { id: "c", date: "", platform: "", copy: "Chapters: 0:00 Intro, 1:20 The close", why: "lists video chapter times", ids: [], kind: "chapters" },
      ]);
    });
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

  it("writes a listed display name plainly in a rewritten post's copy and cta", () => {
    const names = [{ name: "Dana Reed ★★★★★", plain: "Dana Reed" }];
    const reply = JSON.stringify({ posts: [{ id: "a", copy: "Thank you, Dana Reed ★★★★★.", cta: "Read Dana Reed ★★★★★'s story", visual_direction: "A portrait of Dana Reed ★★★★★" }] });
    expect(parseRevision(reply, ["a"], [], false, { names })).toEqual([expect.objectContaining({ id: "a", copy: "Thank you, Dana Reed.", cta: "Read Dana Reed's story", visual_direction: "A portrait of Dana Reed" })]);
    expect(parseRevision(reply, ["a"])[0].copy).toBe("Thank you, Dana Reed ★★★★★.");
  });

  it("gives posts written from empty slots a reason from the evidence they cite", () => {
    const [p] = parseRevision(JSON.stringify({ posts: [{ id: "a", copy: "New", reason_type: "trend", evidence_ids: ["T1"], fit: "Fits" }] }), ["a"], EVIDENCE, true);
    expect(p.reason?.label).toBe("2 competitors posted about Playoff scheduling this week. Fits.");
  });
});

describe("a week's Stories", () => {
  it("saves a feed post the model set to Story as an image", () => {
    const text = JSON.stringify({ posts: [post({ format: "Story" }), post({ format: "Instagram Story", date: "2026-10-29" })] });
    expect(parseWeekPlan(text, CTX).map((p) => p.format)).toEqual(["image", "image"]);
  });

  const planned = (over: Partial<PlannedPost>): PlannedPost => ({
    post_date: "2026-10-27", platform: "Instagram", format: "Reel", posting_time: "17:00", pillar: "Beer League Truths", copy: "Copy", hashtags: ["#a"], cta: "Download",
    visual_direction: "A rink", reasons: [buildReason({ type: "competitor", evidence: [] })], source: "plan", ...over,
  });
  let n = 0;
  const ids = () => `id-${++n}`;

  it("adds one Story for each of the soonest Instagram posts, up to the week's count, linked and dated with its post", () => {
    n = 0;
    const posts = [
      planned({ post_date: "2026-10-29", posting_time: "9:00", copy: "Thursday" }),
      planned({ post_date: "2026-10-27", posting_time: "17:00", copy: "Tuesday evening" }),
      planned({ post_date: "2026-10-27", posting_time: "9:00", copy: "Tuesday morning" }),
      planned({ platform: "Facebook", post_date: "2026-10-26", copy: "Facebook" }),
    ];
    const reason = { type: "story" as const, label: "Pay The Pyper posted 26 Instagram Stories in the last 90 days." };
    const rows = withStories(posts, 2, reason, ids);
    const stories = rows.filter((r) => r.format === "Story");
    // The two Tuesday posts are the soonest; each Story follows its post in the reply's order.
    expect(stories.map((s) => [s.post_date, s.posting_time, s.copy])).toEqual([["2026-10-27", "17:00", "Tuesday evening"], ["2026-10-27", "9:00", "Tuesday morning"]]);
    for (const s of stories) {
      const source = rows.find((r) => r.post_key === s.story_of)!;
      expect(rows[rows.indexOf(s) - 1]).toBe(source);
      expect(source).toMatchObject({ platform: "Instagram", post_date: s.post_date, copy: s.copy });
      expect(s).toMatchObject({ platform: "Instagram", hashtags: [], source: "plan", reasons: [reason] });
    }
    // Every row carries its key, so one insert writes the posts and their Stories together.
    expect(rows.every((r) => r.id && r.post_key === `post:${r.id}`)).toBe(true);
    expect(rows).toHaveLength(6);
  });

  it("is capped by the week's Instagram posts, and adds none on Facebook or without a count", () => {
    n = 0;
    const posts = [planned({ copy: "A" }), planned({ platform: "Facebook", copy: "B" })];
    const reason = { type: "story" as const, label: "One Story with each Instagram post." };
    expect(withStories(posts, 20, reason, ids).filter((r) => r.format === "Story")).toHaveLength(1);
    expect(withStories([planned({ platform: "Facebook" })], 3, reason, ids)).toEqual([planned({ platform: "Facebook" })]);
    expect(withStories(posts, 0, reason, ids)).toEqual(posts);
  });

  // Lital, 3 Nov 2026 (decision 3): every Instagram client gets Stories; one
  // with its own Story history in Sprout follows its own rate.
  describe("how many Stories, and why", () => {
    const ig = (n: number) => Array.from({ length: n }, (_, i) => planned({ copy: `IG ${i}` }));
    const week = [...ig(3), planned({ platform: "Facebook", copy: "FB" }), planned({ format: "Story", copy: "A Story already" })];

    it("follows the client's own rate when Sprout shows its Instagram Stories, saying how many it posted", () => {
      const plan = storyPlan({ stories: 26, perWeek: 2 }, "Pay The Pyper", week);
      expect(plan.count).toBe(2);
      expect(plan.reason).toEqual({ type: "story", label: "Pay The Pyper posted 26 Instagram Stories in the last 90 days." });
      expect(wordReason(plan.reason)).toBe("Pay The Pyper posted 26 Instagram Stories in the last 90 days.");
      expect(storyPlan({ stories: 1, perWeek: 0 }, "Bader Law", week)).toEqual({ count: 0, reason: { type: "story", label: "Bader Law posted 1 Instagram Story in the last 90 days." } });
    });

    it("gives one Story with each Instagram feed post to a client with no Story history, and none for Facebook", () => {
      const plan = storyPlan({ stories: 0, perWeek: 0 }, "Pay The Pyper", week);
      expect(plan).toEqual({ count: 3, reason: { type: "story", label: "One Story with each Instagram post." } });
      n = 0;
      const rows = withStories(week, plan.count, plan.reason, ids);
      expect(rows.filter((r) => r.format === "Story" && r.story_of).map((r) => r.copy)).toEqual(["IG 0", "IG 1", "IG 2"]);
      expect(rows.filter((r) => r.story_of && r.platform === "Facebook")).toEqual([]);
    });
  });
});
