/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// P17: Analytics "All time" for a client with live Sprout figures but no monthly report yet.
// Hypothesis: the page fetches the all-time live figures (a year of Sprout data, with the
// 365-day fallback start written for exactly this case) and then never shows them, because
// the "No reports yet" branch (filtered.length === 0 && !viewWindow) wins first.
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Analytics from "@/pages/Analytics";

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
            client: { id: "c1", name: "Bench" }, profiles: [{ id: "1", name: "Bench LinkedIn", network: "linkedin_company" }],
            totals: { impressions: 10, reactions: 1, post_link_clicks: 0, video_views: 0, comments: 0, shares: 0 },
            by_profile: [{ profile_id: "1", name: "Bench LinkedIn", network: "linkedin_company", impressions: 10, reactions: 1, post_link_clicks: 0, video_views: 0, comments: 0, shares: 0 }],
            top_posts: [], daily: [],
          },
          error: null,
        };
      },
    },
    from: (table: string) => {
      const q: any = {
        select: () => q, eq: () => q, order: () => q, not: () => q, limit: () => q, in: () => q, is: () => q,
        maybeSingle: async () => ({ data: table === "clients" ? { id: "c1", name: "Bench" } : null, error: null }),
        // No completed monthly report yet (a client in its first month).
        then: (resolve: any, reject: any) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
      };
      return q;
    },
  },
}));

let qc: QueryClient;
beforeEach(() => { f.calls = []; });
afterEach(() => { cleanup(); qc?.clear(); });

it("All time shows the live figures it fetched for a client with no monthly report yet", async () => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/clients/c1/analytics"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes><Route path="/clients/:id/analytics" element={<Analytics />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // Last 30 days (the default) shows the live figures.
  expect(await screen.findByText("Bench LinkedIn")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "All time" }));
  // The page asks Sprout for All time (compare: false is the all-time path)...
  await waitFor(() => expect(f.calls.some((c) => c.name === "sprout-analytics" && c.body.compare === false)).toBe(true));
  // ...so the figures it fetched should be on screen, not "No reports yet".
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByText("No reports yet")).toBeNull();
  expect(screen.getByText("Bench LinkedIn")).toBeInTheDocument();
});
