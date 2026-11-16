/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Analytics from "@/pages/Analytics";
import { ConnectedProfiles } from "@/components/analytics/ConnectedProfiles";

// Connected profiles are the client's active profiles, named, in every window.

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
            // A report from long ago: no 7-day or 30-day window overlaps it.
            ? [{ id: "r1", status: "completed", created_at: "2025-10-07T07:20:00Z", date_range_start: "2025-09-01", date_range_end: "2025-09-30", report_data: {} }]
            : table === "sprout_profiles"
              ? [{ id: "p1", profile_name: "Kitcaster official", native_name: "kitcaster", network_type: "fb_instagram_account", is_active: true }]
              : [],
          error: null,
        }).then(resolve, reject),
      };
      return q;
    },
  },
}));

afterEach(() => cleanup());

it("shows the client's active profile by name in a window no report overlaps, and counts it as 1 profile", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/clients/c1/analytics"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes><Route path="/clients/:id/analytics" element={<Analytics />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Kitcaster official")).toBeInTheDocument();
  expect(screen.getByText("Connected profiles")).toBeInTheDocument();
  expect(screen.getByText("(1 profile)")).toBeInTheDocument();
  expect(screen.queryByText(/1 profiles/)).not.toBeInTheDocument();
});

it("counts several profiles in the plural", () => {
  render(<ConnectedProfiles profiles={[{ name: "A", network: "facebook" }, { name: "B", network: "instagram" }]} />);
  expect(screen.getByText("(2 profiles)")).toBeInTheDocument();
});
