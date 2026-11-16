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
  noReports: false,
  staff: false,
  navigated: [] as string[],
  report: { id: "r1", status: "completed", created_at: "2026-10-07T07:20:00Z", date_range_start: "2026-09-01", date_range_end: "2026-09-30", report_data: {} },
}));
const report = f.report;
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isMoburstStaff: f.staff, canRunAnalysis: false }) }));
vi.mock("react-router-dom", async (orig) => {
  const mod: any = await orig();
  return { ...mod, useNavigate: () => (to: string) => { f.navigated.push(to); } };
});
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children, nav, actions, back }: any) => <main>{back}{nav}{actions}{children}</main> }));
vi.mock("@/components/reports/ExportPdfButton", () => ({ ExportPdfButton: () => null }));
vi.mock("@/components/competitive/CompetitiveSnapshot", () => ({ CompetitiveSnapshot: () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string, args: any) => {
      f.rpcs.push({ name, ...args });
      return {
        data: { collected: true, themes: [{ id: "t1", week_start: "2026-10-26", title: "Captain POV skits", happening: "Creators act out the group chat captain.", why_it_matters: "Captains sign teams up.", angle: "Chase RSVPs on camera.", platforms: ["tiktok"], posts: [] }] },
        error: null,
      };
    },
    functions: { invoke: async () => ({ data: null, error: { context: { status: 422 } } }) },
    from: (table: string) => {
      const q: any = {
        select: () => q, eq: () => q, order: () => q, not: () => q, limit: () => q,
        maybeSingle: async () => ({ data: table === "clients" ? { id: "c1", name: "Bench" } : null, error: null }),
        then: (resolve: any, reject: any) => Promise.resolve({ data: table === "reports" && !f.noReports ? [report] : [], error: null }).then(resolve, reject),
      };
      return q;
    },
  },
}));

let qc: QueryClient;
beforeEach(() => { f.rpcs = []; f.noReports = false; f.staff = false; f.navigated = []; });
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
  fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
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

it("reaches the Trends tab for a client with no report at all on All time, while Performance still says there is no report", async () => {
  // A new self-serve client has trends before its first monthly report.
  f.noReports = true;
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "All time" }));
  expect(await screen.findByText("No reports yet")).toBeInTheDocument();
  expect(screen.queryByText("Report history")).not.toBeInTheDocument();
  await openTrends();
  expect(await screen.findByText("Captain POV skits")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Trend insights" })).toBeInTheDocument();
  expect(f.rpcs.at(-1)).toMatchObject({ name: "trend_themes_in_range", p_client: "c1", p_from: "2000-01-01" });
  // Back on Performance the empty state is what it was.
  fireEvent.mouseDown(screen.getByRole("tab", { name: /Performance/ }), { button: 0 });
  expect(await screen.findByText("No reports yet")).toBeInTheDocument();
  expect(screen.queryByText("Reports analyzed")).not.toBeInTheDocument();
});

it("still shows the Trends tab for a period with no report", async () => {
  f.noReports = true;
  mount();
  await openTrends();
  expect(await screen.findByText("Captain POV skits")).toBeInTheDocument();
});

it("does not show Report history under the Trends or Competitive tabs", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "All time" }));
  await screen.findByRole("heading", { name: /^Report history/ });
  await openTrends();
  await screen.findByText("Captain POV skits");
  // Report history belongs to the Performance panel; the open panel here is Trends.
  const openPanelHistory = () => document.querySelector('[role="tabpanel"][data-state="active"] #history');
  expect(openPanelHistory()).toBeNull();
  expect(screen.queryByRole("link", { name: /^Report history/ })).not.toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole("tab", { name: /Competitive/ }), { button: 0 });
  await waitFor(() => expect(document.querySelector('[role="tabpanel"][data-state="active"]')?.id).toMatch(/competitive/));
  expect(openPanelHistory()).toBeNull();
  expect(screen.queryByRole("link", { name: /^Report history/ })).not.toBeInTheDocument();
});

it("shows no empty Report history card in a window no report overlaps", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Last 7 days" }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: /^Report history/ })).not.toBeInTheDocument());
  expect(screen.queryByText("0 reports")).not.toBeInTheDocument();
});

it("sends a client user back to the dashboard and says so, and staff back to the client", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Back to dashboard" }));
  expect(f.navigated).toEqual(["/"]);
  cleanup();
  f.staff = true;
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Back to client" }));
  expect(f.navigated.at(-1)).toBe("/clients/c1/setup");
});
