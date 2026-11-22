/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// P17: All reports, Competitive analyses tab. The page of 50 is cut from raw rows
// (.range(limit - 50, limit)) and only then filtered by listedRuns, which drops runs that did
// not finish and collapses held runs. The monthly tab was fixed for this; the competitive tab
// was not: 50 newest failed runs make page 1 say "No competitive analyses yet" while a ready
// analysis sits on page 2, with a footer saying "1 to 50; more available".
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import AllReports from "@/pages/AllReports";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isMoburstStaff: true, isAdmin: true, user: { _id: "u1" } }) }));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children }: any) => <main>{children}</main> }));
vi.mock("@/components/reports/ReportActions", () => ({ ReportActions: () => null, OpenPresentationButton: () => null }));
vi.mock("@/lib/nextRun", () => ({ useNextRun: () => ({ data: null }) }));
vi.mock("@/lib/strategyOnly", async (orig) => ({ ...(await orig<any>()), useStrategyOnlyClients: () => ({ isLoading: false, ids: new Set<string>(), has: () => false }) }));

const rows = [
  ...Array.from({ length: 50 }, (_, i) => ({ id: `f${i}`, client_id: "c1", status: "failed", created_at: `2026-11-${String(20 - Math.floor(i / 5)).padStart(2, "0")}T0${i % 5}:00:00Z`, date_range_start: "2026-10-01", date_range_end: "2026-10-31", duration_minutes: 1, gamma_url: null, report_data: {}, clients: { id: "c1", name: "Acme" } })),
  { id: "ready1", client_id: "c1", status: "completed", created_at: "2026-10-01T00:00:00Z", date_range_start: "2026-09-01", date_range_end: "2026-09-30", duration_minutes: 5, gamma_url: null, report_data: {}, clients: { id: "c1", name: "Acme" } },
];
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (table: string) => {
    let r: [number, number] = [0, 1000];
    const q: any = { select: () => q, order: () => q, eq: () => q, not: () => q, is: () => q, in: () => q,
      range: (a: number, b: number) => { r = [a, b]; return q; },
      then: (ok: any, fail: any) => Promise.resolve({ data: table === "competitive_reports" ? rows.slice(r[0], r[1] + 1) : [], error: null }).then(ok, fail) };
    return q;
  },
} }));
afterEach(() => cleanup());

it("page 1 of Competitive analyses lists the ready analysis, not 'No competitive analyses yet'", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><AllReports /></MemoryRouter></QueryClientProvider>);
  const tab = await screen.findByRole("tab", { name: /Competitive analyses/ });
  fireEvent.mouseDown(tab); fireEvent.click(tab);
  await screen.findByText(/Competitive analyses 1 to/);
  expect(screen.queryByText("No competitive analyses yet")).toBeNull();
  expect(screen.getByRole("button", { name: /Open report/ })).toBeInTheDocument();
});
