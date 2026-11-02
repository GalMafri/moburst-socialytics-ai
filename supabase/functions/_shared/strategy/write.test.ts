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
import { fakeDb } from "../lifecycle/fakeDb";

const NOW = new Date("2026-11-02T10:00:00.000Z");

const platform = (name: string, state: StrategyPlatform["state"], over: Partial<StrategyPlatform> = {}): StrategyPlatform => ({
  platform: name, key: name.toLowerCase(), state, handle: null, profile_reason: null, cadence: { per_week: 2, source: "competitors" }, baseline: null, ...over,
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
const reply = (d: unknown, usage = { input_tokens: 100, output_tokens: 50 }, stopReason = "end_turn") => ({ text: JSON.stringify(d), stopReason, raw: { usage } });
/** A reply the model stopped because it ran out of room: whatever it holds is never read. */
const cutOff = (d: unknown) => reply(d, { input_tokens: 100, output_tokens: 16000 }, "max_tokens");
const clean = { text: JSON.stringify({ unsupported: [] }), stopReason: "end_turn", raw: { usage: { input_tokens: 10, output_tokens: 5 } } };
const flagged = (statement = "x") => ({ text: JSON.stringify({ unsupported: [{ section: "goals", statement }] }), stopReason: "end_turn", raw: {} });

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


describe("writing a strategy, one model call per run", () => {
  it("writes in one run and checks in the next, and puts each platform in its written state", async () => {
    const { out, phases, bodies } = await drive(reply(draft(), { input_tokens: 1000, output_tokens: 700 }), clean);
    expect(phases).toEqual(["write", "check"]);
    expect(bodies.map((b) => b.model)).toEqual([STRATEGY_MODEL, CHECK_MODEL]);
    expect(STRATEGY_MODEL).toBe("claude-opus-5-5");
    expect(CHECK_MODEL).toBe("claude-sonnet-5-5");
    if (out.kind !== "passed") throw new Error(JSON.stringify(out));
    expect(out.usage).toEqual({ calls: { writer: 1, checker: 1 }, tokens: { [STRATEGY_MODEL]: { input: 1000, output: 700 }, [CHECK_MODEL]: { input: 10, output: 5 } } });
    expect(out.inputs_key).toBe("key-1");
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

  it("gives the writer room to think and the checker room to list", async () => {
    const { bodies } = await drive(reply(draft()), clean);
    expect([bodies[0].max_tokens, bodies[1].max_tokens]).toEqual([16000, 4000]);
    expect([STRATEGY_MAX_TOKENS, CHECK_MAX_TOKENS]).toEqual([16000, 4000]);
  });

  it("asks once more, in its own run, with the problems named, when the reply breaks a rule", async () => {
    const { out, phases, bodies } = await drive(reply(draft({ goals: "Grow — fast." })), reply(draft()), clean);
    expect(phases).toEqual(["write", "reask", "check"]);
    expect(out.kind).toBe("passed");
    const again = bodies[1].messages as Array<{ role: string; content: string }>;
    expect(again.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(again[2].content).toMatch(/em dash/);
    expect(out.usage.calls).toEqual({ writer: 2, checker: 1 });
  });

  it("never reads or keeps a reply that was cut off, and asks again for a shorter one", async () => {
    // A cut-off reply may still hold JSON that parses; it is never read.
    const { out, phases, bodies, kept } = await drive(cutOff(draft()), reply(draft({ goals: "The second answer's goals." })), clean);
    expect(phases).toEqual(["write", "reask", "check"]);
    expect(JSON.stringify(kept[0])).not.toContain("saved checklists bring captains back");
    const again = bodies[1].messages as Array<{ role: string; content: string }>;
    expect(again.map((m) => m.role)).toEqual(["user", "user"]);
    expect(again[1].content).toMatch(/cut off/);
    expect(out.kind === "passed" && out.value.sections.goals).toBe("The second answer's goals.");
  });

  it("ends the write when the second reply is cut off or breaks a rule, and checks nothing", async () => {
    for (const second of [cutOff(draft()), reply(draft({ goals: "" }))]) {
      const { out, phases, bodies } = await drive(reply(draft({ goals: "" })), second);
      expect(phases).toEqual(["write", "reask"]);
      expect(out.kind).toBe("over");
      expect(bodies.map((b) => b.model)).toEqual([STRATEGY_MODEL, STRATEGY_MODEL]);
    }
  });

  it("fixes the flagged statements in one run, then checks again in the next", async () => {
    const { out, phases, bodies } = await drive(reply(draft({ goals: "Double installs by March." })), flagged("Double installs by March."), reply(draft()), clean);
    expect(phases).toEqual(["write", "check", "fix", "recheck"]);
    expect(out.kind === "passed" && out.value.sections.goals).toBe(draft().goals);
    expect(bodies.map((b) => b.model)).toEqual([STRATEGY_MODEL, CHECK_MODEL, STRATEGY_MODEL, CHECK_MODEL]);
    const fix = (bodies[2].messages as Array<{ role: string; content: string }>).at(-1)!;
    expect(fix.role).toBe("user");
    expect(fix.content).toContain("Double installs by March.");
    // The check reads the evidence and every section of the strategy.
    expect(bodies[1].messages[0].content).toContain("Pay The Pyper keeps rec league captains");
    expect(bodies[1].messages[0].content).toContain("Double installs by March.");
  });

  it("ends the write when the fix is still flagged, after at most three Opus and two Sonnet calls", async () => {
    const { out, phases, bodies } = await drive(reply(draft({ goals: "A — b" })), reply(draft()), flagged(), reply(draft()), flagged());
    expect(phases).toEqual(["write", "reask", "check", "fix", "recheck"]);
    expect(out.kind).toBe("over");
    expect(bodies.filter((b) => b.model === STRATEGY_MODEL)).toHaveLength(3);
    expect(bodies.filter((b) => b.model === CHECK_MODEL)).toHaveLength(2);
    expect(out.usage.calls).toEqual({ writer: 3, checker: 2 });
  });

  it("ends the write when the fix is cut off or breaks a rule, without asking again", async () => {
    for (const fix of [cutOff(draft()), reply(draft({ goals: "" }))]) {
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
  it("gives the evidence, the code's numbers and the first content language, and never an evidence id", () => {
    const body = strategyRequest(E) as { system: string; messages: Array<{ content: string }> };
    const prompt = body.messages[0].content;
    for (const part of ["rec league captains", "Beer League Truths (60% of the client's calendar posts over the last 8 weeks)", "2.4 posts a week", "median engagement per post 42", "3.1%", "@paythepyper", "Captains plan seasons there.", "BenchApp", "Our playoff checklist", "2.7x", "Never mock other apps.", "job ads", "Office day"]) {
      expect(prompt).toContain(part);
    }
    expect(prompt).not.toMatch(/\bP1\b/);
    expect(`${body.system}\n${prompt}`).toMatch(/example posts[^.]*\(es\)/i);
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
    expect(e.edits).toEqual({ audience: "Captains and co-captains.", "platform:pinterest:new": "Our Pinterest plan." });
    expect(e.sources).toEqual(["brief", "website", "brand_book", "competitors", "posts"]);
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
      models: { writer: STRATEGY_MODEL, checker: CHECK_MODEL }, usage: out.usage,
    });
    expect(db.tables.content_strategies[0].sections.goals).toBe(draft().goals);
    expect(db.tables.content_strategy_edits).toEqual([{ client_id: "c1", section_key: "goals", text: "Ours." }]);
  });
});
