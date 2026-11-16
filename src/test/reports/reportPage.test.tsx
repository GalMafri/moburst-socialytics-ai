/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// The monthly report page: figures on tiny bases, the report's own client id and the client time zone, one preview call per link set (LIVE-05, REPORTS-12, REPORTS-19, REPORTS-26, REPORTS-32).
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ReportView from "@/pages/ReportView";

const f = vi.hoisted(() => ({
  staff: false, report: null as any, themes: [] as any[], themesHang: false, reportFail: false, reportReads: 0,
  eqs: [] as [string, string, unknown][], previewCalls: [] as any[][], titles: [] as unknown[], competitive: [] as any[],
}));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isMoburstStaff: f.staff, isClient: !f.staff, canRunAnalysis: f.staff, canDelete: false }) }));
vi.mock("@/hooks/useRealtimeReport", () => ({ useRealtimeReports: () => {} }));
vi.mock("@/hooks/useTrackView", () => ({ useTrackView: () => {} }));
vi.mock("@/lib/telemetry", () => ({ track: vi.fn(), editDistancePct: () => 0 }));
vi.mock("@/hooks/useInsightFeedback", () => ({ useInsightFeedback: () => ({ verdictFor: () => null }) }));
vi.mock("@/components/competitive/PostVisual", () => ({ usePostPreviews: (urls: any[]) => { f.previewCalls.push(urls); return { previews: {} }; }, PostVisual: () => null, postType: () => null }));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children, title }: any) => { f.titles.push(title); return <main>{children}</main>; } }));
vi.mock("@/components/reports/ReportActions", () => ({ ReportActions: () => null }));
vi.mock("@/components/reports/ExportPdfButton", () => ({ ExportPdfButton: () => null }));
vi.mock("@/components/reports/ReportDecks", () => ({ ReportDecks: () => null }));
vi.mock("@/components/competitive/CompetitiveSnapshot", () => ({ CompetitiveSnapshot: () => null }));
vi.mock("@/components/calendar/NewPostDialog", () => ({ NewPostDialog: () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: () => (f.themesHang ? new Promise(() => {}) : Promise.resolve({ data: { collected: true, themes: f.themes }, error: null })),
    from: (table: string) => {
      let single = false;
      let win: [number, number] | null = null;
      const q: any = {
        select: () => q, neq: () => q, in: () => q, is: () => q, order: () => q,
        limit: (n: number) => { win = [0, n - 1]; return q; },
        range: (from: number, to: number) => { win = [from, to]; return q; },
        eq: (col: string, val: unknown) => { f.eqs.push([table, col, val]); return q; },
        maybeSingle() { single = true; return q; },
        then: (resolve: any, reject: any) => {
          if (table === "reports" && single) {
            f.reportReads += 1;
            if (f.reportFail) return Promise.resolve({ data: null, error: { message: "network down" } }).then(resolve, reject);
          }
          const rows = table === "competitive_reports" && win ? f.competitive.slice(win[0], win[1] + 1) : f.competitive;
          const data = table === "reports" && single ? f.report : table === "competitive_reports" ? rows : single ? null : [];
          return Promise.resolve({ data, error: null, count: 0 }).then(resolve, reject);
        },
      };
      return q;
    },
  },
}));

const change = (previous: number, current: number) => ({ previous, current, percent: previous > 0 ? ((current - previous) / previous) * 100 : null });
const reportRow = (report_data: any, over: Record<string, unknown> = {}) => ({
  id: "r1", client_id: "c1", status: "completed", report_type: "monthly", created_at: "2026-11-01T08:00:00Z",
  date_range_start: "2026-10-01", date_range_end: "2026-10-31", gamma_url: null, report_data, clients: { id: "c1", name: "Bench Co", timezone: "Pacific/Auckland" }, ...over,
});
const mkPost = (over: Record<string, unknown> = {}) => ({
  permalink: "https://example.com/p/1", url: "https://example.com/p/1", text: "A post", network_type: "LINKEDIN", platform: "LINKEDIN", platform_display: "LinkedIn",
  impressions: 1000, reactions: 50, comments: 5, shares: 2, engagements: 57, posted_at: "2026-10-12T10:00:00Z", ...over,
});
/** A stored report with the sections a small account has: figures, platforms and posts. */
const baseData = (over: Record<string, any> = {}) => ({
  sprout_performance: {
    month_comparison: {
      changes: { impressions: change(10000, 14000), reactions: change(500, 520), comments: change(1, 0), shares: change(1, 19) },
      current_month: { impressions: 14000, reactions: 520, comments: 0, shares: 19 },
      previous_month: { impressions: 10000, reactions: 500, comments: 1, shares: 1 },
    },
    platform_breakdown: [{ network: "LINKEDIN", current: { impressions: 14000, reactions: 520 }, previous: null, changes: null, post_count: 4, profile_names: [] }],
    top_posts: [mkPost()],
    ...(over.sprout_performance || {}),
  },
  ai_analysis: over.ai_analysis ?? {},
  data_counts: over.data_counts,
  ...(over.rest || {}),
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
    expect(text).not.toMatch(/Loading (report|trends|recommendations)/);
  });
}
beforeEach(() => { f.staff = false; f.report = reportRow(baseData()); f.themes = []; f.themesHang = false; f.reportFail = false; f.reportReads = 0; f.eqs = []; f.previewCalls = []; f.titles = []; f.competitive = []; });
afterEach(() => { cleanup(); qc?.clear(); vi.useRealTimers(); });

describe("report page figures", () => {
  it("shows 'from 1 to 19' for shares on a base of 1, never a percent of 1800", async () => {
    mount(); await settle();
    expect(screen.getAllByText(/from 1 to 19/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/1,?800\s?%/);
  });

  it("makes impressions the biggest move, and counts the metrics it lists", async () => {
    f.report = reportRow(baseData({ ai_analysis: { sprout_performance_analysis: { key_insights: ["Impressions rose."] } } }));
    mount(); await settle();
    expect(screen.getByText("Biggest move").parentElement?.textContent).toMatch(/\+40%.*Impressions/);
    expect(document.body.textContent).toMatch(/of 4 metrics rose/);
  });
});

describe("report page reads", () => {
  it("reads the competitive analysis with the report's own client id", async () => {
    f.report = reportRow(baseData(), { client_id: "c9" });
    mount(); await settle();
    const competitive = f.eqs.filter(([t, c]) => t === "competitive_reports" && c === "client_id");
    expect(competitive.length).toBeGreaterThan(0);
    for (const [, , v] of competitive) expect(v).toBe("c9");
  });

  // A run of held analyses in front of the ready one must not hide it: the page reads the same way every other competitive screen does.
  it("includes the newest ready competitive analysis behind a long run of newer held ones", async () => {
    const held = (i: number) => ({ id: `h${i}`, created_at: `2026-11-${String(20 - i).padStart(2, "0")}T00:00:00Z`, report_data: { provider_status: 0, aggregates: { companies: [] } } });
    f.competitive = [...Array.from({ length: 14 }, (_, i) => held(i)), { id: "ready", created_at: "2026-10-01T00:00:00Z", report_data: { aggregates: { companies: [] } } }];
    f.report = reportRow(baseData({ data_counts: { sprout_top_posts: 4 } }));
    mount(); await settle();
    await waitFor(() => expect(document.body.textContent).toMatch(/Latest competitive analysis included/));
  });

  it("makes one post-preview call per link set, none for a hidden overview", async () => {
    f.report = reportRow(baseData({ sprout_performance: { top_posts: Array.from({ length: 8 }, (_, i) => mkPost({ permalink: `https://x.test/${i}`, url: `https://x.test/${i}`, impressions: 100 + i, engagements: 5 + i })) } }));
    mount(); await settle();
    expect(f.previewCalls.length).toBeGreaterThan(0);
    for (const urls of f.previewCalls) expect(urls).toHaveLength(12);
  });

  it("dates 'Generated' in the client's time zone", async () => {
    f.report = reportRow(baseData(), { created_at: "2026-11-01T20:00:00Z" });
    mount(); await settle();
    expect(document.body.textContent).toMatch(/Generated Nov 2, 2026/);
  });
});
