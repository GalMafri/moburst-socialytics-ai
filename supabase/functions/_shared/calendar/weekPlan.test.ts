import { describe, it, expect } from "vitest";
import { buildReason, parseRevision, parseWeekPlan, revisePrompt, weekPrompt, type WeekContext } from "./weekPlan";
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
    { platform: "Instagram", perWeek: 2, days: ["Tuesday", "Thursday"], time: "17:00", average: 2.1, source: "published" },
    { platform: "Facebook", perWeek: 1, days: ["Wednesday"], time: null, average: 0.9, source: "published" },
  ],
  evidence: EVIDENCE,
  avoid: ["Instagram image from Oct 1 got 0.3x the usual impressions"],
  competitiveBrief: "Rejected by the team: Don't mock other apps",
  existing: [],
  recent: [],
  thin: [],
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
});

describe("parseWeekPlan", () => {
  it("builds each reason from the evidence's own numbers and the model's fit sentence", () => {
    const [p] = parseWeekPlan(JSON.stringify({ posts: [post({})] }), CTX);
    expect(p.reasons[0].type).toBe("competitor");
    expect(p.reasons[0].label).toBe("BenchApp's Instagram video from Oct 14 got 4x their usual engagement per follower. Captains live this every week. Early signal.");
    expect(p.reasons[0].evidence?.[0]).toMatchObject({ id: "C1", link: "https://c/1", multiple: 4 });
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

describe("buildReason", () => {
  it("writes topic, report and seasonal reasons in plain words", () => {
    expect(buildReason({ type: "competitor", evidence: [EVIDENCE[2]] }).label).toBe("2 competitors posted about Playoff scheduling this week.");
    expect(buildReason({ type: "performance", evidence: [EVIDENCE[3]], fit: "Lead with LinkedIn." }).label).toBe("From the monthly report: LinkedIn drove 464 of 465 clicks. Lead with LinkedIn.");
    expect(buildReason({ type: "seasonal", evidence: [], moment: "Halloween on Oct 31" })).toMatchObject({ type: "seasonal", label: "Halloween on Oct 31." });
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
