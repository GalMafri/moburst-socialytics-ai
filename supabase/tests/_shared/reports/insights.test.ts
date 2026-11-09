// Report insights from the data (Lital, 3 Nov 2026): the model only words
// facts code worked out, code checks every number and direction, and the
// same input always shows the same words. The model is a fake.

import { describe, expect, it, vi } from "vitest";
import type { Fact } from "../../../functions/_shared/reports/facts";
import {
  checkInsights, inputHash, INSIGHTS_SYSTEM, insightsInput, insightsPrompt, orderByFacts, parseInsights, runReportInsights, templateInsights, writeInsights,
  type InsightFields, type InsightsInput,
} from "../../../functions/_shared/reports/insights";

const fact = (over: Partial<Fact>): Fact => ({
  id: "F1", key: "change|all|impressions|", kind: "change", platform: "all", metric: "impressions", unit: "count", value: 12400, previous: 9800, change: 2600, percent: 26.5,
  score: 2.6, numbers: [12400, 9800, 2600, 26.5], sentence: "Impressions rose 26.5% to 12,400.", basis: "Impressions 12,400 in October against 9,800 in September, +26.5%", sources: ["sprout"], ...over,
});
const FACTS: Fact[] = [
  fact({}),
  fact({ id: "F2", key: "change|all|views|", metric: "views", value: 292, previous: 575, change: -283, percent: -49.2, numbers: [292, 575, 283, 49.2], sentence: "Video views fell 49.2% to 292.", basis: "Video views 292 in October against 575 in September, -49.2%" }),
  fact({ id: "F3", key: "share|LinkedIn|engagements|", kind: "share", platform: "LinkedIn", metric: "engagements", unit: "percent", value: 96.1, numbers: [96.1, 521, 542], sentence: "LinkedIn brought 96.1% of the period's engagements.", basis: "LinkedIn 521 of 542 engagements" }),
];
const INPUT: InsightsInput = { kind: "social", client: "Moburst", period: "2026-10-01 to 2026-10-31", facts: FACTS, sample: [], rejected: [], preferences: [] };

const social = (over: Partial<Extract<InsightFields, { kind: "social" }>> = {}): InsightFields => ({
  kind: "social",
  summary: { text: "Reach grew while video slowed: impressions rose 26.5% and views fell 49%.", facts: ["F1", "F2"] },
  insights: [{ text: "LinkedIn carries the account with 96% of engagements.", facts: ["F3"] }, { text: "Impressions reached 12.4K, up from 9,800.", facts: ["F1"] }],
  recommendations: [{ text: "Put the next video on LinkedIn, where 96.1% of engagements came from.", facts: ["F3"] }],
  ...over,
});

describe("checkInsights", () => {
  it("passes an answer whose every number is a cited fact's, at the precision written", () => {
    expect(checkInsights(social(), FACTS)).toEqual([]);
  });

  it("refuses an uncited number, an unknown id, a direction against the sign, and text that cites nothing", () => {
    expect(checkInsights(social({ insights: [{ text: "Impressions rose 31% to 12,400.", facts: ["F1"] }] }), FACTS)).toEqual(["Insight 1 writes 31%, which is not a number of the facts it cites."]);
    expect(checkInsights(social({ insights: [{ text: "LinkedIn brought 96.1% of engagements.", facts: ["F1"] }] }), FACTS)).toEqual(["Insight 1 writes 96.1%, which is not a number of the facts it cites."]);
    expect(checkInsights(social({ insights: [{ text: "Views held.", facts: ["F9"] }] }), FACTS)).toEqual(["Insight 1 cites F9, which are not in the facts."]);
    expect(checkInsights(social({ insights: [{ text: "Video views rose 49.2% to 292.", facts: ["F2"] }] }), FACTS)).toEqual(["Insight 1 says rose, but no change it cites went up.", "Insight 1 says views went up, but it fell."]);
    // Its own number beside the wrong word, even with a change that rose also cited.
    expect(checkInsights(social({ insights: [{ text: "Video views rose 49.2% to 292.", facts: ["F1", "F2"] }] }), FACTS)).toEqual(["Insight 1 says views went up, but it fell."]);
    expect(checkInsights(social({ recommendations: [{ text: "Post more video.", facts: [] }] }), FACTS)).toEqual(["Recommendation 1 cites no fact."]);
    expect(checkInsights(social({ insights: [{ text: "Impressions rose 26.5% — a record.", facts: ["F1"] }] }), FACTS)).toEqual(["Insight 1 has a dash; use commas or periods."]);
    expect(checkInsights(null, FACTS)).toEqual(["The answer could not be read as the JSON asked for."]);
  });

  it("refuses a data vendor's name and every word a client must not read, dashes included", () => {
    for (const word of ["Sprout", "RivalIQ", "Rival IQ", "Apify", "Gamma", "AI", "the model", "a score", "the prompt", "the pipeline", "a gate", "Socialytics"]) {
      expect(checkInsights(social({ insights: [{ text: `Impressions rose 26.5% in ${word} data.`, facts: ["F1"] }] }), FACTS)).toEqual([expect.stringMatching(/^Insight 1 uses "[^"]+", a word the client must not read\.$/)]);
    }
    expect(checkInsights(social({ insights: [{ text: "Impressions rose 26.5% \u2013 a record.", facts: ["F1"] }] }), FACTS)).toEqual(["Insight 1 has a dash; use commas or periods."]);
    // A company's own name is no such word.
    const ranking = fact({ id: "F1", key: "ranking|all|followers|Acme AI", kind: "ranking", company: "Acme AI", leader: "Sprout Social Co", unit: "count", value: 14900, rank: 2, of: 3, leaderValue: 680000, median: 32000, numbers: [14900, 680000, 32000, 2, 3] });
    const named: InsightFields = { kind: "competitive", summary: [{ text: "Acme AI ranks 2nd of 3 on followers, behind Sprout Social Co with 680,000.", facts: ["F1"] }], gaps: [{ gap: "Acme AI trails on followers", platform: "all", why_it_matters: "Sprout Social Co has 680,000.", suggested_play: "Test a weekly series.", facts: ["F1"] }] };
    expect(checkInsights(named, [ranking])).toEqual([]);
  });

  it("keeps the direction check to the sentence that quotes the change", () => {
    const two = social({ insights: [{ text: "Impressions rose 26.5%. Video views fell 49.2%.", facts: ["F1", "F2"] }] });
    expect(checkInsights(two, FACTS)).toEqual([]);
  });

  it("checks a competitive answer's gaps, platform included", () => {
    const ranking = fact({ id: "F1", key: "ranking|all|compared_rate|Moburst", kind: "ranking", unit: "percent", value: 0.31, rank: 3, of: 3, leader: "Rival Co", leaderValue: 2.1, median: 0.6, numbers: [0.31, 2.1, 0.6, 3, 3] });
    const fields: InsightFields = { kind: "competitive", summary: [{ text: "Moburst ranks 3rd of 3 on engagement rate at 0.31%, against Rival Co's 2.1%.", facts: ["F1"] }], gaps: [{ gap: "Engagement trails the field", platform: "instagram", why_it_matters: "The median is 0.6%.", suggested_play: "Test question-hook Reels for six weeks.", facts: ["F1"] }] };
    expect(checkInsights(fields, [ranking])).toEqual([]);
    expect(checkInsights({ ...fields, gaps: [{ ...fields.gaps![0], suggested_play: "Reach a 1.5% rate in six weeks." }] }, [ranking])).toEqual(["Gap 1's test writes 1.5%, which is not a number of the facts it cites."]);
    expect(checkInsights({ ...fields, gaps: [{ ...fields.gaps![0], platform: "myspace" }] }, [ranking])).toEqual([expect.stringContaining("Gap 1 names a platform")]);
  });
});

describe("the stricter check (design point 6)", () => {
  const one = (text: string, facts: string[]) => checkInsights(social({ insights: [{ text, facts }] }), FACTS);

  it("counts a number after a currency sign as a number", () => {
    expect(one("Impressions rose 26.5% on a $300 boost.", ["F1"])).toEqual(["Insight 1 writes $300, which is not a number of the facts it cites."]);
    expect(one("Impressions reached \u20ac12,400 worth of reach.", ["F1"])).toEqual([]);
  });

  it("refuses a direction word away from the number when no change it cites moved that way", () => {
    expect(one("Views rose this month, to 292.", ["F2"])).toEqual(["Insight 1 says rose, but no change it cites went up."]);
    expect(one("LinkedIn engagements dropped, with 96.1% of the total.", ["F3"])).toEqual(["Insight 1 says dropped, but no change it cites went down."]);
    expect(one("Video views are up from 575.", ["F2"])).toEqual(["Insight 1 says up, but no change it cites went up."]);
    expect(one("Impressions climbed while video views slipped.", ["F1", "F2"])).toEqual([]);
  });

  it("checks doubled, tripled and halved as the multiple they claim", () => {
    expect(one("Impressions doubled.", ["F1"])).toEqual(["Insight 1 says doubled, but no change it cites is 2x."]);
    const doubled = fact({ id: "F4", key: "change|all|engagements|", metric: "engagements", value: 2000, previous: 1000, change: 1000, percent: 100, numbers: [2000, 1000, 1000, 100] });
    expect(checkInsights(social({ insights: [{ text: "Engagements doubled to 2,000.", facts: ["F4"] }] }), [...FACTS, doubled])).toEqual([]);
    expect(one("Video views halved.", ["F1"])).toEqual(["Insight 1 says halved, but no change it cites went down.", "Insight 1 says halved, but no change it cites is 0.5x."]);
  });

  it("refuses words that size a change without its number", () => {
    expect(one("Video views dropped sharply to 292.", ["F2"])).toEqual(['Insight 1 sizes a change with "sharply"; give its number instead.']);
    expect(one("Impressions rose significantly.", ["F1"])).toEqual(['Insight 1 sizes a change with "significantly"; give its number instead.']);
  });

  it("refuses a comparison that cites no ranking, share or outlier fact", () => {
    expect(one("Moburst leads every rival on impressions, at 12,400.", ["F1"])).toEqual(['Insight 1 compares ("leads"), but cites no ranking, share or outlier fact.']);
    expect(one("Impressions of 12,400 put Moburst ahead.", ["F1"])).toEqual(['Insight 1 compares ("ahead"), but cites no ranking, share or outlier fact.']);
    expect(one("LinkedIn brought the most engagements, 96.1% of them.", ["F3"])).toEqual([]);
    // A monthly report has no rankings: its top post is an outlier fact.
    const outlier = fact({ id: "F4", key: "outlier|Instagram|engagements|https://instagram.com/reel/9", kind: "outlier", platform: "Instagram", metric: "engagements", value: 5200, usual: 1700, multiple: 3.1, numbers: [5200, 1700, 3.1] });
    expect(checkInsights(social({ insights: [{ text: "Your top Instagram reel got 5,200 engagements, 3.1x your usual.", facts: ["F4"] }] }), [...FACTS, outlier])).toEqual([]);
  });

  it("refuses a fact id in the words", () => {
    expect(one("Impressions rose 26.5% (F1).", ["F1"])).toEqual(["Insight 1 writes a fact id (F1); never write them."]);
  });

  it("refuses a competitive answer with no gaps when the facts show the client behind on a compared metric", () => {
    const behind = fact({ id: "F1", key: "ranking|all|followers|Moburst", kind: "ranking", metric: "followers", company: "Moburst", leader: "Rival Co", value: 14900, rank: 2, of: 2, leaderValue: 680000, median: 347450, numbers: [14900, 680000, 347450, 2, 2] });
    const answer: InsightFields = { kind: "competitive", summary: [{ text: "Moburst ranks 2nd of 2 on followers, behind Rival Co.", facts: ["F1"] }], gaps: [] };
    expect(checkInsights(answer, [behind])).toEqual(["There are no gaps, but F1 shows the client behind a competitor; write at least one gap."]);
    expect(checkInsights(answer, [{ ...behind, rank: 1, leader: "Moburst" }])).toEqual([]);
  });

  it("refuses a gap the team rejected, by its key (insightKey), so a hidden suggestion is never proposed again", () => {
    const ranking = fact({ id: "F1", key: "ranking|all|followers|Moburst", kind: "ranking", metric: "followers", company: "Moburst", leader: "Rival Co", value: 14900, rank: 2, of: 2, leaderValue: 680000, median: 347450, numbers: [14900, 680000, 347450, 2, 2] });
    const gap = { gap: "Post more memes!", platform: "instagram", why_it_matters: "Rival Co has 680,000 followers.", suggested_play: "Test memes.", facts: ["F1"] };
    const answer: InsightFields = { kind: "competitive", summary: [{ text: "Moburst ranks 2nd of 2 on followers.", facts: ["F1"] }], gaps: [gap] };
    expect(checkInsights(answer, [ranking], { rejected: ["post-more-memes"] })).toEqual(["Gap 1 is a suggestion the team rejected; never propose it again."]);
    expect(checkInsights(answer, [ranking], { rejected: ["weekly-reels"] })).toEqual([]);
  });

  it("states the same rules in the prompt", () => {
    for (const rule of [/currency sign/i, /rose, fell, dropped or doubled/i, /sharply or significantly/i, /ranking, share or outlier fact/i, /fact ids/i]) expect(INSIGHTS_SYSTEM).toMatch(rule);
    expect(insightsPrompt({ ...INPUT, kind: "competitive" })).toMatch(/behind a competitor on any compared metric, write at least one gap/i);
  });
});

describe("parseInsights and orderByFacts", () => {
  it("reads the fields and orders insights by the first fact each cites", () => {
    const parsed = parseInsights("social", JSON.stringify({ summary: { text: "S", facts: ["F1"] }, insights: [{ text: "b", facts: ["F3"] }, { text: "a", facts: ["F2", "F1"] }], recommendations: [] }))!;
    expect(orderByFacts(parsed)).toMatchObject({ insights: [{ text: "a" }, { text: "b" }] });
    expect(parseInsights("social", "not json")).toBeNull();
    expect(parseInsights("competitive", JSON.stringify({ summary: [] }))).toBeNull();
  });
});

describe("templateInsights", () => {
  it("writes every fact as its sentence, with no recommendations or gaps of its own", () => {
    const t = templateInsights("social", FACTS);
    expect(t).toEqual({ kind: "social", summary: { text: "Impressions rose 26.5% to 12,400. Video views fell 49.2% to 292.", facts: ["F1", "F2"] }, insights: FACTS.map((f) => ({ text: f.sentence, facts: [f.id] })), recommendations: null });
    expect(checkInsights(t, FACTS)).toEqual([]);
    expect(templateInsights("competitive", FACTS)).toEqual({ kind: "competitive", summary: FACTS.map((f) => ({ text: f.sentence, facts: [f.id] })), gaps: null });
  });

  it("keeps a competitive template's summary short: the three highest-scoring facts, never twenty lines", () => {
    const many = Array.from({ length: 12 }, (_, i) => fact({ id: `F${i + 1}`, key: `change|all|m${i}|`, score: 12 - i, sentence: `Fact ${i + 1}.` }));
    expect(templateInsights("competitive", many)).toEqual({ kind: "competitive", summary: many.slice(0, 3).map((f) => ({ text: f.sentence, facts: [f.id] })), gaps: null });
    // Out of order, still the three that score highest.
    expect(templateInsights("competitive", [...many].reverse()).summary.map((c) => c.facts[0])).toEqual(["F1", "F2", "F3"]);
  });
});

describe("the request", () => {
  it("asks Sonnet 5.5 for the fields through structured outputs at effort medium, with no sampling settings", async () => {
    const complete = vi.fn().mockResolvedValue({ text: JSON.stringify(social()), stopReason: "end_turn", raw: { usage: { input_tokens: 10000, output_tokens: 3000 } } });
    const out = await writeInsights(INPUT, { now: () => new Date(), complete });
    expect(out).toMatchObject({ source: "model", problems: [], input_tokens: 10000, output_tokens: 3000 });
    const body = complete.mock.calls[0][0];
    expect(body).toMatchObject({ model: "claude-sonnet-5-5", output_config: { effort: "medium", format: { type: "json_schema" } } });
    for (const p of ["temperature", "top_p", "top_k", "thinking"]) expect(body).not.toHaveProperty(p);
    expect(body.messages[0].content).toContain("F3 (share): LinkedIn brought 96.1% of the period's engagements.");
  });

  it("asks once more with the problems named, then shows the facts in code's words", async () => {
    const bad = { text: JSON.stringify(social({ insights: [{ text: "Impressions rose 31%.", facts: ["F1"] }] })), stopReason: "end_turn", raw: {} };
    const complete = vi.fn().mockResolvedValue(bad);
    const out = await writeInsights(INPUT, { now: () => new Date(), complete });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1][0].messages[0].content).toContain("- Insight 1 writes 31%, which is not a number of the facts it cites.");
    expect(out).toMatchObject({ source: "template", fields: templateInsights("social", FACTS) });

    const fixed = vi.fn().mockResolvedValueOnce(bad).mockResolvedValueOnce({ text: JSON.stringify(social()), stopReason: "end_turn", raw: {} });
    expect((await writeInsights(INPUT, { now: () => new Date(), complete: fixed })).source).toBe("model");
  });

  it("names the post sample, the suggestions the team rejected and its learned preferences in a competitive prompt, as main's analysis does", () => {
    const p = insightsPrompt({ ...INPUT, kind: "competitive", sample: [{ company: "Rival Co", platform: "instagram", format: "reel", text: "Who else forgets?", engagement: 900 }], rejected: [{ key: "post-more-memes", gap: "Post more memes" }], preferences: ["Prefer: Targets are cadences"] });
    expect(p).toContain('- Rival Co, instagram reel: "Who else forgets?"');
    expect(p).toContain("Suggestions the account team rejected (never propose any of these or a rephrasing of one):\n- Post more memes");
    expect(p).toContain("The account team's standing preferences for this client's suggestions, learned from their edits to earlier reports. Follow every one when you write gaps:\n- Prefer: Targets are cadences");
    // A monthly report has no gaps: neither is named.
    expect(insightsPrompt({ ...INPUT, rejected: [{ key: "post-more-memes", gap: "Post more memes" }] })).not.toContain("Post more memes");
  });
});

describe("inputHash", () => {
  it("depends on the facts, the post sample, the rejected suggestions, the learned preferences, the prompt version and the model", async () => {
    const a = await inputHash(INPUT);
    expect(await inputHash({ ...INPUT, facts: FACTS.map((f) => ({ ...f })) })).toBe(a);
    expect(await inputHash({ ...INPUT, sample: [{ company: "Rival Co", platform: "instagram", format: "reel", text: "Who else forgets?", engagement: 900 }] })).not.toBe(a);
    expect(await inputHash({ ...INPUT, rejected: [{ key: "post-more-memes", gap: "Post more memes" }] })).not.toBe(a);
    expect(await inputHash({ ...INPUT, preferences: ["Prefer: Targets are cadences"] })).not.toBe(a);
    expect(await inputHash(INPUT, "claude-opus-5-5")).not.toBe(a);
  });
});

/** A report row and the tables the job reads, with every write recorded. */
function fakeDb(tables: Record<string, unknown[]>, liveFrom: string | null = "2026-11-08T00:00:00Z") {
  const writes: Array<{ table: string; op: string; value: unknown; filters?: Array<[string, unknown]> }> = [];
  return {
    writes,
    rpc: async (name: string) => (name === "report_insights_live_from" ? { data: liveFrom, error: null } : { data: null, error: null }),
    from(table: string) {
      let rows = (tables[table] ?? []) as Array<Record<string, unknown>>;
      // deno-lint-ignore no-explicit-any
      const q: any = {};
      for (const name of ["select", "in", "lt", "order", "limit", "not"]) q[name] = () => q;
      const filters: Array<[string, unknown]> = [];
      q.eq = (c: string, v: unknown) => { filters.push([c, v]); rows = rows.filter((r) => !(c in r) || r[c] === v); return q; };
      for (const op of ["insert", "upsert", "update"]) q[op] = (value: unknown) => { writes.push({ table, op, value, filters }); return q; };
      q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok);
      return q;
    },
  };
}

const REPORT = {
  id: "r1", client_id: "mob", status: "completed", created_at: "2026-11-09T10:00:00Z", date_range_start: "2026-10-01", date_range_end: "2026-10-31", clients: { name: "Moburst", archived_at: null },
  report_data: [{ sprout_performance: { month_comparison: { current_month: { engagements: 542, impressions: 12400, video_views: 292 }, previous_month: { engagements: 673, impressions: 9800, video_views: 575 } } } }],
};

describe("runReportInsights", () => {
  const job = { id: "j", client_id: "mob", attempts: 1, max_attempts: 3, payload: { table: "reports", report_id: "r1" } };

  it("stores the answer under its input's hash, and uses a stored hash again with no call and the same words", async () => {
    const complete = vi.fn().mockResolvedValue({ text: "{}", stopReason: "end_turn", raw: {} });
    const db = fakeDb({ reports: [REPORT] });
    const out = await runReportInsights(db, job, { now: () => new Date("2026-11-09T11:00:00Z"), complete });
    expect(out).toMatchObject({ status: "done", result: { source: "template" } });
    const saved = db.writes.find((w) => w.table === "report_insights")!.value as Record<string, unknown>;
    expect(saved).toMatchObject({ report_table: "reports", report_id: "r1", client_id: "mob", kind: "social", source: "template", model: "claude-sonnet-5-5", prompt_version: 1, confirmed_at: "2026-11-09T11:00:00.000Z" });
    expect(String(saved.input_hash)).toMatch(/^[0-9a-f]{64}$/);

    // The same report again, with its answer stored: no call, the same words, stamped as the one shown.
    const again = vi.fn();
    const stored = fakeDb({ reports: [REPORT], report_insights: [{ id: "i1", report_id: "r1", input_hash: saved.input_hash }] });
    expect(await runReportInsights(stored, job, { now: () => new Date("2026-11-10T09:00:00Z"), complete: again })).toMatchObject({ status: "done", result: { reused: true } });
    expect(again).not.toHaveBeenCalled();
    expect(stored.writes).toEqual([{ table: "report_insights", op: "update", value: { confirmed_at: "2026-11-10T09:00:00.000Z" }, filters: [["report_id", "r1"], ["input_hash", saved.input_hash]] }]);
  });

  it("shows a report whose input returns to an earlier one with that earlier answer, confirmed again (undo, redo)", async () => {
    // Input A was answered first, then B; the figures went back to A: A's row is stamped and is the newest confirmed.
    const first = fakeDb({ reports: [REPORT] });
    await runReportInsights(first, job, { now: () => new Date("2026-11-09T11:00:00Z"), complete: vi.fn().mockResolvedValue({ text: "{}", stopReason: "end_turn", raw: {} }) });
    const a = (first.writes[0].value as { input_hash: string }).input_hash;
    const back = fakeDb({ reports: [REPORT], report_insights: [{ id: "b", report_id: "r1", input_hash: "b".repeat(64), confirmed_at: "2026-11-09T12:00:00Z" }, { id: "a", report_id: "r1", input_hash: a, confirmed_at: "2026-11-09T11:00:00Z" }] });
    await runReportInsights(back, job, { now: () => new Date("2026-11-09T13:00:00Z"), complete: vi.fn() });
    expect(back.writes).toEqual([{ table: "report_insights", op: "update", value: { confirmed_at: "2026-11-09T13:00:00.000Z" }, filters: [["report_id", "r1"], ["input_hash", a]] }]);
  });

  it("reads a competitive report's rejected suggestions and learned preferences once, when the job runs, as main's analysis gets them", async () => {
    const db = fakeDb({
      competitive_reports: [],
      competitive_insight_feedback: [
        { client_id: "mob", verdict: "down", insight_key: "post-more-memes", gap_text: "Post more memes" },
        { client_id: "mob", verdict: "up", insight_key: "weekly-reels", gap_text: "Weekly Reels" },
        { client_id: "mob", verdict: "down", insight_key: "a-daily-poll", gap_text: "A daily poll" },
      ],
      competitive_learnings: [{ client_id: "mob", kind: "avoid", text: "Memes" }, { client_id: "mob", kind: "prefer", text: "Targets are cadences" }],
    });
    const input = await insightsInput(db, "competitive_reports", { ...REPORT, report_data: {} });
    expect(input.rejected).toEqual([{ key: "a-daily-poll", gap: "A daily poll" }, { key: "post-more-memes", gap: "Post more memes" }]);
    expect(input.preferences).toEqual(["Avoid: Memes", "Prefer: Targets are cadences"]);
    // A monthly report reads neither.
    const social = await insightsInput(db, "reports", REPORT);
    expect([social.rejected, social.preferences]).toEqual([[], []]);
  });

  it("leaves a report from before go-live as it is (decision 4)", async () => {
    const complete = vi.fn();
    const db = fakeDb({ reports: [{ ...REPORT, created_at: "2026-11-01T10:00:00Z" }] });
    expect(await runReportInsights(db, job, { now: () => new Date(), complete })).toMatchObject({ status: "skipped" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("tries again later when the model can't be reached, and ends quietly when the tries are used", async () => {
    const complete = vi.fn().mockRejectedValue(new Error("Anthropic API error 529"));
    const db = fakeDb({ reports: [REPORT] });
    expect((await runReportInsights(db, job, { now: () => new Date(), complete })).status).toBe("queued");
    expect((await runReportInsights(db, { ...job, attempts: 3 }, { now: () => new Date(), complete })).status).toBe("failed");
  });
});
