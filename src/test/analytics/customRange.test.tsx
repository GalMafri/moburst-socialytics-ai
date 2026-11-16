/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Analytics from "@/pages/Analytics";
import { yesterdayIn } from "@/lib/dateRange";

// A custom range applies only when both dates are there and valid. Clearing a
// field while typing keeps the last window on screen, a long window goes
// through the chunked path, and the end date cannot pass the client's yesterday.

const f = vi.hoisted(() => ({ calls: [] as any[] }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isMoburstStaff: false, canRunAnalysis: false }) }));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children, nav, actions }: any) => <main>{nav}{actions}{children}</main> }));
vi.mock("@/components/reports/ExportPdfButton", () => ({ ExportPdfButton: () => null }));
vi.mock("@/components/competitive/CompetitiveSnapshot", () => ({ CompetitiveSnapshot: () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async () => ({ data: { collected: true, themes: [] }, error: null }),
    functions: {
      invoke: async (name: string, opts: any) => {
        if (name === "post-preview") return { data: { previews: {} }, error: null };
        f.calls.push({ name, body: opts.body });
        return {
          data: {
            profiles: [], totals: { impressions: 1234, reactions: 1, post_link_clicks: 0, video_views: 0, comments: 0, shares: 0 },
            previous_range: { start: "2026-01-01", end: "2026-01-02", days: 2 }, changes: {}, by_profile: [], top_posts: [], daily: [],
          },
          error: null,
        };
      },
    },
    from: (table: string) => {
      const q: any = {
        select: () => q, eq: () => q, order: () => q, not: () => q, limit: () => q,
        maybeSingle: async () => ({ data: table === "clients" ? { id: "c1", name: "Bench", timezone: "America/New_York" } : null, error: null }),
        then: (resolve: any, reject: any) => Promise.resolve({
          data: table === "reports"
            ? [{ id: "r1", status: "completed", created_at: "2026-10-07T07:20:00Z", date_range_start: "2026-09-01", date_range_end: "2026-09-30", report_data: { sprout_performance: { overall_totals: { impressions: 8000, reactions: 80 } } } }]
            : [],
          error: null,
        }).then(resolve, reject),
      };
      return q;
    },
  },
}));

let qc: QueryClient;
beforeEach(() => { f.calls = []; });
afterEach(() => { cleanup(); qc?.clear(); });

async function openCustom() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/clients/c1/analytics"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes><Route path="/clients/:id/analytics" element={<Analytics />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(f.calls.length).toBeGreaterThan(0));
  fireEvent.click(await screen.findByRole("button", { name: "Custom" }));
  return (await screen.findByLabelText("Start date")) as HTMLInputElement;
}
const settle = () => new Promise((r) => setTimeout(r, 60));
const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

it("clearing the start date keeps the last window's figures and never shows the all-time snapshot line", async () => {
  const start = await openCustom();
  await screen.findByText("1.2K");
  const before = f.calls.length;
  fireEvent.change(start, { target: { value: "" } });
  await settle();
  expect(f.calls.length).toBe(before);
  expect(screen.getByText("1.2K")).toBeInTheDocument();
  expect(screen.queryByText(/Latest report snapshot/)).not.toBeInTheDocument();
  // Typing a full date again applies it.
  fireEvent.change(start, { target: { value: addDays(yesterdayIn("America/New_York"), -10) } });
  await waitFor(() => expect(f.calls.length).toBeGreaterThan(before));
});

it("a 400-day range is asked for in two calls", async () => {
  const start = await openCustom();
  await settle();
  const before = f.calls.length;
  const end = yesterdayIn("America/New_York");
  fireEvent.change(start, { target: { value: addDays(end, -399) } });
  await waitFor(() => expect(f.calls.length - before).toBeGreaterThanOrEqual(2));
  await settle();
  const made = f.calls.slice(before);
  expect(made).toHaveLength(2);
  expect(made[0].body.start).toBe(addDays(end, -399));
  expect(made[1].body.end).toBe(end);
});

it("the end date cannot pass the client's yesterday", async () => {
  await openCustom();
  const end = screen.getByLabelText("End date") as HTMLInputElement;
  expect(end.max).toBe(yesterdayIn("America/New_York"));
  const before = f.calls.length;
  fireEvent.change(end, { target: { value: addDays(yesterdayIn("America/New_York"), 5) } });
  await settle();
  expect(f.calls.length).toBe(before);
});
