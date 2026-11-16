/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Analytics from "@/pages/Analytics";

// The live tiles word a tiny-base change as two values, name the networks a
// total covers, and the top posts carry views (YouTube) and their picture.

const f = vi.hoisted(() => ({ previewBodies: [] as any[] }));
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
        if (name === "post-preview") { f.previewBodies.push(opts.body); return { data: { previews: {} }, error: null }; }
        return {
          data: {
            profiles: [],
            totals: { impressions: 900, reactions: 19, post_link_clicks: 7, video_views: 50, comments: 0, shares: 0 },
            changes: { reactions: { previous: 1, current: 19, percent: 1800 } },
            previous_range: { start: "2026-01-01", end: "2026-01-02", days: 2 },
            by_profile: [
              { profile_id: "1", name: "Bench Facebook", network: "facebook", impressions: 900, reactions: 10, video_views: 5 },
              { profile_id: "2", name: "Bench YouTube", network: "youtube", impressions: 0, reactions: 9, video_views: 45 },
            ],
            top_posts: [{ permalink: "https://www.youtube.com/watch?v=1", text: "A video", impressions: 0, reach: 5000, network_type: "youtube", thumbnail_url: "https://img.example/1.jpg", media_type: "video" }],
          },
          error: null,
        };
      },
    },
    from: (table: string) => {
      const q: any = {
        select: () => q, eq: () => q, order: () => q, not: () => q, limit: () => q,
        maybeSingle: async () => ({ data: table === "clients" ? { id: "c1", name: "Bench" } : null, error: null }),
        then: (resolve: any, reject: any) => Promise.resolve({
          data: table === "reports" ? [{ id: "r1", status: "completed", created_at: "2025-10-07T07:20:00Z", date_range_start: "2025-09-01", date_range_end: "2025-09-30", report_data: {} }] : [],
          error: null,
        }).then(resolve, reject),
      };
      return q;
    },
  },
}));

let qc: QueryClient;
beforeEach(() => { f.previewBodies = []; });
afterEach(() => { cleanup(); qc?.clear(); });

it("words the change as two values, names the covered networks, calls the By profile figure Video views, and ranks a YouTube post on its views", async () => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/clients/c1/analytics"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes><Route path="/clients/:id/analytics" element={<Analytics />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("from 1 to 19 vs previous period")).toBeInTheDocument();
  expect(screen.queryByText(/1800/)).not.toBeInTheDocument();
  // Impressions and link clicks leave YouTube out; reactions cover both networks.
  expect(screen.getAllByText("Facebook only").length).toBe(2);
  expect(screen.getAllByText("Video views").length).toBeGreaterThan(2);
  expect(screen.queryByText("Views")).not.toBeInTheDocument();
  expect(screen.getByText("5.0K")).toBeInTheDocument();
  await waitFor(() => expect(f.previewBodies.length).toBeGreaterThan(0));
  expect(f.previewBodies[0].posts[0]).toMatchObject({ url: "https://www.youtube.com/watch?v=1", image: "https://img.example/1.jpg", media_type: "video" });
});
