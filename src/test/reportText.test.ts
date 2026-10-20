// Stored report text that quotes a figure the report no longer shows (Lital,
// 20 Oct 2026, "fix this"): found by comparing the text's numbers with the
// report's figures as written and as shown, rewritten by one model call per
// report, checked, and put back in place with every other word untouched.

import { describe, expect, it, vi } from "vitest";
import {
  applyCorrections, checkCorrection, competitiveFigures, CORRECTION_SYSTEM, correctionPrompt, parseCorrection, quotedFigures, sentences, socialFigures, staleReportText,
} from "../../supabase/functions/_shared/reports/reportText";
import { runReportText } from "../../supabase/functions/_shared/reports/correctText";
import { clientFiguresFromStoredPosts } from "../../supabase/functions/_shared/competitive/storedFigures";
import { BADER_POSTS, BADER_REPORT } from "./competitive/fixtures/bader20260930";

const repaired = clientFiguresFromStoredPosts(BADER_REPORT, { socialPosts: BADER_POSTS }).report_data;
const stale = () => staleReportText("competitive", repaired, competitiveFigures(BADER_REPORT, "stored"), competitiveFigures(repaired, "shown"));

describe("numbers a text quotes as figures", () => {
  it("reads rates, shares and counts, and never a target", () => {
    const claims = quotedFigures("Engagement rate per post at 28.6% is inflated; 94 posts, 21.9 a week, 13,809 followers, 1.7M views and 2,533 engagements. Target 0.8%+ and aim for 3 posts.");
    expect(claims.map((c) => [c.text, c.kind])).toEqual([["28.6%", "percent"], ["94", "posts"], ["21.9", "cadence"], ["13,809", "audience"], ["1.7M", "impressions"], ["2,533", "engagement"]]);
    expect(quotedFigures("TikTok rate is high on a 42-follower base")[0]).toMatchObject({ value: 42, kind: "audience" });
    expect(quotedFigures("Post 3 Reels/week and test 12:00 and 18:00 UTC for 4 weeks.").map((c) => [c.value, c.kind])).toEqual([[3, "cadence"]]);
  });

  it("splits sentences without breaking a decimal or an abbreviation", () => {
    const text = "Rate at 0.5% held. Posts, e.g. Reels, rose to 12. Done";
    expect(sentences(text).map((s) => s.text)).toEqual(["Rate at 0.5% held.", " Posts, e.g. Reels, rose to 12.", " Done"]);
  });
});

describe("Bader Law's competitive report, September 2026", () => {
  it("finds the sentences that quote an old rate or count, and leaves the rest", () => {
    const found = stale();
    expect(found.map((s) => s.numbers.map((n) => n.text).join(" "))).toEqual(["28.6%", "94", "42", "0.07%", "0.23%", "0.14%", "94"]);
    expect(found[0]).toMatchObject({ path: ["competitor_breakdowns", 0, "engagement_level"], sentence: "Engagement rate per post at 28.6% is inflated by small-follower TikTok; Facebook and Instagram rates are much lower." });
    expect(found[0].numbers[0].now.map((f) => f.label)).toContain("Bader Law, all platforms, engagement rate");
    // The summary is written from the shown figures when the report is read; "13 posts", "19 YouTube uploads" and the 42-follower TikTok still hold.
    expect(found.some((s) => s.path[0] === "executive_summary")).toBe(false);
    expect(found.some((s) => /19 YouTube uploads|42-follower|13 posts/.test(s.sentence))).toBe(false);
  });

  it("tells the model only those sentences, what each number was, and the figures shown now", () => {
    const prompt = correctionPrompt({ client: "Bader Law", kind: "competitive", period: "2026-09-01 to 2026-09-30" }, stale(), competitiveFigures(repaired, "shown"));
    expect(prompt).toContain('s1 (competitor breakdowns / Bader Law / engagement level): Engagement rate per post at 28.6%');
    expect(prompt).toContain("Bader Law, all platforms, engagement rate: 0.12%");
    expect(prompt).toContain("Bader Law, all platforms, posts: 65");
    expect(CORRECTION_SYSTEM).toMatch(/change only the words whose claim depends on those numbers/);
    expect(CORRECTION_SYSTEM).toMatch(/Never add an em dash or an en dash/);
  });

  it("puts the corrected sentences back and refuses an answer that invents a number or adds a dash", () => {
    const found = stale();
    const good = new Map(found.map((s) => [s.id, s.sentence.replace("28.6%", "0.12%").replace("94 posts", "65 posts").replace("42 posts", "13 posts").replace("0.07%", "1.28%").replace("0.23%", "2.89%").replace("0.14%", "1.62%")]));
    expect(checkCorrection(found, good, competitiveFigures(repaired, "shown"))).toBeNull();
    expect(checkCorrection(found, new Map([...good, ["s1", "Engagement rate per post at 7.5% is high."]]), competitiveFigures(repaired, "shown"))).toMatch(/7\.5%/);
    expect(checkCorrection(found, new Map([...good, ["s1", "Engagement rate is 0.12% — low."]]), competitiveFigures(repaired, "shown"))).toMatch(/dash/);
    expect(checkCorrection(found, parseCorrection("no json"), [])).toMatch(/could not be read/);
    const applied = applyCorrections(repaired.ai_analysis, found, good)!;
    expect(applied.ai.competitor_breakdowns[0].engagement_level).toBe("Engagement rate per post at 0.12% is inflated by small-follower TikTok; Facebook and Instagram rates are much lower.");
    expect(applied.ai.recommended_schedule.rationale).toBe("Reduce from 65 posts to 19/week and concentrate into repeatable series, keeping Thu/Tue weight where the landscape is active. Test 12:00, 18:00, and 22:00 UTC for 4 weeks and compare engagement rate per post by network.");
    // Every other field word for word.
    expect(applied.ai.gaps_for_client).toEqual(repaired.ai_analysis.gaps_for_client);
    expect(applied.ai.competitor_breakdowns[0].platform_notes[1]).toEqual(repaired.ai_analysis.competitor_breakdowns[0].platform_notes[1]);
    expect(applied.changed).toHaveLength(7);
    expect(repaired.ai_analysis.competitor_breakdowns[0].engagement_level).toMatch(/28\.6%/);
  });
});

describe("a monthly report counted with clicks", () => {
  const rd = { sprout_performance: {
    overall_totals: { engagements: 3341, impressions: 996405, reactions: 1987, comments: 109, shares: 632, link_clicks: 223, video_views: 1851832 },
    platform_breakdown: [
      { network: "Facebook", post_count: 13, current: { shares: 24, comments: 47, reactions: 469, engagements: 963, impressions: 846738, video_views: 205032, link_clicks: 49 } },
      { network: "Instagram", post_count: 15, current: { shares: 556, comments: 43, reactions: 412, engagements: 1027, impressions: 102229, video_views: 19679 } },
      { network: "YouTube", post_count: 19, current: { shares: 10, comments: 5, reactions: 708, engagements: 723, impressions: 0, video_views: 1581992 } },
    ],
  }, ai_analysis: { sprout_performance_analysis: { key_insights: ["Facebook drove 963 engagements from 13 posts.", "Impressions reached 996,405."] }, content_calendar: [{ posts: [{ copy: "963 engagements" }] }] } };

  it("finds the quoted Sprout engagements total and leaves post copy alone", () => {
    const found = staleReportText("social", rd, socialFigures(rd, "stored"), socialFigures(rd, "shown"));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ path: ["sprout_performance_analysis", "key_insights", 0], numbers: [{ text: "963", kind: "engagement" }] });
    expect(found[0].numbers[0].now.map((f) => f.value)).toEqual([540]);
  });
});

describe("Moburst's monthly report of 16 Oct 2026 (fd501cba), counted with clicks", () => {
  // The stored figures and text of the report, as read from the database on 20 Oct 2026.
  const change = (current: number, previous: number, percent: number) => ({ current, previous, percent, absolute: current - previous });
  const rd = {
    sprout_performance: {
      overall_totals: { shares: 0, comments: 4, reactions: 71, engagements: 542, impressions: 7350, link_clicks: 465, video_views: 292 },
      month_comparison: {
        current_month: { shares: 0, comments: 4, reactions: 71, engagements: 542, impressions: 7350, link_clicks: 465, video_views: 292 },
        previous_month: { shares: 2, comments: 5, reactions: 102, engagements: 673, impressions: 9424, link_clicks: 551, video_views: 575 },
        changes: { engagements: change(542, 673, -19.5), impressions: change(7350, 9424, -22), video_views: change(292, 575, -49.2) },
      },
      platform_breakdown: [
        { network: "LinkedIn", post_count: 11, previous_post_count: 14, current: { shares: 0, comments: 3, reactions: 54, engagements: 521, impressions: 5476, link_clicks: 464, video_views: 198 }, previous: { shares: 2, comments: 4, reactions: 93, engagements: 649, impressions: 7725, link_clicks: 550, video_views: 442 }, changes: { engagements: change(521, 649, -19.7), impressions: change(5476, 7725, -29.1) } },
        { network: "Instagram", post_count: 2, previous_post_count: 1, current: { shares: 0, comments: 1, reactions: 17, engagements: 20, impressions: 1249, link_clicks: 0, video_views: 4 }, previous: { shares: 0, comments: 1, reactions: 4, engagements: 5, impressions: 745, link_clicks: 0, video_views: 15 }, changes: { engagements: change(20, 5, 300), impressions: change(1249, 745, 67.7), video_views: change(4, 15, -73.3) } },
        { network: "Facebook", post_count: 1, previous_post_count: 3, current: { shares: 0, comments: 0, reactions: 0, engagements: 1, impressions: 625, link_clicks: 1, video_views: 90 }, previous: { shares: 0, comments: 0, reactions: 5, engagements: 19, impressions: 954, link_clicks: 1, video_views: 118 }, changes: { engagements: change(1, 19, -94.7) } },
      ],
    },
    ai_analysis: { sprout_performance_analysis: {
      month_over_month_summary: "Video softness was the biggest move: views fell 49.2%, pulling down overall engagement even as click intent stayed comparatively resilient.",
      platform_breakdown: [
        { platform: "LinkedIn", insights: ["Click intent stayed strongest here: LinkedIn generated 464 clicks and 521 engagements, making it the clearest lower-funnel platform.", "Volume slipped and reach followed: 11 posts this month versus 14 prior coincided with a 29.1% drop in impressions."] },
        { platform: "Instagram", insights: ["Efficiency improved with limited output: two posts delivered a 67.7% rise in impressions and a 300% lift in engagements.", "Video is not proven here yet: views fell 73.3%, so keep Instagram focused on carousels before scaling Reels."] },
      ],
    } },
  };

  it("finds the two sentences that quote engagements with clicks, and keeps the ones about views, impressions and posts", () => {
    const found = staleReportText("social", rd, socialFigures(rd, "stored"), socialFigures(rd, "shown"));
    expect(found.map((s) => [s.field, s.numbers.map((n) => n.text)])).toEqual([
      ["sprout performance analysis / platform breakdown / LinkedIn / insights", ["521"]],
      ["sprout performance analysis / platform breakdown / Instagram / insights", ["300%"]],
    ]);
    // LinkedIn's engagements are 54 reactions and 3 comments; Instagram's rose from 5 to 18.
    expect(found[0].numbers[0].now.map((f) => f.value)).toEqual([57]);
    expect(found[1].numbers[0].now.map((f) => f.value)).toEqual([260]);
  });
});

/** A database with one report and its stored posts, recording every write. */
function fakeDb(table: string, row: Record<string, any>, snapshot: unknown = null) {
  const writes: Array<{ table: string; patch: any }> = [];
  const db = {
    from(name: string) {
      let update: any = null;
      const q: any = {
        select: () => q, eq: () => q, lte: () => q, order: () => q, limit: () => q,
        update: (patch: any) => { update = patch; return q; },
        maybeSingle: () => Promise.resolve({ data: name === table ? row : null, error: null }),
        then: (resolve: any) => {
          if (update) { writes.push({ table: name, patch: update }); Object.assign(row, update); return Promise.resolve({ error: null }).then(resolve); }
          if (name === "rivaliq_snapshots") return Promise.resolve({ data: snapshot ? [{ payload: snapshot }] : [], error: null }).then(resolve);
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return q;
    },
  };
  return { db, writes, row };
}

describe("the report_text job", () => {
  const job = (attempts = 1) => ({ id: "j1", client_id: "bader", attempts, max_attempts: 7, payload: { table: "competitive_reports", report_id: "1c4f4805" } });
  const now = () => new Date("2026-10-20T10:00:00Z");
  const row = () => ({ id: "1c4f4805", client_id: "bader", status: "complete", created_at: "2026-10-07T07:15:06Z", date_range_start: "2026-09-01", date_range_end: "2026-09-30", report_data: structuredClone(BADER_REPORT), correction_audit: null, clients: { name: "Bader Law", archived_at: null } });

  it("counts the figures again, rewrites the stale sentences in one call, and keeps the original", async () => {
    const { db, writes, row: stored } = fakeDb("competitive_reports", row(), { socialPosts: BADER_POSTS });
    const complete = vi.fn(async (_system: string, message: string) => {
      const ids = [...message.matchAll(/^(s\d+) \(.*?\): (.*)$/gm)].map((m) => ({ id: m[1], text: m[2] }));
      return JSON.stringify({ sentences: ids.map((s) => ({ id: s.id, text: s.text.replace("28.6%", "0.12%").replace("94 posts", "65 posts").replace("42 posts", "13 posts").replace("0.07%", "1.28%").replace("0.23%", "2.89%").replace("0.14%", "1.62%") })) });
    });
    const outcome = await runReportText(db, job(), { now, complete });
    expect(outcome).toMatchObject({ status: "done", result: { stale_sentences: 7, fields: 7 } });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(writes.map((w) => Object.keys(w.patch).sort().join())).toEqual(["correction_audit,report_data", "correction_audit,report_data"]);
    expect(stored.report_data.ai_analysis.competitor_breakdowns[1].engagement_level).toBe("Engagement rate per post at 1.28% reflects huge audience scale; engagement volume stays high via frequent incident posts.");
    expect(stored.correction_audit.original.ai_analysis.competitor_breakdowns[0].engagement_level).toMatch(/28\.6%/);
    expect(stored.correction_audit.original.client_company.post_count).toBe(94);
    expect(stored.correction_audit.corrections.map((c: any) => c.what)).toEqual(["client_figures", "text"]);
    // Run again: nothing is stale, no model call.
    const again = await runReportText(db, job(), { now, complete });
    expect(again).toMatchObject({ status: "done", result: { stale_sentences: 0 } });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("tries again later, quietly, when the answer adds a number the report does not show", async () => {
    const { db, row: stored } = fakeDb("competitive_reports", row(), { socialPosts: BADER_POSTS });
    const outcome = await runReportText(db, job(2), { now, complete: async () => JSON.stringify({ sentences: [{ id: "s1", text: "Rate at 7.5%." }] }) });
    expect(outcome.status).toBe("queued");
    expect(outcome.available_at).toBe("2026-10-20T11:00:00.000Z");
    expect(stored.report_data.ai_analysis.competitor_breakdowns[0].engagement_level).toMatch(/28\.6%/);
    const last = await runReportText(db, job(7), { now, complete: async () => "{}" });
    expect(last.status).toBe("failed");
  });

  it("skips an archived client's report and an unfinished one", async () => {
    const archived = fakeDb("competitive_reports", { ...row(), clients: { name: "LegaBot", archived_at: "2026-10-12" } });
    expect((await runReportText(archived.db, job(), { now, complete: async () => "" })).status).toBe("skipped");
    const running = fakeDb("competitive_reports", { ...row(), status: "running" });
    expect((await runReportText(running.db, job(), { now, complete: async () => "" })).status).toBe("skipped");
  });
});
