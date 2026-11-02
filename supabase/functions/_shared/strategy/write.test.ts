// @vitest-environment node
// Writing a client's content strategy (spec: docs/superpowers/specs/2026-11-
// 02-content-strategy-tab-design.md, "Cost"): one Opus call writes it and one
// Sonnet call lists what the evidence does not support. Proves each code check
// rejects, that a bad reply is asked again once with its problems named, that
// flagged statements get one fix and one more check, that a strategy still
// flagged after that is not returned, the call counts and model ids, and what
// the evidence holds.
import { describe, expect, it } from "vitest";
import {
  CHECK_MODEL, evenShares, parseStrategy, saveStrategy, STRATEGY_MAX_TOKENS, STRATEGY_MODEL, strategyEvidence, strategyProblems, strategyRequest, writeStrategy,
  type StrategyEvidence, type StrategyIO,
} from "./write";
import type { StrategyPlatform } from "./platforms";
import { fakeDb } from "../lifecycle/fakeDb";

const NOW = new Date("2026-11-02T10:00:00.000Z");

const platform = (name: string, state: StrategyPlatform["state"], over: Partial<StrategyPlatform> = {}): StrategyPlatform => ({
  platform: name, key: name.toLowerCase(), state, handle: null, profile_reason: null, cadence: { per_week: 2, source: "competitors" }, baseline: null, ...over,
});

const E: StrategyEvidence = {
  client: { name: "Pay The Pyper", market: ["US"], languages: ["es", "en"], first_language: "es" },
  brief: "Pay The Pyper keeps rec league captains from chasing payments.",
  pillars: [{ name: "Beer League Truths", description: "Funny truths", share: 50 }, { name: "Captain Life", description: "", share: 50 }],
  keywords: ["beer league"],
  brand_notes: "Never mock other apps.",
  brand_book: "",
  voice: "How Pay The Pyper writes.",
  site: "Pay The Pyper: payments, attendance and subs for captains.",
  competitors: ["BenchApp", "TeamSnap"],
  competitive_brief: "COMPETITIVE PICTURE: BenchApp posts memes.",
  profile: { audience: "Rec league captains.", fit_rubric: "Posts captains learn from.", exclusions: [{ term: "job ads", reason: "not the audience" }] },
  platforms: [
    platform("Instagram", "posting", { cadence: { per_week: 2.4, source: "published_8w" }, baseline: { posts: 31, posts_per_week: 2.41, median_engagement: 42, engagement_rate: 0.031 } }),
    platform("TikTok", "new", { handle: "paythepyper" }),
    platform("Pinterest", "candidate", { profile_reason: "Captains plan seasons there." }),
    platform("YouTube", "candidate"),
    platform("LinkedIn", "candidate"),
  ],
  evidence: [{ id: "P1", kind: "own", text: "Our playoff checklist", platform: "Instagram", format: "carousel", date: "2026-10-05", metric: "impressions", value: 3000, median: 1100, multiple: 2.7, sample: 12 }],
  avoid: ["Instagram image from 2026-10-01 got 0.3x the usual impressions: Office day"],
  thin: [],
  edits: {},
  sources: ["brief", "website", "posts"],
};

const draft = (over: Record<string, unknown> = {}) => ({
  goals: "Grow saves on Instagram, because saved checklists bring captains back.",
  audience: "Captains of adult rec teams who run the money and the roster.",
  positioning: "The one app built around the captain's week.",
  pillars: [{ name: "Beer League Truths", text: "Carousels worked best." }, { name: "Captain Life", text: "Checklists and reminders." }],
  platforms: [{ platform: "Instagram", text: "The home base." }, { platform: "TikTok", text: "Launch on @paythepyper with captain POV skits." }, { platform: "Pinterest", text: "Season planning boards." }],
  candidates: [{ platform: "Pinterest", decision: "new", reason: "Captains plan seasons there." }, { platform: "YouTube", decision: "not_now", reason: "Long video is costly to make." }, { platform: "LinkedIn", decision: "not_now", reason: "Captains are not there as captains." }],
  avoid: "Office photos and anything that mocks other apps.",
  measures: "Instagram: median engagement per post above 42.",
  ...over,
});
const reply = (d: unknown, usage = { input_tokens: 100, output_tokens: 50 }) => ({ text: JSON.stringify(d), raw: { usage } });
const clean = { text: JSON.stringify({ unsupported: [] }), raw: { usage: { input_tokens: 10, output_tokens: 5 } } };

/** A stand-in for the Messages API: answers in order, and keeps every request. */
function calls(...answers: Array<{ text: string; raw?: unknown }>) {
  const bodies: Array<Record<string, any>> = [];
  const call = async ({ body }: { apiKey: string; body: Record<string, unknown> }) => {
    bodies.push(body);
    const next = answers.shift();
    if (!next) throw new Error("no more answers");
    return next;
  };
  return { call, bodies };
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

  it("reject a missing section", () => {
    expect(problems({ goals: "" })).toContain("goals");
    expect(problems({ measures: "  " })).toContain("measures");
  });

  it("reject pillar sections that do not match the client's pillars exactly", () => {
    expect(problems({ pillars: [{ name: "Beer league truths", text: "x" }, { name: "Captain Life", text: "y" }] })).toMatch(/Beer League Truths/);
    expect(problems({ pillars: [{ name: "Beer League Truths", text: "x" }] })).toMatch(/Captain Life/);
    expect(problems({ pillars: [...draft().pillars, { name: "Memes", text: "z" }] })).toMatch(/Memes/);
  });

  it("reject a platform without the section its state needs, and a section for a platform that gets none", () => {
    expect(problems({ platforms: draft().platforms.filter((p) => p.platform !== "TikTok") })).toMatch(/TikTok/);
    // Pinterest is marked new, so it needs its launch section.
    expect(problems({ platforms: draft().platforms.filter((p) => p.platform !== "Pinterest") })).toMatch(/Pinterest/);
    expect(problems({ platforms: [...draft().platforms, { platform: "YouTube", text: "Long video." }] })).toMatch(/YouTube/);
    expect(problems({ platforms: [...draft().platforms, { platform: "Snapchat", text: "?" }] })).toMatch(/Snapchat/);
  });

  it("reject a suggested platform left undecided, and more than two marked new", () => {
    expect(problems({ candidates: draft().candidates.filter((c) => c.platform !== "LinkedIn") })).toMatch(/LinkedIn/);
    const allNew = draft().candidates.map((c) => ({ ...c, decision: "new" }));
    const sections = [...draft().platforms, { platform: "YouTube", text: "a" }, { platform: "LinkedIn", text: "b" }];
    expect(problems({ candidates: allNew, platforms: sections })).toMatch(/At most two/);
  });

  it("reject evidence ids and em dashes anywhere", () => {
    expect(problems({ goals: "Repeat what worked in P1." })).toMatch(/id/);
    expect(problems({ candidates: [...draft().candidates.slice(0, 2), { platform: "LinkedIn", decision: "not_now", reason: "As C2 showed." }] })).toMatch(/id/);
    expect(problems({ audience: "Captains — the people who pay." })).toMatch(/em dash/);
    // A version name or a year is no evidence id.
    expect(problems({ goals: "Plan for Q4 2026 and the T-shirt drop." })).toBe("");
  });

  it("report every problem at once, not only the first", () => {
    const parsed = parseStrategy(JSON.stringify(draft({ goals: "", audience: "A — B" })), E);
    expect("error" in parsed && parsed.error).toMatch(/goals[\s\S]*em dash/);
    expect(strategyProblems).toBeTypeOf("function");
  });
});

describe("writing a strategy", () => {
  it("writes with one Opus call and checks with one Sonnet call, and puts each platform in its written state", async () => {
    const { call, bodies } = calls(reply(draft(), { input_tokens: 1000, output_tokens: 700 }), clean);
    const out = await writeStrategy(call, "key", E);
    expect(bodies.map((b) => b.model)).toEqual([STRATEGY_MODEL, CHECK_MODEL]);
    expect(STRATEGY_MODEL).toBe("claude-opus-5-5");
    expect(CHECK_MODEL).toBe("claude-sonnet-5-5");
    expect(bodies[0].max_tokens).toBe(STRATEGY_MAX_TOKENS);
    expect(STRATEGY_MAX_TOKENS).toBe(8000);
    if (!("value" in out)) throw new Error(out.error);
    expect(out.usage).toEqual({ calls: { writer: 1, checker: 1 }, tokens: { [STRATEGY_MODEL]: { input: 1000, output: 700 }, [CHECK_MODEL]: { input: 10, output: 5 } } });
    expect(Object.keys(out.value.sections).sort()).toEqual([
      "audience", "avoid", "goals", "measures", "not_now", "pillar:Beer League Truths", "pillar:Captain Life",
      "platform:instagram:posting", "platform:pinterest:new", "platform:tiktok:new", "positioning",
    ]);
    expect(out.value.sections.not_now).toBe("YouTube: Long video is costly to make.\nLinkedIn: Captains are not there as captains.");
    expect(out.value.platforms.map((p) => [p.platform, p.state, p.suggested])).toEqual([
      ["Instagram", "posting", false], ["TikTok", "new", false], ["Pinterest", "new", true], ["YouTube", "not_now", true], ["LinkedIn", "not_now", true],
    ]);
    // The code's numbers stay with each platform.
    expect(out.value.platforms[0]).toMatchObject({ cadence: { per_week: 2.4 }, baseline: { median_engagement: 42 } });
    expect(out.value.platforms[3]).toMatchObject({ reason: "Long video is costly to make." });
  });

  it("asks once more with the problems named when the reply breaks a rule", async () => {
    const { call, bodies } = calls(reply(draft({ goals: "Grow — fast." })), reply(draft()), clean);
    const out = await writeStrategy(call, "key", E);
    expect("value" in out).toBe(true);
    expect(out.usage.calls).toEqual({ writer: 2, checker: 1 });
    const again = bodies[1].messages as Array<{ role: string; content: string }>;
    expect(again.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(again[2].content).toMatch(/em dash/);
  });

  it("returns no strategy when the second reply still breaks a rule, and checks nothing", async () => {
    const { call, bodies } = calls(reply(draft({ goals: "" })), reply(draft({ goals: "" })));
    const out = await writeStrategy(call, "key", E);
    expect(out).toHaveProperty("error");
    expect(bodies.map((b) => b.model)).toEqual([STRATEGY_MODEL, STRATEGY_MODEL]);
  });

  it("fixes the statements the check flags once, then checks again", async () => {
    const flagged = { text: JSON.stringify({ unsupported: [{ section: "goals", statement: "Double installs by March." }] }), raw: {} };
    const { call, bodies } = calls(reply(draft({ goals: "Double installs by March." })), flagged, reply(draft()), clean);
    const out = await writeStrategy(call, "key", E);
    expect("value" in out && out.value.sections.goals).toBe(draft().goals);
    expect(bodies.map((b) => b.model)).toEqual([STRATEGY_MODEL, CHECK_MODEL, STRATEGY_MODEL, CHECK_MODEL]);
    const fix = (bodies[2].messages as Array<{ role: string; content: string }>).at(-1)!;
    expect(fix.role).toBe("user");
    expect(fix.content).toContain("Double installs by March.");
    // The check reads the evidence and every section of the strategy.
    expect(bodies[1].messages[0].content).toContain("Pay The Pyper keeps rec league captains");
    expect(bodies[1].messages[0].content).toContain("Double installs by March.");
  });

  it("returns no strategy when the fix is still flagged, after at most three Opus and two Sonnet calls", async () => {
    const flagged = () => ({ text: JSON.stringify({ unsupported: [{ section: "goals", statement: "x" }] }), raw: {} });
    const { call, bodies } = calls(reply(draft({ goals: "A — b" })), reply(draft()), flagged(), reply(draft()), flagged());
    const out = await writeStrategy(call, "key", E);
    expect(out).toHaveProperty("error");
    expect(bodies.filter((b) => b.model === STRATEGY_MODEL)).toHaveLength(3);
    expect(bodies.filter((b) => b.model === CHECK_MODEL)).toHaveLength(2);
    expect(out.usage.calls).toEqual({ writer: 3, checker: 2 });
  });

  it("returns no strategy when the fix breaks a rule, without asking again", async () => {
    const flagged = { text: JSON.stringify({ unsupported: [{ section: "goals", statement: "x" }] }), raw: {} };
    const { call, bodies } = calls(reply(draft()), flagged, reply(draft({ goals: "" })));
    expect(await writeStrategy(call, "key", E)).toHaveProperty("error");
    expect(bodies).toHaveLength(3);
  });

  it("returns no strategy when the check's reply cannot be read", async () => {
    const { call } = calls(reply(draft()), { text: "Looks fine to me.", raw: {} });
    expect(await writeStrategy(call, "key", E)).toHaveProperty("error");
  });
});

describe("what the writer is told", () => {
  it("gives the evidence, the code's numbers and the first content language, and never an evidence id", () => {
    const body = strategyRequest(E) as { system: string; messages: Array<{ content: string }> };
    const prompt = body.messages[0].content;
    for (const part of ["rec league captains", "Beer League Truths (50% of posts)", "2.4 posts a week", "median engagement per post 42", "3.1%", "@paythepyper", "Captains plan seasons there.", "BenchApp", "Our playoff checklist", "2.7x", "Never mock other apps.", "job ads", "Office day"]) {
      expect(prompt).toContain(part);
    }
    expect(prompt).not.toMatch(/\bP1\b/);
    expect(`${body.system}\n${prompt}`).toMatch(/example posts[^.]*\(es\)/i);
    expect(`${body.system}\n${prompt}`).not.toMatch(/—/);
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
    ...over,
  });
  const tables = (over: Record<string, Record<string, unknown>[]> = {}) => ({
    trend_profiles: [{ client_id: "c1", audience: "Captains.", fit_rubric: "Fits.", platforms: [{ platform: "instagram", reason: "primary" }, { platform: "pinterest", reason: "Plans." }], written_at: "2026-11-01T00:00:00Z" }],
    trend_terms: [{ client_id: "c1", kind: "exclusion", platform: null, term: "job ads", reason: "r", source: "lifecycle", removed_at: null }],
    sprout_profiles: [{ client_id: "c1", network_type: "tiktok", native_name: "paythepyper", is_active: true }],
    clients: [{ id: "c1", brand_book_text: "Book" }],
    content_strategy_edits: [
      { client_id: "c1", section_key: "audience", text: "Captains and co-captains." },
      { client_id: "c1", section_key: "pillar:Old pillar", text: "Kept, hidden." },
      { client_id: "c1", section_key: "platform:pinterest:new", text: "Our Pinterest plan." },
    ],
    ...over,
  });

  it("waits for the trend profile", async () => {
    expect(await strategyEvidence(fakeDb({}), client(), NOW, io())).toBeNull();
  });

  it("reads the brief capped, the pillars evenly shared, every platform's state, and the people's versions still in play", async () => {
    const e = (await strategyEvidence(fakeDb(tables()), client(), NOW, io()))!;
    expect(e.brief).toHaveLength(6000);
    expect(e.pillars).toEqual([{ name: "Beer League Truths", description: "Funny", share: 34 }, { name: "Captain Life", description: "", share: 33 }, { name: "Rink Rules", description: "", share: 33 }]);
    expect(e.client).toMatchObject({ languages: ["es", "en"], first_language: "es" });
    expect(e.platforms.map((p) => [p.platform, p.state, p.handle])).toEqual([["Instagram", "posting", null], ["TikTok", "new", "paythepyper"], ["Pinterest", "candidate", null]]);
    // TikTok had no rate among the competitors, so every tracked company's were read.
    expect(e.platforms[1].cadence).toEqual({ per_week: 2, source: "all_tracked" });
    expect(e.profile.exclusions).toEqual([{ term: "job ads", reason: "r" }]);
    expect(e.brand_book).toBe("Book");
    expect(e.competitors).toEqual(["BenchApp"]);
    // An edit whose pillar left the strategy is kept but not in play; a suggested platform's launch plan is.
    expect(e.edits).toEqual({ audience: "Captains and co-captains.", "platform:pinterest:new": "Our Pinterest plan." });
    expect(e.sources).toEqual(["brief", "website", "brand_book", "competitors", "posts"]);
  });

  it("evenly shares the pillars so the shares add up to 100", () => {
    expect(evenShares(3)).toEqual([34, 33, 33]);
    expect(evenShares(4)).toEqual([25, 25, 25, 25]);
    expect(evenShares(0)).toEqual([]);
  });
});

describe("saving a strategy", () => {
  it("writes the product's version, the platforms with their numbers, the key, the date, the models and the tokens, and never people's versions", async () => {
    const db = fakeDb({ content_strategy_edits: [{ client_id: "c1", section_key: "goals", text: "Ours." }] });
    const { call } = calls(reply(draft()), clean);
    const out = await writeStrategy(call, "key", E);
    if (!("value" in out)) throw new Error(out.error);
    await saveStrategy(db, "c1", E, out, "key-1", NOW);
    expect(db.tables.content_strategies).toHaveLength(1);
    expect(db.tables.content_strategies[0]).toMatchObject({
      client_id: "c1", inputs_key: "key-1", written_at: NOW.toISOString(), sources: ["brief", "website", "posts"],
      pillars: [{ name: "Beer League Truths", share: 50 }, { name: "Captain Life", share: 50 }],
      models: { writer: STRATEGY_MODEL, checker: CHECK_MODEL }, usage: out.usage,
    });
    expect(db.tables.content_strategies[0].sections.goals).toBe(draft().goals);
    expect(db.tables.content_strategy_edits).toEqual([{ client_id: "c1", section_key: "goals", text: "Ours." }]);
  });
});
