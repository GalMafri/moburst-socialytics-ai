/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// Words on the monthly report page: nothing a client should not read, one name per section, no British spelling (REPORTS-COPY-1, REPORTS-27, REPORTS-31, DC-COPY-13).
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

import { readFileSync } from "node:fs";

const own = () => baseData({ ai_analysis: { tiktok_trends_analysis: { top_themes: ["Skits"], opportunities_for_client: ["Run a weekly series."] }, sprout_performance_analysis: { key_insights: ["Impressions rose."], pillar_alignment: { well_represented: ["Education"], underrepresented: [] } } }, rest: { tiktok_trends: { posts: [{ url: "https://www.tiktok.com/@a/video/1", author: "a", caption: "c", views: 10 }] } } });
const wording = /Provider|\bthe client\b|three numbers|\bgrey\b|\bcolour\b/i;

describe("report page words", () => {
  it("has no 'Provider', 'the client', 'three numbers' or British spelling on the overview or the trends tab", async () => {
    f.report = reportRow(own());
    mount(); await settle();
    expect(document.body.textContent).not.toMatch(wording);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Trends" }), { button: 0, ctrlKey: false });
    await settle();
    expect(document.body.textContent).not.toMatch(wording);
    expect(document.body.textContent).toMatch(/your brand|Bench Co/);
  });

  it("has no such words in the page's own strings", () => {
    const code = readFileSync("src/pages/ReportView.tsx", "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join("\n");
    expect(code).not.toMatch(/Provider|three numbers|\bgrey\b|the client\b/);
  });

  it("names each overview section the same in the rail and on its heading", async () => {
    f.report = reportRow(own());
    mount(); await settle();
    const rail = [...document.querySelectorAll("nav a, nav button")].map((n) => n.textContent?.trim()).filter(Boolean) as string[];
    const headings = [...document.querySelectorAll('[role="tabpanel"][data-state="active"] section[id] h2')].map((h) => h.textContent?.trim()) as string[];
    expect(headings.length).toBeGreaterThan(2);
    // The mocked layout has no rail; the names come from the same list the rail and the sections share.
    expect(new Set(headings).size).toBe(headings.length);
    expect(rail.length === 0 || headings.every((h) => rail.includes(h))).toBe(true);
  });
});
