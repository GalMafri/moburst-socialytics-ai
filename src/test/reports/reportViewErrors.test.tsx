/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// A report read that did not answer is tried again quietly, never "not available"; a theme read that does not answer does not hold the trends for good (REPORTS-09, DC-19).
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
      const q: any = {
        select: () => q, neq: () => q, in: () => q, is: () => q, order: () => q, limit: () => q, range: () => q,
        eq: (col: string, val: unknown) => { f.eqs.push([table, col, val]); return q; },
        maybeSingle() { single = true; return q; },
        then: (resolve: any, reject: any) => {
          if (table === "reports" && single) {
            f.reportReads += 1;
            if (f.reportFail) return Promise.resolve({ data: null, error: { message: "network down" } }).then(resolve, reject);
          }
          const data = table === "reports" && single ? f.report : table === "competitive_reports" ? f.competitive : single ? null : [];
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

async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

describe("report screen when a read does not answer", () => {
  it("keeps loading, says nothing failed, has a page title, and shows the report once a try answers", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    f.reportFail = true;
    mount();
    await tick(100);
    expect(document.body.textContent).not.toMatch(/not available|could not|failed|try again|network down/i);
    expect(screen.getByText(/Loading report/)).toBeInTheDocument();
    expect(f.titles.every((t) => !!t)).toBe(true);
    f.reportFail = false;
    await tick(3200);
    expect(f.reportReads).toBeGreaterThan(1);
    expect(screen.getByRole("heading", { level: 1, name: /Bench Co/ })).toBeInTheDocument();
    warn.mockRestore();
  });

  it("shows the report's own trends when the stored themes do not answer within the wait", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    f.themesHang = true;
    f.report = reportRow(baseData({ ai_analysis: { tiktok_trends_analysis: { overview: "TikTok overview from the report run." } } }));
    mount();
    await tick(200);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Trends" }), { button: 0, ctrlKey: false });
    await tick(200);
    expect(document.body.textContent).toMatch(/Loading trends/);
    await tick(20_000);
    expect(document.body.textContent).not.toMatch(/Loading trends/);
    expect(screen.getByText("TikTok overview from the report run.")).toBeInTheDocument();
    warn.mockRestore();
  });
});
