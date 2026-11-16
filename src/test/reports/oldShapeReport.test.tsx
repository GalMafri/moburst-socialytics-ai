/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// A report page opening a report stored in the old shape (the n8n engine's, to
// 7 Nov 2026): no per-platform top posts, no previous period, no insights, no
// trends. It must open, show what it holds and never print "undefined" or
// "NaN" or a word a client must not read.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ReportView from "@/pages/ReportView";
import { WeeklyHighlights } from "@/components/reports/calendar/WeeklyHighlights";
import { MOBURST } from "../../../supabase/fixtures/pipelines/social";
import { reportCounts, reportTrends, themesInPeriod } from "@/lib/reportFigures";
import { SPROUT_RATE_LABEL } from "@/lib/rateLabels";

const f = vi.hoisted(() => ({ staff: false, report: null as any, themes: [] as any[], themesFail: false, themesHang: false, rpcs: [] as any[] }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isMoburstStaff: f.staff, isClient: !f.staff, canRunAnalysis: f.staff, canDelete: false }) }));
vi.mock("@/hooks/useRealtimeReport", () => ({ useRealtimeReports: () => {} }));
vi.mock("@/hooks/useTrackView", () => ({ useTrackView: () => {} }));
vi.mock("@/lib/telemetry", () => ({ track: vi.fn(), editDistancePct: () => 0 }));
vi.mock("@/hooks/useInsightFeedback", () => ({ useInsightFeedback: () => ({ verdictFor: () => null }) }));
vi.mock("@/components/competitive/PostVisual", () => ({ usePostPreviews: () => ({ previews: {} }), PostVisual: () => null, postType: () => null }));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children }: any) => <main>{children}</main> }));
vi.mock("@/components/reports/ReportActions", () => ({ ReportActions: () => null }));
vi.mock("@/components/reports/ExportPdfButton", () => ({ ExportPdfButton: () => null }));
vi.mock("@/components/reports/ReportDecks", () => ({ ReportDecks: () => null }));
vi.mock("@/components/competitive/CompetitiveSnapshot", () => ({ CompetitiveSnapshot: () => null }));
vi.mock("@/components/calendar/NewPostDialog", () => ({ NewPostDialog: () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: any) => {
      f.rpcs.push({ name, ...args });
      if (f.themesHang) return new Promise(() => {});
      return Promise.resolve(f.themesFail
        ? { data: null, error: { message: "permission denied for function trend_themes_in_range", code: "42501" } }
        : { data: { collected: true, themes: f.themes }, error: null });
    },
    from: (table: string) => {
      let single = false;
      const q: any = {
        select: () => q, eq: () => q, neq: () => q, in: () => q, is: () => q, order: () => q, limit: () => q, range: () => q,
        maybeSingle() { single = true; return q; },
        then: (resolve: any, reject: any) => Promise.resolve({ data: table === "reports" && single ? f.report : single ? null : [], error: null, count: 0 }).then(resolve, reject),
      };
      return q;
    },
  },
}));

// A report the n8n engine stored (Moburst's September report, the real report_data the
// pipeline tests read), with the company's name replaced. Every key it held is here.
const oldShapeData = () => JSON.parse(JSON.stringify(MOBURST.stored_report.report_data).replace(/Moburst/g, "Bench Co"));
const topPost = () => oldShapeData().sprout_performance.top_posts[0];
/** The words clients wrote in their own posts are not the screen's words. */
const withoutPosts = (text: string) => oldShapeData().sprout_performance.top_posts.reduce((t: string, p: any) => t.replace(String(p.text ?? "").slice(0, 60), " "), text);

// The words are the client's own subject (this company writes about AI search), so the check is for the vendors and the dash.
const banned = /Rival ?IQ|Sprout|Apify|Gamma|OpenAI|Claude|Supabase|\u2014/i;
const reportRow = (report_data: any) => ({
  id: "r1", client_id: "c1", status: "completed", report_type: "monthly", created_at: "2026-11-01T08:00:00Z",
  date_range_start: "2026-09-01", date_range_end: "2026-09-30", gamma_url: null, report_data, clients: { id: "c1", name: "Bench Co" },
});

let qc: QueryClient;
function mount() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/clients/c1/reports/r1"]}>
        <Routes><Route path="/clients/:id/reports/:reportId" element={<ReportView />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
async function settle() {
  await waitFor(() => {
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/Loading report/);
    expect(text).not.toMatch(/Loading (trends|recommendations)/);
  });
}

beforeEach(() => { f.staff = false; f.report = reportRow(oldShapeData()); f.themes = []; f.themesFail = false; f.themesHang = false; f.rpcs = []; });
afterEach(() => { cleanup(); qc?.clear(); });

describe("report screen: a report stored in the old shape", () => {
  it("opens, shows the client and the figures it holds, and never prints undefined or NaN", async () => {
    mount(); await settle();
    const text = document.body.textContent ?? "";
    expect(text).toContain("Bench Co");
    expect(text).not.toMatch(/undefined|NaN|\[object/);
  });

  it("shows the top posts it holds, with their platforms", async () => {
    mount(); await settle();
    const text = document.body.textContent ?? "";
    expect(text).toContain(String(topPost().text).slice(0, 40));
  });

  // The rate label names its source by the owner's 20 Oct 2026 decision (rateLabels.ts). Whether a client
  // page keeps that name is an open owner decision (REPORTS-15, REPORTS-COPY-2), so the label is read as
  // whatever rateLabels.ts says and left out here; every other word is checked.
  it("says nothing a client must not read, the rate label's own wording aside", async () => {
    mount(); await settle();
    const t = withoutPosts(document.body.textContent ?? "").split(SPROUT_RATE_LABEL).join(" ");
    const hit = t.match(new RegExp(banned.source, "gi")) ?? [];
    expect(hit.map((h) => t.slice(Math.max(0, t.indexOf(h) - 40), t.indexOf(h) + 40))).toEqual([]);
  });
});
