/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Analytics from "@/pages/Analytics";
import { presetRange } from "@/lib/dateRange";

// The Trends tab shows the weekly themes of the window the page is showing,
// whether or not the client has monthly reports in it.

const f = vi.hoisted(() => ({
  rpcs: [] as any[],
  report: { id: "r1", status: "completed", created_at: "2026-10-07T07:20:00Z", date_range_start: "2026-09-01", date_range_end: "2026-09-30", report_data: {} },
}));
const report = f.report;
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isMoburstStaff: false, canRunAnalysis: false }) }));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children, nav, actions }: any) => <main>{nav}{actions}{children}</main> }));
vi.mock("@/components/reports/ExportPdfButton", () => ({ ExportPdfButton: () => null }));
vi.mock("@/components/competitive/CompetitiveSnapshot", () => ({ CompetitiveSnapshot: () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string, args: any) => {
      f.rpcs.push({ name, ...args });
      return {
        data: [{ id: "t1", week_start: "2026-10-26", title: "Captain POV skits", happening: "Creators act out the group chat captain.", why_it_matters: "Captains sign teams up.", angle: "Chase RSVPs on camera.", platforms: ["tiktok"], posts: [] }],
        error: null,
      };
    },
    functions: { invoke: async () => ({ data: null, error: { context: { status: 422 } } }) },
    from: (table: string) => {
      const q: any = {
        select: () => q, eq: () => q, order: () => q, not: () => q, limit: () => q,
        maybeSingle: async () => ({ data: table === "clients" ? { id: "c1", name: "Bench" } : null, error: null }),
        then: (resolve: any, reject: any) => Promise.resolve({ data: table === "reports" ? [report] : [], error: null }).then(resolve, reject),
      };
      return q;
    },
  },
}));

let qc: QueryClient;
beforeEach(() => { f.rpcs = []; });
afterEach(() => { cleanup(); qc?.clear(); });

function mount() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/clients/c1/analytics"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes><Route path="/clients/:id/analytics" element={<Analytics />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const openTrends = async () => fireEvent.mouseDown(await screen.findByRole("tab", { name: /Trends/ }), { button: 0 });

it("asks for the weeks inside the period the page is showing, and shows them in the Trends tab", async () => {
  mount();
  await openTrends();
  expect(await screen.findByText("Captain POV skits")).toBeInTheDocument();
  const { start, end } = presetRange("30d");
  expect(f.rpcs[0]).toEqual({ name: "trend_themes_in_range", p_client: "c1", p_from: start, p_to: end });
  // A new period asks again for that period's weeks.
  fireEvent.click(screen.getByRole("button", { name: "7d" }));
  const week = presetRange("7d");
  await waitFor(() => expect(f.rpcs.at(-1)).toEqual({ name: "trend_themes_in_range", p_client: "c1", p_from: week.start, p_to: week.end }));
});

it("asks for every week stored on All time", async () => {
  mount();
  await openTrends();
  await screen.findByText("Captain POV skits");
  fireEvent.click(screen.getByRole("button", { name: "All time" }));
  await waitFor(() => expect(f.rpcs.at(-1)).toMatchObject({ name: "trend_themes_in_range", p_client: "c1", p_from: "2000-01-01" }));
});
