// @vitest-environment node
// The trend profile: what the app decides to track for a client, from the
// client's own data (spec section 1). Proves the evidence it reads, the rules
// a profile must meet, that a person's changes are never overwritten, that a
// client with nothing to read gets no profile, and the monthly hashtag refresh.
import { afterEach, describe, expect, it } from "vitest";
import { activeTerms, hashtagCounts, parseProfile, profileEvidence, profileProblems, profileRequest, syncLifecycleTerms, TREND_PROFILE_MODEL, writeTrendProfile, type ProfileEvidence, type ProfileIO } from "./profile";
import type { TrendProfile } from "./types";
import { deps, STEPS } from "../lifecycle/steps";
import { fakeDb } from "../lifecycle/fakeDb";
import type { StepRow } from "../lifecycle/policy";

const original = { ...deps };
afterEach(() => Object.assign(deps, original));

const NOW = new Date("2026-11-01T10:00:00.000Z");
const T = NOW.toISOString();
// deno-lint-ignore no-explicit-any
const client = (over: Record<string, any> = {}) => ({
  id: "c1", name: "Moburst", website_url: "https://www.moburst.com/", geo: "US", language: "en",
  location: { country: "US", region: "NY", locality: "New York" }, brief_text: "Moburst is a mobile-first growth agency for apps and brands.",
  content_pillars: [{ name: "App growth", description: "How apps grow" }, { name: "AI in marketing", description: "" }],
  social_keywords: ["app marketing"], brand_notes: "", primary_platforms: ["Instagram", "Facebook", "LinkedIn"], voice_built_at: null, ...over,
});
const row = (step: string, patch: Partial<StepRow> = {}): StepRow => ({
  client_id: "c1", step, inputs_key: "k", status: "done", attempts: 0, attempted_at: T, done_at: T, next_attempt_at: null, result: {}, error: null, ...patch,
});
const rowsOf = (...r: StepRow[]) => new Map(r.map((x) => [x.step, x]));

const io = (over: Partial<ProfileIO> = {}): ProfileIO => ({
  ownPosts: async () => ({
    posts: [
      { text: "How we 3x'd installs #AppMarketing #ASO", engagement: 900 },
      { text: "Our AI playbook #AppMarketing #AI", engagement: 400 },
      { text: "Office day", engagement: 5 },
    ],
  }),
  feedSnapshots: async () => [{
    payload: {
      client_company_id: "1",
      socialPosts: [
        { companyId: "1", companyName: "Moburst", message: "ours #AppMarketing", engagementTotal: 5000, publishedAt: "2026-10-20" },
        { companyId: "2", companyName: "SplitMetrics", message: "Store tests #ASO #ABTesting", engagementTotal: 300, publishedAt: "2026-10-20" },
        { companyId: "2", companyName: "SplitMetrics", message: "More #ASO", engagementTotal: 200, publishedAt: "2026-10-21" },
        { companyId: "3", companyName: "Old Co", message: "#Ancient", engagementTotal: 9999, publishedAt: "2026-05-01" },
      ],
    },
  }],
  competitorSet: async () => [{ name: "SplitMetrics", rivaliq_company_id: "2" }],
  siteText: async () => "Moburst helps apps grow with ASO, paid user acquisition and creative.",
  ...over,
});

const term = (t: string) => ({ term: t, reason: `because ${t}` });
const topics = (n: number) => ["app growth tips", "mobile ads creative", "ASO tactics", "user acquisition", "AI marketing tools", "app retention", "mobile gaming marketing", "subscription apps", "app store trends", "growth marketing"].slice(0, n).map(term);
const profile = (over: Partial<TrendProfile> = {}): TrendProfile => ({
  audience: "App founders and growth leads who want to grow installs.",
  topics: topics(8),
  hashtags: { instagram: [term("#appmarketing"), term("#aso")], tiktok: [term("#appmarketing")], linkedin: [term("#growthmarketing")] },
  exclusions: [term("job ads")],
  fit_rubric: "Posts that teach app growth. Drop memes and job ads.",
  platforms: [{ platform: "instagram", reason: "primary" }, { platform: "facebook", reason: "primary" }, { platform: "linkedin", reason: "primary" }],
  ...over,
});
const evidenceFor = async (c = client()): Promise<ProfileEvidence> => (await profileEvidence(fakeDb({}), c, NOW, io()))!;

describe("the evidence a profile is written from", () => {
  it("asks for a profile from the brief, pillars, site, platforms, competitors and the hashtags the best posts used", async () => {
    const e = await evidenceFor();
    expect(e.hashtags.own[0]).toEqual({ key: "#appmarketing", count: 2 });
    // The client's own post in the feed and posts older than 90 days are not competitors' evidence.
    expect(e.hashtags.competitors.map((h) => h.key)).toEqual(["#aso", "#abtesting"]);
    expect(e.competitors).toEqual(["SplitMetrics"]);
    const body = profileRequest(e) as { model: string; messages: Array<{ content: string }> };
    expect(body.model).toBe(TREND_PROFILE_MODEL);
    expect(TREND_PROFILE_MODEL).toBe("claude-opus-5-5");
    const prompt = body.messages[0].content;
    for (const part of ["mobile-first growth agency", "App growth", "ASO, paid user acquisition", "SplitMetrics", "#appmarketing", "Instagram", "New York"]) {
      expect(prompt).toContain(part);
    }
  });

  it("counts hashtags case-insensitively", () => {
    expect(hashtagCounts(["#ASO and #aso", "#Growth_Hacks"])).toEqual({ "#aso": 2, "#growth_hacks": 1 });
  });

  it("waits instead of writing a thin profile for a client with nothing to read", async () => {
    expect(await STEPS.trend_profile.inputs(fakeDb({}), client(), new Map())).toBeNull();
    const empty = client({ brief_text: "", content_pillars: [], website_url: null });
    expect(await profileEvidence(fakeDb({}), empty, NOW, io({ siteText: async () => { throw new Error("no site to read"); } }))).toBeNull();
  });
});

describe("what a profile must be", () => {
  it("accepts a profile with 6 to 10 topics, each with a reason", async () => {
    expect(profileProblems(profile(), await evidenceFor())).toEqual([]);
  });

  it("refuses a profile that searches for the brand's own name or a lone place name", async () => {
    const e = await evidenceFor(client({ name: "Bader Law", location: { country: "US", region: "Georgia", locality: "Atlanta" } }));
    expect(profileProblems(profile({ topics: [...topics(7), term("Bader Law")] }), e)).toHaveLength(1);
    expect(profileProblems(profile({ topics: [...topics(7), term("Atlanta")] }), e)).toHaveLength(1);
    expect(profileProblems(profile({ topics: [...topics(7), term("car accident tips Atlanta")] }), e)).toEqual([]);
    expect(profileProblems(profile({ topics: topics(5) }), e)).toHaveLength(1);
    // At most as many topics as a week searches, so every topic the profile writes is searched every week.
    expect(profileProblems(profile({ topics: topics(8) }), e)).toEqual([]);
    expect(profileProblems(profile({ topics: topics(9) }), e)).toHaveLength(1);
  });

  it("refuses a profile that leaves out one of the client's primary platforms", async () => {
    const e = await evidenceFor();
    expect(profileProblems(profile({ platforms: [{ platform: "instagram", reason: "primary" }] }), e)).toHaveLength(1);
  });

  it("reads the JSON out of an answer and reports what is wrong with it", async () => {
    const e = await evidenceFor();
    expect(parseProfile(`Here it is: ${JSON.stringify(profile())}`, e)).toEqual({ value: profile() });
    expect(parseProfile(JSON.stringify(profile({ topics: topics(3) })), e)).toHaveProperty("error");
    expect(parseProfile("no json", e)).toHaveProperty("error");
  });
});

describe("a person's changes", () => {
  it("keeps what a person added and never brings back what a person removed", async () => {
    const db = fakeDb({
      trend_terms: [
        { id: "a", client_id: "c1", kind: "hashtag", platform: "instagram", term: "#growth", reason: "", source: "person", removed_at: null },
        { id: "b", client_id: "c1", kind: "hashtag", platform: "instagram", term: "#Ads", reason: "", source: "lifecycle", removed_at: T },
        { id: "c", client_id: "c1", kind: "hashtag", platform: "instagram", term: "#old", reason: "", source: "lifecycle", removed_at: null },
        { id: "d", client_id: "c1", kind: "hashtag", platform: "tiktok", term: "#old", reason: "", source: "lifecycle", removed_at: null },
      ],
    });
    await syncLifecycleTerms(db, "c1", "hashtag", "instagram", [term("#ads"), term("#aso")]);
    const ig = db.tables.trend_terms.filter((r) => r.platform === "instagram");
    expect(ig.map((r) => [r.term, r.source, r.removed_at ? "removed" : "active"]).sort()).toEqual([
      ["#Ads", "lifecycle", "removed"], ["#aso", "lifecycle", "active"], ["#growth", "person", "active"],
    ]);
    // Another platform's terms are left alone.
    expect(db.tables.trend_terms.some((r) => r.platform === "tiktok" && r.term === "#old")).toBe(true);
    const active = await activeTerms(db, "c1");
    expect(active.hashtags.instagram.map((t) => t.term).sort()).toEqual(["#aso", "#growth"]);
    // Who added a term goes with it, so a person's terms are searched first.
    expect(active.hashtags.instagram.find((t) => t.term === "#growth")?.source).toBe("person");
    expect(active.hashtags.instagram.find((t) => t.term === "#aso")?.source).toBe("lifecycle");
  });
});

describe("writing a profile again", () => {
  it("clears the coverage rewrite's searches, which were made from the old profile", async () => {
    const db = fakeDb({
      trend_profiles: [{ client_id: "c1", audience: "old", fit_rubric: "old", platforms: [], search_overrides: { tiktok: ["old search"], instagram: ["#old"] }, inputs_key: "old", written_at: "2026-10-01T00:00:00.000Z", hashtags_at: null }],
    });
    await writeTrendProfile(db, "c1", profile(), "new", NOW);
    expect(db.tables.trend_profiles).toHaveLength(1);
    expect(db.tables.trend_profiles[0]).toMatchObject({ audience: profile().audience, search_overrides: {}, inputs_key: "new", written_at: T });
  });
});

describe("the lifecycle steps", () => {
  const settledRows = rowsOf(row("brief_pillars"), row("competitors"));
  const answer = (p: unknown) => async () => ({ text: JSON.stringify(p), stopReason: "end_turn", raw: {} });

  it("keys the profile on the client's brand inputs, so a pillar change writes it again", async () => {
    deps.trendIO = () => io();
    const a = await STEPS.trend_profile.inputs(fakeDb({}), client(), settledRows);
    const b = await STEPS.trend_profile.inputs(fakeDb({}), client({ content_pillars: [{ name: "Something else" }] }), settledRows);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it("writes the profile and its terms from Claude's answer", async () => {
    deps.trendIO = () => io();
    deps.now = () => NOW;
    deps.anthropicKey = async () => "key";
    deps.claudeMessages = answer(profile());
    const db = fakeDb({ clients: [client()] });
    const out = await STEPS.trend_profile.run(db, client(), { force: false, previous: null, rows: settledRows });
    expect(out.status).toBe("done");
    expect(db.tables.trend_profiles[0]).toMatchObject({ client_id: "c1", audience: profile().audience, written_at: T, hashtags_at: T, search_overrides: {} });
    expect(db.tables.trend_terms.filter((r) => r.kind === "topic")).toHaveLength(8);
  });

  it("asks once more after a bad answer, then fails quietly for the lifecycle to retry", async () => {
    deps.trendIO = () => io();
    deps.anthropicKey = async () => "key";
    let calls = 0;
    deps.claudeMessages = async () => { calls++; return { text: JSON.stringify(profile({ topics: topics(2) })), stopReason: "end_turn", raw: {} }; };
    const db = fakeDb({ clients: [client()] });
    const out = await STEPS.trend_profile.run(db, client(), { force: false, previous: null, rows: settledRows });
    expect(calls).toBe(2);
    expect(out.status).toBe("failed");
    expect(db.tables.trend_profiles ?? []).toHaveLength(0);
  });

  it("refreshes hashtags once a month and leaves the rest of the profile alone", async () => {
    deps.trendIO = () => io();
    deps.now = () => NOW;
    deps.anthropicKey = async () => "key";
    const base = () => fakeDb({
      clients: [client()],
      trend_profiles: [{ client_id: "c1", audience: "a", fit_rubric: "f", platforms: [], search_overrides: {}, inputs_key: "k", written_at: "2026-09-01T00:00:00Z", hashtags_at: "2026-11-01T05:00:00Z" }],
      trend_terms: [
        { id: "t", client_id: "c1", kind: "topic", platform: null, term: "app growth tips", reason: "r", source: "lifecycle", removed_at: null },
        { id: "h", client_id: "c1", kind: "hashtag", platform: "instagram", term: "#old", reason: "r", source: "lifecycle", removed_at: null },
      ],
    });
    const rows = rowsOf(row("trend_profile"));
    let calls = 0;
    deps.claudeMessages = async () => { calls++; return { text: JSON.stringify({ hashtags: { instagram: [term("#new")], tiktok: [term("#newtok")], linkedin: [] } }), stopReason: "end_turn", raw: {} }; };

    const thisMonth = base();
    expect((await STEPS.trend_hashtags.run(thisMonth, client(), { force: false, previous: null, rows })).status).toBe("done");
    expect(calls).toBe(0);

    const lastMonth = base();
    lastMonth.tables.trend_profiles[0].hashtags_at = "2026-10-03T00:00:00Z";
    expect((await STEPS.trend_hashtags.run(lastMonth, client(), { force: false, previous: null, rows })).status).toBe("done");
    expect(calls).toBe(1);
    const active = await activeTerms(lastMonth, "c1");
    expect(active.hashtags.instagram.map((t) => t.term)).toEqual(["#new"]);
    expect(active.hashtags.tiktok.map((t) => t.term)).toEqual(["#newtok"]);
    expect(active.topics.map((t) => t.term)).toEqual(["app growth tips"]);
    expect(lastMonth.tables.trend_profiles[0].hashtags_at).toBe(T);
  });
});
