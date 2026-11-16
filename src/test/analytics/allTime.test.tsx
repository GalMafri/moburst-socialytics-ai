/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Analytics from "@/pages/Analytics";

// All time adds Sprout windows together. Each call asks for no comparison
// (the page throws the previous period away), and the section rail anchors
// By profile and Top posts the way it does on a preset range.

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
            top_posts: [{ permalink: "https://www.linkedin.com/feed/update/1", text: "A post", impressions: 10, network_type: "linkedin_company" }],
            daily: [],
          },
          error: null,
        };
      },
    },
    from: (table: string) => {
      const q: any = {
        select: () => q, eq: () => q, order: () => q, not: () => q, limit: () => q,
        maybeSingle: async () => ({ data: table === "clients" ? { id: "c1", name: "Bench" } : null, error: null }),
        then: (resolve: any, reject: any) => Promise.resolve({ data: table === "reports" ? [{ id: "r1", status: "completed", created_at: "2026-10-07T07:20:00Z", date_range_start: "2026-09-01", date_range_end: "2026-09-30", report_data: {} }] : [], error: null }).then(resolve, reject),
      };
      return q;
    },
  },
}));

let qc: QueryClient;
beforeEach(() => { f.calls = []; });
afterEach(() => { cleanup(); qc?.clear(); });

it("on All time each Sprout call carries compare false, and the rail lists By profile and Top posts", async () => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/clients/c1/analytics"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes><Route path="/clients/:id/analytics" element={<Analytics />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(f.calls.length).toBeGreaterThan(0));
  fireEvent.click(await screen.findByRole("button", { name: "All time" }));
  expect(await screen.findByText("Bench LinkedIn")).toBeInTheDocument();
  const allTime = f.calls.filter((c) => c.name === "sprout-analytics").slice(1);
  expect(allTime.length).toBeGreaterThan(0);
  for (const c of allTime) expect(c.body.compare).toBe(false);
  expect(document.getElementById("live-by-profile")).not.toBeNull();
  expect(document.getElementById("live-top-posts")).not.toBeNull();
  // The rail drops a link until its section is on the page and reads the page again a frame after it changes, so the links follow the section ids by one frame.
  expect(await screen.findByRole("link", { name: "By profile" })).toBeInTheDocument();
  expect(await screen.findByRole("link", { name: "Top posts" })).toBeInTheDocument();
});
