/* eslint-disable @typescript-eslint/no-explicit-any -- stored report JSON and database doubles are untyped. */
// The stored-report repair (REPORTS-20, REPORTS-21): stored counts below zero
// floored from the report's own figures with the changes and summary lines
// that follow from them, British spelling put right by the word map, a dry
// run that writes nothing, and an apply that keeps what was there.
import { describe, expect, it } from "vitest";
import { MOBURST } from "../../../fixtures/pipelines/social";
import { floorStoredFigures, insightsSpellingFixes, negativeCounts, repairStoredReports, spellingFixes } from "../../../functions/_shared/reports/repairStored";

// deno-lint-ignore no-explicit-any
type Any = any;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const stored = () => clone(MOBURST.stored_report.report_data);

/** A report shaped like Bader Law's June reports: previous reactions -6 against 823, stored as the n8n engine wrote them. */
function baderShape(): Any {
  return {
    report_period: { current_month: { start: "2026-03-01", end: "2026-05-31" }, previous_month: { start: "2025-11-30", end: "2026-02-28" } },
    sprout_performance: {
      overall_totals: { impressions: 4625450, reactions: 823, shares: 47 },
      month_comparison: {
        current_month: { impressions: 4625450, reactions: 823, shares: 47 },
        previous_month: { impressions: 24465, reactions: -6, shares: 0 },
        changes: {
          impressions: { absolute: 4600985, current: 4625450, percent: 18806, previous: 24465 },
          reactions: { absolute: 829, current: 823, percent: -13817, previous: -6 },
          shares: { absolute: 47, current: 47, percent: 100, previous: 0 },
        },
        summary: ["impressions: ↑ 18806% (+4600985)", "reactions: ↓ 13817% (+829)", "shares: ↑ 100% (+47)"],
      },
      top_posts: [{ url: "https://x/1", impressions: 505, engagement: 7 }],
    },
    metrics_summary: { impressions_change: 18806, reactions_change: -13817, shares_change: 100 },
    ai_analysis: { sprout_performance_analysis: { summary: "Reactions are listed in the report summary as ↓ 13817% (+829), which indicates a data inconsistency." } },
  };
}

describe("floorStoredFigures", () => {
  it("changes nothing in a report with no count below zero", () => {
    expect(floorStoredFigures(stored()).changes).toEqual([]);
  });

  it("floors previous reactions -6 at zero and rewords only what follows from it", () => {
    const rd = baderShape();
    expect(negativeCounts(rd)).toEqual(["sprout_performance.month_comparison.previous_month.reactions", "sprout_performance.month_comparison.changes.reactions.previous"]);
    const out = floorStoredFigures(rd);
    const mc = out.report_data.sprout_performance.month_comparison;
    expect(mc.previous_month.reactions).toBe(0);
    expect(mc.changes.reactions).toEqual({ current: 823, previous: 0, absolute: 823, percent: null });
    expect(mc.summary).toEqual(["impressions: ↑ 18806% (+4600985)", "reactions: new activity (previous period was zero) (+823)", "shares: ↑ 100% (+47)"]);
    // A change from zero is null, as the comparison says ("new activity"): QA 22 Nov 2026.
    expect(out.report_data.metrics_summary).toEqual({ impressions_change: 18806, reactions_change: null, shares_change: 100 });
    expect(out.changes.map((c) => c.path).sort()).toEqual([
      "metrics_summary.reactions_change",
      "sprout_performance.month_comparison.changes.reactions.absolute",
      "sprout_performance.month_comparison.changes.reactions.percent",
      "sprout_performance.month_comparison.changes.reactions.previous",
      "sprout_performance.month_comparison.previous_month.reactions",
      "sprout_performance.month_comparison.summary[1]",
    ]);
    // Top posts and every other figure stay as stored.
    expect(out.report_data.sprout_performance.top_posts).toEqual(rd.sprout_performance.top_posts);
    expect(negativeCounts(out.report_data)).toEqual([]);
  });

  it("floors a platform's previous shares and rebuilds that platform's change, as Uproar's October report needs", () => {
    const rd = stored();
    const p0 = rd.sprout_performance.platform_breakdown[0];
    p0.previous.shares = -1;
    p0.changes.shares = { current: 0, previous: -1, absolute: 1, percent: -100 };
    p0.current.shares = 0;
    const out = floorStoredFigures(rd);
    expect(out.report_data.sprout_performance.platform_breakdown[0].previous.shares).toBe(0);
    expect(out.report_data.sprout_performance.platform_breakdown[0].changes.shares).toEqual({ current: 0, previous: 0, absolute: 0, percent: 0 });
    expect(out.changes.every((c) => c.path.startsWith("sprout_performance.platform_breakdown[0]."))).toBe(true);
  });
});

describe("spellingFixes", () => {
  it("rewrites only failing text a client reads, leaving the report's own words, quotes and post copy alone", () => {
    const rd = {
      client_name: "Colour Pop",
      context: { content_pillars: ["Human Behaviour Insights"] },
      ai_analysis: {
        sprout_performance_analysis: { key_insights: ["Audience behaviour shifted toward organised carousels.", "Our Human Behaviour Insights pillar led.", "Colour Pop posted \"Our colour range\"."] },
        competitive_takeaways: ["Peers analyse weekly."],
        content_calendar: [{ caption: "Our colour range" }],
        executive_summary: "All American.",
      },
    };
    const out = spellingFixes(rd, "Colour Pop");
    expect(out.changes).toEqual([
      { path: "ai_analysis.sprout_performance_analysis.key_insights[0]", before: "Audience behaviour shifted toward organised carousels.", after: "Audience behavior shifted toward organized carousels." },
      { path: "ai_analysis.competitive_takeaways[0]", before: "Peers analyse weekly.", after: "Peers analyze weekly." },
    ]);
    expect(out.report_data.ai_analysis.content_calendar).toEqual(rd.ai_analysis.content_calendar);
    expect(out.report_data.ai_analysis.sprout_performance_analysis.key_insights[1]).toBe("Our Human Behaviour Insights pillar led.");
    expect(spellingFixes({ ai_analysis: { competitive_takeaways: ["The app was installed and enrolled."] } }, null).changes).toEqual([]);
  });

  it("rewrites the trend analysis a report stored before 9 Nov shows, leaving its hashtags as written", () => {
    const rd = {
      ai_analysis: {
        instagram_trends_analysis: {
          overview: "Instagram rewards authority signals and recognisable names.",
          key_takeaways: ["Recognisable outlet names lift saves."],
          top_themes: ["Colour stories"],
          opportunities_for_client: ["Optimise carousels."],
          successful_formats: ["Behavioural explainers"],
          top_hashtags: ["#colourpop"],
        },
        tiktok_trends_analysis: { overview: "All American here." },
      },
    };
    const out = spellingFixes(rd, null);
    const ig = out.report_data.ai_analysis.instagram_trends_analysis;
    expect(ig.overview).toBe("Instagram rewards authority signals and recognizable names.");
    expect(ig.key_takeaways).toEqual(["Recognizable outlet names lift saves."]);
    expect(ig.top_themes).toEqual(["Color stories"]);
    expect(ig.opportunities_for_client).toEqual(["Optimize carousels."]);
    expect(ig.successful_formats).toEqual(["Behavioral explainers"]);
    expect(ig.top_hashtags).toEqual(["#colourpop"]);
    expect(out.changes).toHaveLength(5);
  });

  it("rewrites an insight's text, leaving its facts' own words and the companies alone", () => {
    const row = {
      facts: [{ id: "F1", sentence: "Human Behaviour Insights posts rose 26.5%.", company: "Colour Pop" }],
      fields: { kind: "social", summary: { text: "Colour Pop's Human Behaviour Insights posts rose 26.5%; behaviour shifted.", facts: ["F1"] }, insights: [{ text: "Optimise reels.", facts: ["F1"] }], recommendations: null },
    };
    const out = insightsSpellingFixes(row, "Colour Pop");
    expect(out.fields.summary.text).toBe("Colour Pop's Human Behaviour Insights posts rose 26.5%; behavior shifted.");
    expect(out.fields.insights[0].text).toBe("Optimize reels.");
    expect(out.fields.insights[0].facts).toEqual(["F1"]);
    expect(out.changes.map((c) => c.path)).toEqual(["fields.summary.text", "fields.insights[0].text"]);
  });
});

/** A database double: the reports (in created_at order) and their insights; updates and rpc calls are recorded. */
function fakeDb(o: { reports: Any[]; insights?: Record<string, Any[]>; failUpdate?: string; jobs?: Any[] }) {
  const updates: Array<{ table: string; patch: Any; id: unknown }> = [];
  const rpcs: Array<{ fn: string; args: Any }> = [];
  // scheduled_jobs as report_text_enqueue writes it: one row per dedupe_key, a second insert does nothing.
  const jobs: Any[] = o.jobs ?? [];
  const from = (table: string) => {
    const filters: Array<[string, string, unknown]> = [];
    let patch: Any = null;
    let range: [number, number] | null = null;
    const rows = (): Any[] => {
      if (table === "reports") {
        let list = o.reports;
        for (const [op, k, v] of filters) {
          if (op === "gt") list = list.filter((r) => String(r[k]) > String(v));
          if (op === "in" && k === "id") list = list.filter((r) => (v as string[]).includes(r.id));
        }
        return range ? list.slice(range[0], range[1] + 1) : list;
      }
      if (table === "report_insights") return o.insights?.[String(filters.find(([, k]) => k === "report_id")?.[2])] ?? [];
      if (table === "scheduled_jobs") {
        let list = jobs;
        for (const [op, k, v] of filters) {
          if (op === "eq") list = list.filter((j) => j[k] === v);
          if (op === "in") list = list.filter((j) => (v as unknown[]).includes(j[k]));
          if (op === "like") list = list.filter((j) => String(j[k]).startsWith(String(v).replace(/%$/, "")));
        }
        return list;
      }
      return [];
    };
    const q: Any = {
      select: () => q, order: () => q,
      range: (a: number, b: number) => { range = [a, b]; return q; },
      in: (k: string, v: unknown) => { filters.push(["in", k, v]); return q; },
      gt: (k: string, v: unknown) => { filters.push(["gt", k, v]); return q; },
      like: (k: string, v: unknown) => { filters.push(["like", k, v]); return q; },
      eq: (k: string, v: unknown) => { filters.push(["eq", k, v]); return q; },
      update: (p: Any) => { patch = p; return q; },
      then: (resolve: Any, reject: Any) => {
        if (patch) {
          const id = filters.find(([op, k]) => op === "eq" && k === "id")?.[2];
          if (o.failUpdate === id) return Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve, reject);
          updates.push({ table, patch, id });
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
      },
    };
    return q;
  };
  const rpc = (fn: string, args: Any) => {
    rpcs.push({ fn, args });
    if (fn === "report_text_enqueue") {
      const key = `report_text:${args.p_report}:${args.p_key}`;
      if (!jobs.some((j) => j.dedupe_key === key)) jobs.push({ dedupe_key: key, kind: "report_text", status: "queued" });
    }
    return Promise.resolve({ data: null, error: null });
  };
  return { db: { from, rpc }, updates, rpcs, jobs };
}

describe("repairStoredReports", () => {
  const bader = (id: string, created_at: string): Any => ({ id, client_id: "c1", status: "completed", created_at, report_data: baderShape(), correction_audit: null, clients: { name: "Bench Law", archived_at: null } });
  const setup = () => {
    const rd = baderShape();
    rd.ai_analysis.competitive_takeaways = ["Peers optimise weekly."];
    const report = { ...bader("r1", "2026-06-03T07:20:15Z"), report_data: rd };
    const insights = { r1: [{ id: "i1", facts: [], fields: { kind: "social", summary: { text: "Colour held.", facts: [] }, insights: [], recommendations: null } }] };
    return { reports: [report], insights };
  };

  it("lists every change in a dry run, from the report's own figures, and writes nothing", async () => {
    const { db, updates, rpcs } = fakeDb(setup());
    const result = await repairStoredReports(db);
    expect(result.dry_run).toBe(true);
    expect(result.cost).toMatch(/No provider or model cost/);
    expect(updates).toEqual([]);
    expect(rpcs).toEqual([]);
    const [entry] = result.reports;
    expect(entry.figures.status).toBe("would repair");
    expect(entry.figures.changes).toEqual(expect.arrayContaining([{ path: "sprout_performance.month_comparison.previous_month.reactions", before: -6, after: 0 }]));
    expect(entry.spelling).toEqual([{ path: "ai_analysis.competitive_takeaways[0]", before: "Peers optimise weekly.", after: "Peers optimize weekly." }]);
    expect(entry.insights).toEqual([{ id: "i1", changes: [{ path: "fields.summary.text", before: "Colour held.", after: "Color held." }] }]);
    // The sentence quoting the old change is listed, to be reworded only on request.
    expect(entry.stale_sentences).toEqual(["Reactions are listed in the report summary as ↓ 13817% (+829), which indicates a data inconsistency."]);
  });

  it("with apply, writes the repaired report and insights, keeps what was there, and queues no rewording", async () => {
    const { db, updates, rpcs } = fakeDb(setup());
    const result = await repairStoredReports(db, { apply: true, now: () => new Date("2026-11-12T10:00:00Z") });
    expect(result.reports[0].figures.status).toBe("repaired");
    const report = updates.find((u) => u.table === "reports")!;
    expect(report.id).toBe("r1");
    expect(report.patch.report_data.sprout_performance.month_comparison.previous_month.reactions).toBe(0);
    expect(report.patch.report_data.ai_analysis.competitive_takeaways).toEqual(["Peers optimize weekly."]);
    expect(report.patch.correction_audit.original.sprout_performance.month_comparison.previous_month.reactions).toBe(-6);
    expect(report.patch.correction_audit.original.metrics_summary.reactions_change).toBe(-13817);
    expect(report.patch.correction_audit.original.ai_analysis.competitive_takeaways).toEqual(["Peers optimise weekly."]);
    expect(report.patch.correction_audit.corrections.map((c: Any) => c.what)).toEqual(["sprout_figures", "spelling", "insights_spelling"]);
    expect(updates.find((u) => u.table === "report_insights")).toEqual({ table: "report_insights", id: "i1", patch: { fields: { kind: "social", summary: { text: "Color held.", facts: [] }, insights: [], recommendations: null } } });
    expect(rpcs).toEqual([]);
  });

  it("with apply and reword, queues one report_text job for a repaired report whose text quotes a changed figure, and says whether it did", async () => {
    const at = "2026-11-12T10:00:00.000Z";
    const now = () => new Date(at);
    const { db, rpcs } = fakeDb(setup());
    const queued = await repairStoredReports(db, { apply: true, reword: true, now });
    expect(rpcs).toEqual([{ fn: "report_text_enqueue", args: { p_table: "reports", p_report: "r1", p_key: `figures-repair:${at}` } }]);
    expect(queued.reports[0].reword).toBe("queued");
    await expect(repairStoredReports(fakeDb(setup()).db, { reword: true })).rejects.toThrow(/apply/);
    // A report repaired by an earlier apply is reworded from the figures kept in correction_audit.
    const first = fakeDb(setup());
    await repairStoredReports(first.db, { apply: true });
    const repairedRow = { ...setup().reports[0], ...first.updates.find((u) => u.table === "reports")!.patch };
    const later = fakeDb({ reports: [repairedRow] });
    const result = await repairStoredReports(later.db, { apply: true, reword: true, now });
    expect(later.rpcs).toEqual([{ fn: "report_text_enqueue", args: { p_table: "reports", p_report: "r1", p_key: `figures-repair:${at}` } }]);
    expect(later.updates).toEqual([]);
    expect(result.reports[0].figures.status).toBe("none");
    expect(result.reports[0].reword).toBe("queued");
  });

  it("queues no second rewording while one is still open, and queues a new one after a job that failed", async () => {
    const open = fakeDb({ ...setup(), jobs: [{ dedupe_key: "report_text:r1:figures-repair:2026-11-11T09:00:00.000Z", kind: "report_text", status: "queued" }] });
    const waiting = await repairStoredReports(open.db, { apply: true, reword: true });
    expect(open.rpcs).toEqual([]);
    expect(waiting.reports[0].reword).toBe("already queued");

    const failed = fakeDb({ ...setup(), jobs: [{ dedupe_key: "report_text:r1:figures-repair:2026-11-11T09:00:00.000Z", kind: "report_text", status: "failed" }] });
    const again = await repairStoredReports(failed.db, { apply: true, reword: true, now: () => new Date("2026-11-12T10:00:00.000Z") });
    expect(failed.rpcs).toHaveLength(1);
    expect(again.reports[0].reword).toBe("queued");
  });

  it("says a rewording was not queued when the queue wrote no job (the client was archived in between)", async () => {
    const d = fakeDb(setup());
    d.db.rpc = (fn: string, args: Any) => { d.rpcs.push({ fn, args }); return Promise.resolve({ data: null, error: null }); };
    const result = await repairStoredReports(d.db, { apply: true, reword: true });
    expect(result.reports[0].reword).toBe("not queued");
  });

  it("lists in a dry run the sentences a report repaired by an earlier apply still quotes, so the rewording can be previewed", async () => {
    const first = fakeDb(setup());
    await repairStoredReports(first.db, { apply: true });
    const repairedRow = { ...setup().reports[0], ...first.updates.find((u) => u.table === "reports")!.patch };
    const dry = fakeDb({ reports: [repairedRow] });
    const result = await repairStoredReports(dry.db);
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0].figures.status).toBe("none");
    expect(result.reports[0].stale_sentences).toEqual(["Reactions are listed in the report summary as ↓ 13817% (+829), which indicates a data inconsistency."]);
    expect(dry.updates).toEqual([]);
    expect(dry.rpcs).toEqual([]);
  });

  it("stops after the limit and returns where to continue; a failed report is listed and the rest go on", async () => {
    const reports = [bader("a", "2026-06-01T00:00:00Z"), bader("b", "2026-06-02T00:00:00Z"), bader("c", "2026-06-03T00:00:00Z")];
    const first = await repairStoredReports(fakeDb({ reports }).db, { limit: 2 });
    expect(first.reports.map((r) => r.report_id)).toEqual(["a", "b"]);
    expect(first.next_after).toBe("2026-06-02T00:00:00Z");
    const second = await repairStoredReports(fakeDb({ reports }).db, { limit: 2, after: first.next_after! });
    expect(second.reports.map((r) => r.report_id)).toEqual(["c"]);
    expect(second.next_after).toBeNull();
    const failing = fakeDb({ reports, failUpdate: "b" });
    const applied = await repairStoredReports(failing.db, { apply: true });
    expect(applied.reports.find((r) => r.report_id === "b")?.error).toMatch(/boom/);
    // A report whose write failed is not called repaired.
    expect(applied.reports.find((r) => r.report_id === "b")?.figures.status).toBe("not repaired");
    expect(applied.reports.find((r) => r.report_id === "a")?.figures.status).toBe("repaired");
    expect(failing.updates.map((u) => u.id)).toEqual(["a", "c"]);
  });

  it("leaves a report with nothing to repair out of the list", async () => {
    const { db } = fakeDb({ reports: [{ id: "r2", status: "completed", created_at: "2026-11-01T00:00:00Z", report_data: stored(), clients: { name: "Bench Co" } }] });
    expect((await repairStoredReports(db)).reports).toEqual([]);
  });
});
