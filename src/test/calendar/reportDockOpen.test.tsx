/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// QA 22 Nov 2026 (P08-02): On a report's Content ideas tab (mode "report"), the design dock
// lists every design the person asked for on the client (Calendar posts too),
// but ReportView passes no onOpenElsewhere. Open on a card whose post is not on
// this report's board calls openDesignsFor -> post not found ->
// onOpenElsewhere?.() -> undefined: the click does nothing.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ContentIdeasTab } from "@/components/reports/calendar/ContentIdeasTab";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isMoburstStaff: true, isClient: false }) }));
vi.mock("@/components/reports/calendar/WeeklyHighlights", () => ({ WeeklyHighlights: () => null }));
vi.mock("@/components/calendar/NewPostDialog", () => ({ NewPostDialog: () => null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: "me" } } } }), getUser: async () => ({ data: { user: { id: "me" } } }) },
  functions: { invoke: async () => ({ data: {}, error: null }) },
  from: (table: string) => {
    const rows = table === "design_requests" ? [{
      id: "r1", client_id: "c1", calendar_post_key: "calendar:post-on-the-calendar-tab", platform: "Instagram", post_copy: "A Calendar post", status: "preparing", stage: "designing", kind: "single",
      options_wanted: 1, options_ready: 0, requested_by: "me", error: null, batch_id: null, created_at: "2026-11-03T10:00:00Z", updated_at: "2026-11-03T10:05:00Z", started_at: "2026-11-03T10:00:00Z",
    }] : [];
    const q: any = { select: () => q, eq: () => q, neq: () => q, in: () => q, is: () => q, order: () => q, limit: () => q, gte: () => q,
      maybeSingle: async () => ({ data: table === "calendar_posts" ? { id: "cp1", post_date: "2026-11-05" } : null, error: null }), then: (ok: any) => Promise.resolve({ data: rows, error: null }).then(ok) };
    return q;
  },
} }));
afterEach(cleanup);

describe("P08-02 report tab: Open on a design progress card", () => {
  it("takes the person to the post on the Calendar, on its Design tab", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const week = [{ day: "Monday", date_label: "Oct 6", posts: [{ platform: "Instagram", copy: "A legacy report post", format: "Single Image" }] }];
    function Where() { const l = useLocation(); return <output data-testid="where">{l.pathname + l.search}</output>; }
    render(<MemoryRouter initialEntries={["/clients/c1/reports/rep1"]}><QueryClientProvider client={qc}>
      <Routes><Route path="*" element={<ContentIdeasTab contentCalendar={week} aiAnalysis={null} sproutPerformance={null} clientId="c1" reportId="rep1" availablePlatforms={["Instagram"]} availableLanguages={["en"]} />} /></Routes>
      <Where />
    </QueryClientProvider></MemoryRouter>);
    const card = (await screen.findByText(/Preparing your/)).closest('[role="status"]') as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: /Open/ }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/clients/c1/calendar?week=2026-11-02&post=cp1&tab=design"));
  });
});
