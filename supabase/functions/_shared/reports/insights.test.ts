// Report insights from the data (Lital, 3 Nov 2026): the model only words
// facts code worked out, code checks every number and direction, and the
// same input always shows the same words. The model is a fake.

import { describe, expect, it, vi } from "vitest";
import type { Fact } from "./facts";
import {
  checkInsights, inputHash, insightsPrompt, orderByFacts, parseInsights, runReportInsights, templateInsights, writeInsights,
  type InsightFields, type InsightsInput,
} from "./insights";

const fact = (over: Partial<Fact>): Fact => ({
  id: "F1", key: "change|all|impressions|", kind: "change", platform: "all", metric: "impressions", unit: "count", value: 12400, previous: 9800, change: 2600, percent: 26.5,
  score: 2.6, numbers: [12400, 9800, 2600, 26.5], sentence: "Impressions rose 26.5% to 12,400.", basis: "Impressions 12,400 in October against 9,800 in September, +26.5%, from Sprout", ...over,
});
const FACTS: Fact[] = [
  fact({}),
  fact({ id: "F2", key: "change|all|views|", metric: "views", value: 292, previous: 575, change: -283, percent: -49.2, numbers: [292, 575, 283, 49.2], sentence: "Video views fell 49.2% to 292.", basis: "Video views 292 in October against 575 in September, -49.2%, from Sprout" }),
  fact({ id: "F3", key: "share|LinkedIn|engagements|", kind: "share", platform: "LinkedIn", metric: "engagements", unit: "percent", value: 96.1, numbers: [96.1, 521, 542], sentence: "LinkedIn brought 96.1% of the period's engagements.", basis: "LinkedIn 521 of 542 engagements, from Sprout" }),
];
const INPUT: InsightsInput = { kind: "social", client: "Moburst", period: "2026-10-01 to 2026-10-31", facts: FACTS, sample: [], verdicts: [] };

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
    expect(checkInsights(social({ insights: [{ text: "Video views rose 49.2% to 292.", facts: ["F2"] }] }), FACTS)).toEqual(["Insight 1 says views went up, but it fell."]);
    expect(checkInsights(social({ recommendations: [{ text: "Post more video.", facts: [] }] }), FACTS)).toEqual(["Recommendation 1 cites no fact."]);
    expect(checkInsights(social({ insights: [{ text: "Impressions rose 26.5% — a record.", facts: ["F1"] }] }), FACTS)).toEqual(["Insight 1 has a dash; use commas or periods."]);
    expect(checkInsights(null, FACTS)).toEqual(["The answer could not be read as the JSON asked for."]);
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
});

describe("the request", () => {
  it("asks Sonnet 5.5 for the fields through structured outputs at effort medium, with no sampling settings", async () => {
    const complete = vi.fn().mockResolvedValue({ text: JSON.stringify(social()), stopReason: "end_turn", raw: { usage: { input_tokens: 10000, output_tokens: 3000 } } });
    const out = await writeInsights(INPUT, { now: () => new Date(), complete });
    expect(out).toMatchObject({ source: "model", problems: [], input_tokens: 10000, output_tokens: 3000 });
    const body = complete.mock.calls[0][0];
    expect(body).toMatchObject({ model: "claude-sonnet-5-5", output_config: { effort: "medium", format: { type: "json_schema" } } });
    for (const p of ["temperature", "top_p", "top_k", "thinking"]) expect(body).not.toHaveProperty(p);
    expect(body.messages[0].content).toContain("F3: LinkedIn brought 96.1% of the period's engagements.");
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

  it("names the team's verdicts and the post sample in a competitive prompt", () => {
    const p = insightsPrompt({ ...INPUT, kind: "competitive", sample: [{ company: "Rival Co", platform: "instagram", format: "reel", text: "Who else forgets?", engagement: 900 }], verdicts: [{ verdict: "down", gap: "Post more memes" }, { verdict: "up", gap: "Weekly Reels" }] });
    expect(p).toContain('- Rival Co, instagram reel: "Who else forgets?"');
    expect(p).toContain("Suggestions the team rejected (never suggest these or anything like them again):\n- Post more memes");
    expect(p).toContain("Suggestions the team chose to implement (keep them in mind):\n- Weekly Reels");
  });
});

describe("inputHash", () => {
  it("is the same for the same input, and new for a changed verdict over the same facts", async () => {
    const a = await inputHash(INPUT);
    expect(await inputHash({ ...INPUT, facts: FACTS.map((f) => ({ ...f })) })).toBe(a);
    const verdict = await inputHash({ ...INPUT, verdicts: [{ verdict: "down", gap: "Post more memes" }] });
    expect(verdict).not.toBe(a);
    expect(await inputHash(INPUT, "claude-opus-5-5")).not.toBe(a);
  });
});

/** A report row and the tables the job reads, with every write recorded. */
function fakeDb(tables: Record<string, unknown[]>, liveFrom: string | null = "2026-11-08T00:00:00Z") {
  const writes: Array<{ table: string; op: string; value: unknown }> = [];
  return {
    writes,
    rpc: async (name: string) => (name === "report_insights_live_from" ? { data: liveFrom, error: null } : { data: null, error: null }),
    from(table: string) {
      let rows = (tables[table] ?? []) as Array<Record<string, unknown>>;
      // deno-lint-ignore no-explicit-any
      const q: any = {};
      for (const name of ["select", "in", "lt", "order", "limit", "not"]) q[name] = () => q;
      q.eq = (c: string, v: unknown) => { rows = rows.filter((r) => !(c in r) || r[c] === v); return q; };
      for (const op of ["insert", "upsert", "update"]) q[op] = (value: unknown) => { writes.push({ table, op, value }); return q; };
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
    expect(saved).toMatchObject({ report_table: "reports", report_id: "r1", client_id: "mob", kind: "social", source: "template", model: "claude-sonnet-5-5", prompt_version: 1 });
    expect(String(saved.input_hash)).toMatch(/^[0-9a-f]{64}$/);

    // The same report again, with its answer stored: no call, nothing written.
    const again = vi.fn();
    const stored = fakeDb({ reports: [REPORT], report_insights: [{ id: "i1", report_id: "r1", input_hash: saved.input_hash }] });
    expect(await runReportInsights(stored, job, { now: () => new Date(), complete: again })).toMatchObject({ status: "done", result: { reused: true } });
    expect(again).not.toHaveBeenCalled();
    expect(stored.writes).toEqual([]);
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
