/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// The monthly report's "Where to act next" cards (ReportView.tsx), QA bug hunt of 22 Nov 2026.
// P21-01: "See the pillar detail" does nothing when the recommendation comes from the report's
//         insights row and the stored analysis has no pillar_alignment (no #report-pillars on the page).
// P21-07: "Plan a post from this" defaults its date to today in UTC, not the client's today.
// P21-02: "Plan a post from this" pre-fills the idea of the card that was there before the
//         recommendations re-read (NewPostDialog keeps its first initialIdea; cards are keyed by index).
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ReportView from "@/pages/ReportView";

const f = vi.hoisted(() => ({ staff: false, report: null as any, insights: null as any }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isMoburstStaff: f.staff, isClient: !f.staff, canRunAnalysis: f.staff, canDelete: false }) }));
vi.mock("@/hooks/useRealtimeReport", () => ({ useRealtimeReports: () => {} }));
vi.mock("@/hooks/useTrackView", () => ({ useTrackView: () => {} }));
vi.mock("@/lib/telemetry", () => ({ track: vi.fn(), editDistancePct: () => 0 }));
vi.mock("@/hooks/useInsightFeedback", () => ({ useInsightFeedback: () => ({ verdictFor: () => null }) }));
vi.mock("@/hooks/useReportInsights", () => ({ useReportInsights: () => ({ data: f.insights }) }));
vi.mock("@/components/competitive/PostVisual", () => ({ usePostPreviews: () => ({ previews: {} }), PostVisual: () => null, postType: () => null }));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children }: any) => <main>{children}</main> }));
vi.mock("@/components/reports/ReportActions", () => ({ ReportActions: () => null }));
vi.mock("@/components/reports/ExportPdfButton", () => ({ ExportPdfButton: () => null }));
vi.mock("@/components/reports/ReportDecks", () => ({ ReportDecks: () => null }));
vi.mock("@/components/competitive/CompetitiveSnapshot", () => ({ CompetitiveSnapshot: () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: { collected: true, themes: [] }, error: null }),
    functions: { invoke: vi.fn() },
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: (table: string) => {
      let single = false;
      const q: any = {
        select: () => q, neq: () => q, in: () => q, is: () => q, order: () => q, limit: () => q, range: () => q, eq: () => q, not: () => q, ilike: () => q,
        maybeSingle() { single = true; return q; },
        then: (resolve: any, reject: any) => Promise.resolve({ data: table === "reports" && single ? f.report : single ? null : [], error: null }).then(resolve, reject),
      };
      return q;
    },
  },
}));

const report = (ai_analysis: any) => ({
  id: "r1", client_id: "c1", status: "completed", report_type: "monthly", created_at: "2026-11-01T08:00:00Z",
  date_range_start: "2026-10-01", date_range_end: "2026-10-31", gamma_url: null,
  report_data: { sprout_performance: {}, ai_analysis }, clients: { id: "c1", name: "Bench Co", timezone: "UTC" },
});
const insightsWith = (recs: string[]) => ({ report_id: "r1", facts: [], confirmed_at: "2026-11-01", fields: { kind: "social", summary: null, insights: [], recommendations: recs.map((text) => ({ text, facts: [] })) } });

let qc: QueryClient;
const tree = () => (
  <QueryClientProvider client={qc}>
    <MemoryRouter initialEntries={["/clients/c1/reports/r1"]}>
      <Routes><Route path="/clients/:id/reports/:reportId" element={<ReportView />} /></Routes>
    </MemoryRouter>
  </QueryClientProvider>
);
beforeEach(() => { qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); f.staff = false; f.insights = null; });
afterEach(() => { cleanup(); qc.clear(); });

describe("P21 report action cards", () => {
  it("P21-01: 'See the pillar detail' scrolls to the pillar detail it names", async () => {
    const scroll = vi.fn();
    (Element.prototype as any).scrollIntoView = scroll;
    f.report = report({ summary_only: true }); // the stored analysis has no pillar_alignment
    f.insights = insightsWith(["Post two carousels a week on the product guide"]);
    render(tree());
    const open = await screen.findByText("See the pillar detail");
    fireEvent.click(open);
    expect(scroll).toHaveBeenCalled();
  });

  it("P21-02: 'Plan a post from this' starts from the card's own recommendation", async () => {
    f.staff = true;
    f.report = report({ sprout_performance_analysis: { pillar_alignment: { well_represented: ["Education"], recommendations: ["Old model-written rec"] } } });
    const view = render(tree());
    await screen.findByText("Old model-written rec", { selector: "p" });
    // The report's insights row is read (a separate query) and replaces the recommendation.
    f.insights = insightsWith(["New insight rec"]);
    view.rerender(tree());
    await screen.findByText("New insight rec", { selector: "p" });
    fireEvent.click(screen.getByRole("button", { name: /Plan a post from this/ }));
    const idea = (await screen.findByLabelText("Idea")) as HTMLTextAreaElement;
    await waitFor(() => expect(idea.value).toBe("New insight rec"));
  });

  it("P21-07: 'Plan a post from this' defaults to the client's today", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T23:30:00Z")); // 21 Nov 12:30 in Auckland
    try {
      f.staff = true;
      f.report = { ...report({ sprout_performance_analysis: { pillar_alignment: { recommendations: ["A rec"] } } }), clients: { id: "c1", name: "Bench Co", timezone: "Pacific/Auckland" } };
      render(tree());
      fireEvent.click(await screen.findByRole("button", { name: /Plan a post from this/ }));
      const date = (await screen.findByLabelText("Date")) as HTMLInputElement;
      expect(date.value).toBe("2026-11-21");
    } finally { vi.useRealTimers(); }
  });
});
