/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Analytics from "@/pages/Analytics";
import { presetRange } from "@/lib/dateRange";

// The Takeaway box reads the report's top content as a list of strings (how
// the reports store it) and cleans stored dashes on the way out.

const period = presetRange("30d");
const f = vi.hoisted(() => ({ ai: {} as any }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isMoburstStaff: false, canRunAnalysis: false }) }));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children, nav, actions }: any) => <main>{nav}{actions}{children}</main> }));
vi.mock("@/components/reports/ExportPdfButton", () => ({ ExportPdfButton: () => null }));
vi.mock("@/components/competitive/CompetitiveSnapshot", () => ({ CompetitiveSnapshot: () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async () => ({ data: { collected: true, themes: [] }, error: null }),
    functions: { invoke: async () => ({ data: null, error: { context: { status: 422 } } }) },
    from: (table: string) => {
      const q: any = {
        select: () => q, eq: () => q, order: () => q, not: () => q, limit: () => q, in: () => q,
        maybeSingle: async () => ({ data: table === "clients" ? { id: "c1", name: "Bench" } : null, error: null }),
        then: (resolve: any, reject: any) => Promise.resolve({
          data: table === "reports"
            ? [{ id: "r1", status: "completed", created_at: new Date().toISOString(), date_range_start: period.start, date_range_end: period.end, report_data: { sprout_performance: {}, ai_analysis: f.ai } }]
            : [],
          error: null,
        }).then(resolve, reject),
      };
      return q;
    },
  },
}));

afterEach(() => cleanup());
function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/clients/c1/analytics"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes><Route path="/clients/:id/analytics" element={<Analytics />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("shows the second line when top content is a list of strings, without the stored dash", async () => {
  f.ai = { sprout_performance_analysis: { month_over_month_summary: "Reach grew a lot.", top_performing_content: ["Urgent AI-shift videos — performed best", "Second one"] } };
  mount();
  expect(await screen.findByText("Reach grew a lot.")).toBeInTheDocument();
  expect(screen.getByText("Urgent AI-shift videos, performed best")).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/[–—]/);
});

it("still reads a list of objects", async () => {
  f.ai = { sprout_performance_analysis: { month_over_month_summary: "Reach grew.", top_performing_content: [{ insight: "Carousels won." }] } };
  mount();
  expect(await screen.findByText("Carousels won.")).toBeInTheDocument();
});

it("states which report the commentary was written from", async () => {
  f.ai = { sprout_performance_analysis: { month_over_month_summary: "Reach grew.", top_performing_content: [] } };
  mount();
  expect(await screen.findByText(/^Written from the report for /)).toBeInTheDocument();
});
