/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// P17: the live 422s from sprout-analytics. StrategyOnlyGate mounts the Analytics page (hidden)
// while it reads which clients are strategy-only; the page asks sprout-analytics at once, with
// no check of its own, so a strategy-only client's analytics address always sends the call.
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Analytics from "@/pages/Analytics";
import { StrategyOnlyGate } from "@/components/clients/StrategyOnly";

const f = vi.hoisted(() => ({ calls: [] as string[] }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isMoburstStaff: true, user: { _id: "u1" } }) }));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children }: any) => <main>{children}</main> }));
vi.mock("@/components/reports/ExportPdfButton", () => ({ ExportPdfButton: () => null }));
vi.mock("@/components/competitive/CompetitiveSnapshot", () => ({ CompetitiveSnapshot: () => null }));
// The strategy-only read answers after 50 ms: c1 is strategy-only.
vi.mock("@/lib/strategyOnly", async (orig) => ({
  ...(await orig<any>()),
  useStrategyOnlyClients: () => {
    const q = useQuery({ queryKey: ["so"], queryFn: () => new Promise<Set<string>>((r) => setTimeout(() => r(new Set(["c1"])), 50)) });
    return { isLoading: q.isLoading, ids: q.data ?? new Set(), has: (id: string) => !!q.data?.has(id) };
  },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: async () => ({ data: null, error: null }),
  functions: { invoke: async (name: string) => { f.calls.push(name); return { data: null, error: { context: { status: 422 } } }; } },
  from: (table: string) => {
    const q: any = { select: () => q, eq: () => q, order: () => q, not: () => q, limit: () => q, in: () => q, is: () => q,
      maybeSingle: async () => ({ data: table === "clients" ? { id: "c1", name: "Strategy Co" } : null, error: null }),
      then: (ok: any, fail: any) => Promise.resolve({ data: [], error: null }).then(ok, fail) };
    return q;
  },
} }));
afterEach(() => cleanup());

it("a strategy-only client's analytics address does not call sprout-analytics", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/clients/c1/analytics"]}>
        <Routes><Route path="/clients/:id/analytics" element={<StrategyOnlyGate title="Analytics"><Analytics /></StrategyOnlyGate>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // The gate ends on the strategy-only sentence...
  expect(await screen.findByText(/Strategy Co/)).toBeInTheDocument();
  // ...and the hidden page should not have asked Sprout for figures it can never have.
  expect(f.calls.filter((n) => n === "sprout-analytics")).toEqual([]);
});
