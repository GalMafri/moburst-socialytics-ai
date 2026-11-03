// @vitest-environment node
// Writing a client's content strategy (spec: docs/superpowers/specs/2026-11-
// 02-content-strategy-tab-design.md, "Cost"), one model call per lifecycle
// run: write (Opus), check (Sonnet), fix if flagged (Opus), check again
// (Sonnet). Proves each code check rejects, that a bad or cut-off reply is
// asked again once in its own run and never read or kept, that flagged
// statements get one fix and one more check, that a write still failing ends
// with no strategy, the call counts, model ids and token limits, and what the
// evidence holds.
import { describe, expect, it } from "vitest";
import {
  CHECK_MAX_TOKENS, CHECK_MODEL, parseStrategy, readPending, savePending, saveStrategy, startStrategy, STRATEGY_MAX_TOKENS, STRATEGY_MODEL, strategyEvidence,
  strategyPhase, strategyProblems, strategyRequest, type PendingStrategy, type PhaseOutcome, type StrategyEvidence, type StrategyIO,
} from "./write";
import type { StrategyPlatform } from "./platforms";
import type { PlatformFigures } from "./basis";
import { fakeDb } from "../lifecycle/fakeDb";

const NOW = new Date("2026-11-02T10:00:00.000Z");

const fig = (platform: string, over: Partial<PlatformFigures> = {}): PlatformFigures => ({
  platform, basis: "none", posts: 0, posts_per_week: 0, median_engagement: null, rate: null, rate_kind: null, followers: null, ...over,
});
const platform = (name: string, state: StrategyPlatform["state"], over: Partial<StrategyEvidence["platforms"][number]> = {}): StrategyEvidence["platforms"][number] => ({
  platform: name, key: name.toLowerCase(), state, handle: null, profile_reason: null, cadence: { per_week: 2, source: "competitors" }, baseline: null, figures: fig(name), ...over,
});

const E: StrategyEvidence = {
  client: { name: "Pay The Pyper", market: ["US"], languages: ["es", "en"], first_language: "es" },
  brief: "Pay The Pyper keeps rec league captains from chasing payments.",
  pillars: [{ name: "Beer League Truths", description: "Funny truths", share: 60 }, { name: "Captain Life", description: "", share: null }],
  keywords: ["beer league"],
  brand_notes: "Never mock other apps.",
  brand_book: "",
  voice: "How Pay The Pyper writes.",
  site: "Pay The Pyper: payments, attendance and subs for captains.",
  competitors: ["BenchApp", "TeamSnap"],
  competitive_brief: "COMPETITIVE PICTURE: BenchApp posts memes.",
  profile: { audience: "Rec league captains.", fit_rubric: "Posts captains learn from.", exclusions: [{ term: "job ads", reason: "not the audience" }] },
  platforms: [
    platform("Instagram", "posting", {
      cadence: { per_week: 2.4, source: "published_8w" }, baseline: { posts: 31, posts_per_week: 2.41, median_engagement: 42, engagement_rate: 0.031 },
      figures: fig("Instagram", { basis: "measured", posts: 31, posts_per_week: 2.41, median_engagement: 42, rate: 0.031, rate_kind: "impression", followers: 1800 }),
    }),
    platform("TikTok", "new", { handle: "paythepyper" }),
    platform("Pinterest", "candidate", { profile_reason: "Captains plan seasons there." }),
    platform("YouTube", "candidate"),
    platform("LinkedIn", "candidate"),
  ],
  competitor_figures: [{ company: "BenchApp", client: false, platform: "Instagram", posts: 60, posts_per_week: 4.67, median_engagement: 18, rate_per_view: null, followers: 9100 }],
  window: { start: "2026-08-04", end: "2026-11-02" },
  written_on: "2026-11-02",
  evidence: [{ id: "P1", kind: "own", text: "Our playoff checklist", platform: "Instagram", format: "carousel", date: "2026-10-05", link: "https://instagram.com/p/1", metric: "impressions", value: 3000, median: 1100, multiple: 2.7, sample: 12 }],
  avoid: ["Instagram image from 2026-10-01 got 0.3x the usual impressions: Office day"],
  thin: [],
  edits: {},
  sources: ["brief", "website", "posts"],
};

const draft = (over: Record<string, unknown> = {}) => ({
  goals: [
    { title: "Grow engagement per post on Instagram", why: "Carousels beat the usual 2.7x.", platform: "Instagram", metric: "median_engagement", direction: "above" },
    { title: "Launch TikTok at a steady pace", why: "Captains watch short video.", platform: "TikTok", metric: "posts_per_week", direction: "above" },
  ],
  audience: { who: "Captains of adult rec teams who run the money.", wants: ["Less chasing", "Fair splits", "Time back"], where: ["Instagram", "TikTok"] },
  positioning: { statement: "The one app built around the captain's week.", points: [{ vs: "BenchApp", point: "BenchApp posts 4.67 times a week of memes; we post fewer, useful checklists." }] },
  pillars: [
    { name: "Beer League Truths", purpose: "Make captains laugh and share.", formats: ["carousel", "reel"], planned_share: 60, ideas: [{ hook: "Lo que nadie te dice", format: "reel" }, { hook: "El capitán de siempre", format: "carousel" }] },
    { name: "Captain Life", purpose: "Save captains time.", formats: ["carousel"], planned_share: 40, ideas: [{ hook: "Tu checklist", format: "carousel" }, { hook: "Martes de capitán", format: "reel" }] },
  ],
  platforms: [
    { platform: "Instagram", role: "Our home base.", post: ["Checklists", "League truths", "Reminders"], worked: ["P1"], checks: { day_30: "Saves per post", day_90: "Engagement per post" } },
    { platform: "TikTok", role: "Reach new captains.", post: ["POV skits", "Quick tips", "Replies"], worked: [], first_30: ["Set up @paythepyper", "Three skits", "Reply videos", "Review"], checks: { day_30: "Views", day_90: "Follows" } },
    { platform: "Pinterest", role: "Season planning.", post: ["Boards", "Checklists", "Templates"], worked: [], first_30: ["Boards", "Pins", "Pins", "Review"], checks: { day_30: "Saves", day_90: "Clicks" } },
  ],
  candidates: [{ platform: "Pinterest", decision: "new", reason: "Captains plan seasons there." }, { platform: "YouTube", decision: "not_now", reason: "Long video is costly to make." }, { platform: "LinkedIn", decision: "not_now", reason: "Captains are not there as captains." }],
  avoid: [{ pattern: "Office photos with no captain in them", source: "posts" }, { pattern: "Job ads", source: "trend_profile" }],
  ...over,
});
const reply = (d: unknown, usage = { input_tokens: 100, output_tokens: 50 }, stopReason = "end_turn") => ({ text: JSON.stringify(d), stopReason, raw: { usage } });
/** A reply the model stopped because it ran out of room: whatever it holds is never read. */
const cutOff = (d: unknown) => reply(d, { input_tokens: 100, output_tokens: 16000 }, "max_tokens");
const clean = { text: JSON.stringify({ unsupported: [] }), stopReason: "end_turn", raw: { usage: { input_tokens: 10, output_tokens: 5 } } };
const flagged = (statement = "x") => ({ text: JSON.stringify({ unsupported: [{ section: "goals", statement }] }), stopReason: "end_turn", raw: {} });
const goals = (title: string) => [{ ...draft().goals[0], title }, draft().goals[1]];

/** A stand-in for the Messages API: answers in order, and keeps every request. */
function calls(...answers: Array<{ text: string; stopReason?: string; raw?: unknown }>) {
  const bodies: Array<Record<string, any>> = [];
  const call = async ({ body }: { apiKey: string; body: Record<string, unknown> }) => {
    bodies.push(body);
    const next = answers.shift();
    if (!next) throw new Error("no more answers");
    return next;
  };
  return { call, bodies };
}

/** The write as the lifecycle runs it: one phase per run, each run exactly one model call, until it passes or is over. */
async function drive(...answers: Array<{ text: string; stopReason?: string; raw?: unknown }>) {
  const { call, bodies } = calls(...answers);
  let pending: PendingStrategy = startStrategy(E, "key-1", NOW);
  const phases: string[] = [];
  const kept: PendingStrategy[] = [];
  for (let run = 0; run < 10; run++) {
    const before = bodies.length;
    phases.push(pending.phase);
    const out: PhaseOutcome = await strategyPhase(call, "key", pending);
    expect(bodies.length - before).toBe(1);
    if (out.kind !== "next") return { out, phases, bodies, kept };
    // What the next run reads back is what was stored, as JSON.
    pending = JSON.parse(JSON.stringify(out.pending));
    kept.push(pending);
  }
  throw new Error("the write never ended");
}

describe("the code checks", () => {
  const problems = (over: Record<string, unknown>) => {
    const parsed = parseStrategy(JSON.stringify(draft(over)), E);
    return "error" in parsed ? parsed.error : "";
  };

  it("accept a reply that meets every rule", () => {
    const parsed = parseStrategy(`Here it is: ${JSON.stringify(draft())}`, E);
    expect(parsed).not.toHaveProperty("error");
  });

  it("reject every field over its cap", () => {
    expect(problems({ goals: goals("G".repeat(61)) })).toMatch(/Goal 1's title is 61 characters; keep it to 60/);
    expect(problems({ goals: [{ ...draft().goals[0], why: "W".repeat(141) }, draft().goals[1]] })).toMatch(/Goal 1's why/);
    expect(problems({ audience: { ...draft().audience, who: "W".repeat(121) } })).toMatch(/who is 121/);
    expect(problems({ audience: { ...draft().audience, wants: ["a", "b", "w".repeat(101)] } })).toMatch(/Want 3/);
    expect(problems({ positioning: { ...draft().positioning, statement: "S".repeat(141) } })).toMatch(/statement is 141/);
    expect(problems({ platforms: [{ ...draft().platforms[0], role: "R".repeat(101) }, ...draft().platforms.slice(1)] })).toMatch(/Instagram's role/);
    expect(problems({ platforms: [{ ...draft().platforms[0], post: ["a", "b", "p".repeat(121)] }, ...draft().platforms.slice(1)] })).toMatch(/post item 3/);
    expect(problems({ avoid: [{ pattern: "P".repeat(121), source: "posts" }] })).toMatch(/Pattern 1 to avoid/);
  });

  it("reject counts the fields do not allow", () => {
    expect(problems({ goals: [draft().goals[0]] })).toMatch(/two to four goals/);
    expect(problems({ goals: Array(5).fill(draft().goals[0]) })).toMatch(/two to four goals/);
    expect(problems({ audience: { ...draft().audience, wants: ["a", "b"] } })).toMatch(/exactly three wants/);
    expect(problems({ positioning: { ...draft().positioning, points: Array(4).fill(draft().positioning.points[0]) } })).toMatch(/at most three positioning points/);
    expect(problems({ platforms: [{ ...draft().platforms[0], post: ["a", "b"] }, ...draft().platforms.slice(1)] })).toMatch(/exactly three items/);
    expect(problems({ platforms: [draft().platforms[0], { ...draft().platforms[1], first_30: ["a"] }, draft().platforms[2]] })).toMatch(/TikTok is new, so it needs first_30/);
    expect(problems({ platforms: [{ ...draft().platforms[0], first_30: ["a", "b", "c", "d"] }, ...draft().platforms.slice(1)] })).toMatch(/Instagram is posting now, so it gets no first_30/);
    expect(problems({ avoid: Array(6).fill(draft().avoid[0]) })).toMatch(/at most five patterns/);
  });

  it("reject an enum outside its list", () => {
    expect(problems({ goals: [{ ...draft().goals[0], metric: "reach" }, draft().goals[1]] })).toMatch(/metric must be one of/);
    expect(problems({ goals: [{ ...draft().goals[0], direction: "up" }, draft().goals[1]] })).toMatch(/direction must be "above" or "below"/);
    expect(problems({ avoid: [{ pattern: "Office photos", source: "vibes" }] })).toMatch(/source must be posts, trend_profile or brief/);
  });

  it("reject a metric the platform's data does not allow, and a goal on a platform not in play", () => {
    // TikTok is new: no public posts, so only posts a week (it has no follower count either).
    expect(problems({ goals: [draft().goals[0], { ...draft().goals[1], metric: "median_engagement" }] })).toMatch(/Goal 2 measures median_engagement on TikTok, whose data allows only posts_per_week/);
    expect(problems({ goals: [draft().goals[0], { ...draft().goals[1], platform: "YouTube" }] })).toMatch(/Goal 2 is on YouTube, which is not a platform posting now or new/);
  });

  it("reject pillars that do not match the client's pillars exactly, and planned shares that do not add up to 100", () => {
    const [a, b] = draft().pillars;
    expect(problems({ pillars: [{ ...a, name: "Beer league truths" }, b] })).toMatch(/Beer League Truths/);
    expect(problems({ pillars: [a] })).toMatch(/Captain Life/);
    expect(problems({ pillars: [a, { ...b, planned_share: 30 }] })).toMatch(/add up to 90/);
    expect(problems({ pillars: [a, { ...b, ideas: [b.ideas[0]] }] })).toMatch(/exactly two ideas/);
  });

  it("reject a positioning point against a company that is not tracked", () => {
    expect(problems({ positioning: { statement: "x", points: [{ vs: "Spond", point: "y" }] } })).toMatch(/"Spond", which is not a tracked competitor/);
  });

  it("allow evidence ids only in worked, and only the brand's own posts on that platform", () => {
    expect(problems({ goals: [{ ...draft().goals[0], why: "Repeat what worked in P1." }, draft().goals[1]] })).toMatch(/only in a platform's worked list/);
    expect(problems({ platforms: [{ ...draft().platforms[0], worked: ["C1"] }, ...draft().platforms.slice(1)] })).toMatch(/C1 in Instagram's worked list is not one of the brand's own posts/);
    expect(problems({ platforms: [draft().platforms[0], { ...draft().platforms[1], worked: ["P1"] }, draft().platforms[2]] })).toMatch(/P1 is a Instagram post, not a TikTok one/);
    expect(problems({ audience: { ...draft().audience, who: "Captains — the people who pay." } })).toMatch(/em dash/);
    // A version name or a year is no evidence id.
    expect(problems({ goals: goals("Plan for Q4 2026 and the T-shirt drop") })).toBe("");
  });

  it("reject a platform without the section its state needs, a section for a platform that gets none, and undecided suggestions", () => {
    expect(problems({ platforms: draft().platforms.filter((p) => p.platform !== "TikTok") })).toMatch(/TikTok has no section/);
    expect(problems({ platforms: draft().platforms.filter((p) => p.platform !== "Pinterest") })).toMatch(/Pinterest has no section/);
    expect(problems({ platforms: [...draft().platforms, { ...draft().platforms[0], platform: "YouTube" }] })).toMatch(/YouTube is marked not now/);
    expect(problems({ candidates: draft().candidates.filter((c) => c.platform !== "LinkedIn") })).toMatch(/LinkedIn/);
    const allNew = draft().candidates.map((c) => ({ ...c, decision: "new" }));
    expect(problems({ candidates: allNew, platforms: [...draft().platforms, { ...draft().platforms[1], platform: "YouTube" }, { ...draft().platforms[1], platform: "LinkedIn" }] })).toMatch(/At most two/);
  });

  it("report every problem at once, not only the first", () => {
    const parsed = parseStrategy(JSON.stringify(draft({ goals: goals(""), audience: { ...draft().audience, who: "A — B" } })), E);
    expect("error" in parsed && parsed.error).toMatch(/title is missing[\s\S]*em dash/);
    expect(strategyProblems).toBeTypeOf("function");
  });
});


describe("writing a strategy, one model call per run", () => {
  it("writes in one run and checks in the next, as fields, with code's figures, dates and real posts", async () => {
    const { out, phases, bodies } = await drive(reply(draft(), { input_tokens: 1000, output_tokens: 700 }), clean);
    expect(phases).toEqual(["write", "check"]);
    expect(bodies.map((b) => b.model)).toEqual([STRATEGY_MODEL, CHECK_MODEL]);
    expect(STRATEGY_MODEL).toBe("claude-opus-5-5");
    expect(CHECK_MODEL).toBe("claude-sonnet-5-5");
    if (out.kind !== "passed") throw new Error(JSON.stringify(out));
    expect(out.usage).toEqual({ calls: { writer: 1, checker: 1 }, tokens: { [STRATEGY_MODEL]: { input: 1000, output: 700 }, [CHECK_MODEL]: { input: 10, output: 5 } } });
    expect(out.inputs_key).toBe("key-1");
    const s = out.value.sections as Record<string, any>;
    expect(Object.keys(s).sort()).toEqual([
      "audience", "avoid", "goals", "not_now", "pillar:Beer League Truths", "pillar:Captain Life",
      "platform:instagram:posting", "platform:pinterest:new", "platform:tiktok:new", "positioning",
    ]);
    // Code adds each goal's figure today and its date, 90 days on.
    expect(s.goals.items[0]).toMatchObject({ platform: "Instagram", metric: "median_engagement", direction: "above", baseline: 42, by: "2027-01-31" });
    expect(s.goals.items[1]).toMatchObject({ platform: "TikTok", metric: "posts_per_week", baseline: 0 });
    // An evidence id becomes the real post.
    expect(s["platform:instagram:posting"].worked).toEqual([{ date: "2026-10-05", multiple: 2.7, metric: "impressions", link: "https://instagram.com/p/1", text: "Our playoff checklist", format: "carousel" }]);
    expect(s["platform:instagram:posting"]).not.toHaveProperty("first_30");
    expect(s["platform:tiktok:new"].first_30).toHaveLength(4);
    expect(s.not_now).toEqual({ items: [{ platform: "YouTube", reason: "Long video is costly to make." }, { platform: "LinkedIn", reason: "Captains are not there as captains." }] });
    expect(out.value.platforms.map((p) => [p.platform, p.state, p.suggested])).toEqual([
      ["Instagram", "posting", false], ["TikTok", "new", false], ["Pinterest", "new", true], ["YouTube", "not_now", true], ["LinkedIn", "not_now", true],
    ]);
    // The code's numbers and the competitors' figures stay with each platform.
    expect(out.value.platforms[0]).toMatchObject({ cadence: { per_week: 2.4 }, figures: { basis: "measured", median_engagement: 42 }, competitors: [{ company: "BenchApp", posts_per_week: 4.67 }] });
    expect(out.value.platforms[3]).toMatchObject({ reason: "Long video is costly to make." });
  });

  it("gives the writer room to think and the checker room to list", async () => {
    const { bodies } = await drive(reply(draft()), clean);
    expect([bodies[0].max_tokens, bodies[1].max_tokens]).toEqual([16000, 4000]);
    expect([STRATEGY_MAX_TOKENS, CHECK_MAX_TOKENS]).toEqual([16000, 4000]);
  });

  it("asks once more, in its own run, with the problems named, when the reply breaks a rule", async () => {
    const { out, phases, bodies } = await drive(reply(draft({ goals: goals("Grow — fast") })), reply(draft()), clean);
    expect(phases).toEqual(["write", "reask", "check"]);
    expect(out.kind).toBe("passed");
    const again = bodies[1].messages as Array<{ role: string; content: string }>;
    expect(again.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(again[2].content).toMatch(/em dash/);
    expect(out.usage.calls).toEqual({ writer: 2, checker: 1 });
  });

  it("never reads or keeps a reply that was cut off, and asks again for a shorter one", async () => {
    // A cut-off reply may still hold JSON that parses; it is never read.
    const { out, phases, bodies, kept } = await drive(cutOff(draft({ goals: goals("The first answer's goal") })), reply(draft({ goals: goals("The second answer's goal") })), clean);
    expect(phases).toEqual(["write", "reask", "check"]);
    expect(JSON.stringify(kept[0])).not.toContain("The first answer's goal");
    const again = bodies[1].messages as Array<{ role: string; content: string }>;
    expect(again.map((m) => m.role)).toEqual(["user", "user"]);
    expect(again[1].content).toMatch(/cut off/);
    expect(out.kind === "passed" && (out.value.sections.goals as any).items[0].title).toBe("The second answer's goal");
  });

  it("ends the write when the second reply is cut off or breaks a rule, and checks nothing", async () => {
    for (const second of [cutOff(draft()), reply(draft({ goals: [] }))]) {
      const { out, phases, bodies } = await drive(reply(draft({ goals: [] })), second);
      expect(phases).toEqual(["write", "reask"]);
      expect(out.kind).toBe("over");
      expect(bodies.map((b) => b.model)).toEqual([STRATEGY_MODEL, STRATEGY_MODEL]);
    }
  });

  it("fixes the flagged statements in one run, then checks again in the next", async () => {
    const { out, phases, bodies } = await drive(reply(draft({ goals: goals("Double installs by March") })), flagged("Double installs by March"), reply(draft()), clean);
    expect(phases).toEqual(["write", "check", "fix", "recheck"]);
    expect(out.kind === "passed" && (out.value.sections.goals as any).items[0].title).toBe(draft().goals[0].title);
    expect(bodies.map((b) => b.model)).toEqual([STRATEGY_MODEL, CHECK_MODEL, STRATEGY_MODEL, CHECK_MODEL]);
    const fix = (bodies[2].messages as Array<{ role: string; content: string }>).at(-1)!;
    expect(fix.role).toBe("user");
    expect(fix.content).toContain("Double installs by March");
    // The check reads the evidence and every section of the strategy, as lines.
    expect(bodies[1].messages[0].content).toContain("Pay The Pyper keeps rec league captains");
    expect(bodies[1].messages[0].content).toContain("- Double installs by March (Instagram median engagement per post: 42 today, above it by 31 Jan 2027)");
  });

  it("ends the write when the fix is still flagged, after at most three Opus and two Sonnet calls", async () => {
    const { out, phases, bodies } = await drive(reply(draft({ goals: goals("A — b") })), reply(draft()), flagged(), reply(draft()), flagged());
    expect(phases).toEqual(["write", "reask", "check", "fix", "recheck"]);
    expect(out.kind).toBe("over");
    expect(bodies.filter((b) => b.model === STRATEGY_MODEL)).toHaveLength(3);
    expect(bodies.filter((b) => b.model === CHECK_MODEL)).toHaveLength(2);
    expect(out.usage.calls).toEqual({ writer: 3, checker: 2 });
  });

  it("ends the write when the fix is cut off or breaks a rule, without asking again", async () => {
    for (const fix of [cutOff(draft()), reply(draft({ goals: [] }))]) {
      const { out, phases } = await drive(reply(draft()), flagged(), fix);
      expect(phases).toEqual(["write", "check", "fix"]);
      expect(out.kind).toBe("over");
    }
  });

  it("ends the write when the check's reply cannot be read or was cut off", async () => {
    expect((await drive(reply(draft()), { text: "Looks fine to me.", stopReason: "end_turn", raw: {} })).out.kind).toBe("over");
    // A cut-off check that reads as "nothing unsupported" is no pass.
    expect((await drive(reply(draft()), { ...clean, stopReason: "max_tokens" })).out.kind).toBe("over");
  });

  it("keeps the evidence with the draft, so the runs after the first read nothing again", () => {
    const p = startStrategy(E, "key-1", NOW);
    expect(p).toMatchObject({ inputs_key: "key-1", phase: "write", evidence: E, usage: { calls: { writer: 0, checker: 0 }, tokens: {} } });
  });
});

describe("what the writer is told", () => {
  it("gives the evidence, the code's numbers, each platform's data basis and allowed metrics, the competitors' figures and the first content language", () => {
    const body = strategyRequest(E) as { system: string; messages: Array<{ content: string }> };
    const prompt = body.messages[0].content;
    for (const part of [
      "rec league captains", "Beer League Truths (60% of the brand's calendar posts over the last 8 weeks)", "2.4 posts a week", "median engagement per post 42", "3.1%",
      "@paythepyper", "Captains plan seasons there.", "BenchApp on Instagram: 4.67 posts a week", "Our playoff checklist", "2.7x", "Never mock other apps.", "job ads", "Office day",
      "data: Instagram from Sprout", "goal metrics allowed: posts_per_week, median_engagement, engagement_rate, followers", "data: TikTok: no public posts found", "goal metrics allowed: posts_per_week.",
      "written on 2026-11-02",
    ]) {
      expect(prompt).toContain(part);
    }
    // The brand's own posts keep their id, for worked; nothing else does.
    expect(prompt).toMatch(/^- P1 \[/m);
    expect(`${body.system}\n${prompt}`).toMatch(/hooks in the brand's first content language \(es\)/i);
    expect(`${body.system}\n${prompt}`).toMatch(/"we" for Moburst/);
    expect(`${body.system}\n${prompt}`).toMatch(/never quote or describe one of the brand's own posts/);
    expect(`${body.system}\n${prompt}`).not.toMatch(/—/);
  });

  it("gives a pillar's share only where the client's calendar has posts", () => {
    const prompt = (strategyRequest(E) as { messages: Array<{ content: string }> }).messages[0].content;
    expect(prompt).toMatch(/^- Captain Life$/m);
    const none = (strategyRequest({ ...E, pillars: E.pillars.map((p) => ({ ...p, share: null })) }) as { system: string; messages: Array<{ content: string }> });
    expect(none.messages[0].content).not.toMatch(/% of/);
    expect(none.messages[0].content).toContain("- Beer League Truths: Funny truths");
  });

  it("gives people's versions as fixed context, to keep the other sections consistent with them", () => {
    const prompt = (strategyRequest({ ...E, edits: { audience: "Captains and their co-captains." } }) as { messages: Array<{ content: string }> }).messages[0].content;
    expect(prompt).toContain("Captains and their co-captains.");
    expect(prompt).toMatch(/team's own versions/i);
    expect((strategyRequest(E) as { messages: Array<{ content: string }> }).messages[0].content).not.toMatch(/team's own versions/i);
  });
});


describe("the evidence a strategy is written from", () => {
  const client = (over: Record<string, unknown> = {}) => ({
    id: "c1", name: "Pay The Pyper", website_url: "https://paythepyper.com", geo: "US", language: "es,en", brief_text: "B".repeat(7000),
    content_pillars: [{ name: "Beer League Truths", description: "Funny" }, "Captain Life", { name: "Rink Rules" }], social_keywords: ["beer league"], brand_notes: "",
    primary_platforms: ["Instagram", "TikTok"], field_sources: { primary_platforms: { by: "person" } }, posting_rhythm: null, strategy_doc_file_path: null, ...over,
  });
  const io = (over: Partial<StrategyIO> = {}): StrategyIO => ({
    gather: async () => ({
      own: [{ id: "1", platform: "Instagram", format: "image", publishedAt: "2026-10-20T12:00:00Z", text: "x", link: null, impressions: 100, engagement: 5 }],
      learnedRhythm: [{ platform: "Instagram", perWeek: 1, days: [], time: null, average: 0.9, source: "published_8w" }],
      evidence: [], avoid: [], thin: [], examples: {}, fallbackRates: { competitors: {}, allTracked: null },
    }),
    trackedRates: async () => ({ TikTok: 2 }),
    voiceBlock: async () => "How Pay The Pyper writes.",
    competitiveBrief: async () => "",
    competitorSet: async () => [{ name: "BenchApp" }],
    siteText: async () => "Pay The Pyper: payments, attendance and subs for captains.",
    feedSnapshots: async () => [],
    ...over,
  });
  const post = (post_date: string, pillar: string | null, client_id = "c1") => ({ client_id, post_date, pillar });
  const tables = (over: Record<string, Record<string, unknown>[]> = {}) => ({
    trend_profiles: [{ client_id: "c1", audience: "Captains.", fit_rubric: "Fits.", platforms: [{ platform: "instagram", reason: "primary" }, { platform: "pinterest", reason: "Plans." }], written_at: "2026-11-01T00:00:00Z" }],
    trend_terms: [{ client_id: "c1", kind: "exclusion", platform: null, term: "job ads", reason: "r", source: "lifecycle", removed_at: null }],
    sprout_profiles: [{ client_id: "c1", network_type: "tiktok", native_name: "paythepyper", is_active: true }],
    clients: [{ id: "c1", brand_book_text: "Book" }],
    calendar_posts: [],
    content_strategy_edits: [
      { client_id: "c1", section_key: "audience", text: "Captains and co-captains." },
      { client_id: "c1", section_key: "pillar:Old pillar", text: "Kept, hidden." },
      { client_id: "c1", section_key: "platform:pinterest:new", text: "Our Pinterest plan." },
      { client_id: "c1", section_key: "positioning", text: "ignored", value: { statement: "Built for captains.", points: [] } },
    ],
    ...over,
  });

  it("waits for the trend profile", async () => {
    expect(await strategyEvidence(fakeDb({}), client(), NOW, io())).toBeNull();
  });

  it("reads the brief capped, every platform's state, and the people's versions still in play", async () => {
    const e = (await strategyEvidence(fakeDb(tables()), client(), NOW, io()))!;
    expect(e.brief).toHaveLength(6000);
    expect(e.client).toMatchObject({ languages: ["es", "en"], first_language: "es" });
    expect(e.platforms.map((p) => [p.platform, p.state, p.handle])).toEqual([["Instagram", "posting", null], ["TikTok", "new", "paythepyper"], ["Pinterest", "candidate", null]]);
    // TikTok had no rate among the competitors, so every tracked company's were read.
    expect(e.platforms[1].cadence).toEqual({ per_week: 2, source: "all_tracked" });
    expect(e.profile.exclusions).toEqual([{ term: "job ads", reason: "r" }]);
    expect(e.brand_book).toBe("Book");
    expect(e.competitors).toEqual(["BenchApp"]);
    // An edit whose pillar left the strategy is kept but not in play; a suggested platform's launch plan is.
    // A 2 Nov text edit as its text, a v2 edit by its fields, as lines.
    expect(e.edits).toEqual({ audience: "Captains and co-captains.", "platform:pinterest:new": "Our Pinterest plan.", positioning: "Built for captains." });
    expect(e.sources).toEqual(["brief", "website", "brand_book", "competitors", "posts"]);
  });

  it("gives a client without Sprout its public posts, its figures per platform and its competitors' figures from the same read", async () => {
    const feed = [{ payload: { client_company_id: "1", window: { start: "2026-10-26", end: "2026-11-01" }, socialPosts: [
      { postId: "f1", companyId: "2", companyName: "BenchApp", channel: "instagram", publishedAt: "2026-10-20T00:00:00Z", message: "m", postLink: "https://instagram.com/p/f1", engagementTotal: 30, type: "image", presenceReach: 9100 },
    ] } }];
    const tiktok = (i: number, engagement: number) => ({
      company: "Pay The Pyper", client: true, platform: "TikTok", id: `t${i}`, publishedAt: new Date(NOW.getTime() - (3 + i * 6) * 86_400_000).toISOString(), text: `video ${i}`,
      link: `https://www.tiktok.com/@paythepyper/video/${i}`, format: "short_video", engagement, views: engagement * 20, followers: 2400, boosted: false, source: "apify" as const,
    });
    const read = { key: "k", status: "done" as const, started_at: NOW.toISOString(), read_at: NOW.toISOString(), window: { start: "2026-08-04", end: "2026-11-02" }, runs: [], posts: Array.from({ length: 13 }, (_, i) => tiktok(i, 10 + i)) };
    const empty = io({ gather: async () => ({ own: [], learnedRhythm: [], evidence: [], avoid: [], thin: [], examples: {}, fallbackRates: { competitors: {}, allTracked: {} } }), feedSnapshots: async () => feed });
    const e = (await strategyEvidence(fakeDb(tables({ sprout_profiles: [] })), client({ primary_platforms: [], field_sources: {} }), NOW, empty, read))!;
    const tt = e.platforms.find((p) => p.platform === "TikTok")!;
    expect(tt.state).toBe("posting");
    expect(tt.figures).toMatchObject({ basis: "public", posts: 13, followers: 2400, rate_kind: "view", rate: 0.05 });
    expect(e.competitor_figures).toEqual([expect.objectContaining({ company: "BenchApp", platform: "Instagram", posts: 1, followers: 9100 })]);
    // Its best public posts become the brand's own evidence, with ids for worked.
    expect(e.evidence.filter((x) => x.kind === "own").map((x) => x.id)).toContain("P1");
    expect(e.window).toEqual({ start: "2026-08-04", end: "2026-11-02" });
  });

  it("shares each pillar by the client's own calendar posts over the last 8 weeks", async () => {
    const posts = [
      post("2026-10-30", "Beer League Truths"), post("2026-10-20", "Beer League Truths"), post("2026-09-10", " beer league truths "),
      post("2026-10-01", "Captain Life"), post("2026-10-02", null),
      post("2026-08-20", "Captain Life"), // more than 8 weeks ago
      post("2026-11-09", "Captain Life"), // planned, not posted yet
      post("2026-10-15", "Captain Life", "c2"), // another client's
    ];
    const e = (await strategyEvidence(fakeDb(tables({ calendar_posts: posts })), client(), NOW, io()))!;
    expect(e.pillars).toEqual([
      { name: "Beer League Truths", description: "Funny", share: 60 },
      { name: "Captain Life", description: "", share: 20 },
      { name: "Rink Rules", description: "", share: 0 },
    ]);
  });

  it("gives no share at all for a client with no calendar posts in the last 8 weeks", async () => {
    const e = (await strategyEvidence(fakeDb(tables({ calendar_posts: [post("2026-08-01", "Captain Life"), post("2026-11-20", "Rink Rules")] })), client(), NOW, io()))!;
    expect(e.pillars.map((p) => p.share)).toEqual([null, null, null]);
  });
});

describe("keeping a write between runs, and saving it", () => {
  it("keeps the draft on the client's strategy row, and drops it", async () => {
    const db = fakeDb({ content_strategies: [{ client_id: "c1", sections: { goals: "The last good goals." }, inputs_key: "old", written_at: "2026-10-01T00:00:00.000Z", pending: null }] });
    const pending = startStrategy(E, "key-1", NOW);
    await savePending(db, "c1", pending, NOW);
    expect(await readPending(db, "c1")).toEqual(pending);
    // The stored strategy is untouched while a new one is under way.
    expect(db.tables.content_strategies[0]).toMatchObject({ sections: { goals: "The last good goals." }, inputs_key: "old" });
    await savePending(db, "c1", null, NOW);
    expect(await readPending(db, "c1")).toBeNull();
    // A client with no strategy yet gets a row that holds only the draft.
    const fresh = fakeDb({});
    await savePending(fresh, "c1", pending, NOW);
    expect(fresh.tables.content_strategies).toHaveLength(1);
    expect(fresh.tables.content_strategies[0]).toMatchObject({ client_id: "c1", pending, updated_at: NOW.toISOString() });
    expect(fresh.tables.content_strategies[0]).not.toHaveProperty("written_at");
  });

  it("writes the product's version, the platforms with their numbers, the key, the date, the models and the tokens, clears the draft, and never touches people's versions", async () => {
    const db = fakeDb({ content_strategy_edits: [{ client_id: "c1", section_key: "goals", text: "Ours." }] });
    const { out } = await drive(reply(draft()), clean);
    if (out.kind !== "passed") throw new Error(JSON.stringify(out));
    await saveStrategy(db, "c1", out, NOW);
    expect(db.tables.content_strategies).toHaveLength(1);
    expect(db.tables.content_strategies[0]).toMatchObject({
      client_id: "c1", inputs_key: "key-1", written_at: NOW.toISOString(), sources: ["brief", "website", "posts"], pending: null,
      pillars: [{ name: "Beer League Truths", share: 60 }, { name: "Captain Life", share: null }],
      models: { writer: STRATEGY_MODEL, checker: CHECK_MODEL }, usage: out.usage, shape: 2,
    });
    expect(db.tables.content_strategies[0].sections.goals.items[0].title).toBe(draft().goals[0].title);
    expect(db.tables.content_strategy_edits).toEqual([{ client_id: "c1", section_key: "goals", text: "Ours." }]);
  });
});
