/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// The monthly report run page (RunAnalysis.tsx), QA bug hunt of 22 Nov 2026; mocks after src/test/qa/runProtection.test.tsx.
// P21-03: a scheduled run the page watched finishes; the page says "complete" and opens the OLD manual report.
// P21-04: the client read fails (App's default QueryClient: 3 retries); the page stays "Loading the client" forever.
// P21-05: the social-accounts read fails; "Run monthly report" stays disabled forever.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import RunAnalysis from "@/pages/RunAnalysis";

const f = vi.hoisted(() => ({ running: false, request: null as any, clientFails: 0, profileFails: 0, invokes: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ canRunAnalysis: true }) }));
vi.mock("@/hooks/useRealtimeReport", () => ({ useRealtimeReports: () => {} }));
vi.mock("@/lib/telemetry", () => ({ track: vi.fn() }));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children }: any) => <main>{children}</main> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  functions: { invoke: f.invokes },
  rpc: async () => ({ data: f.request ? [f.request] : [], error: null }),
  from: (table: string) => {
    const filters: any = {}; let one = false;
    const q: any = { select: () => q, eq(k: string, v: any) { filters[k] = v; return q; }, gt: () => q, in: () => q, order: () => q, limit: () => q, maybeSingle() { one = true; return q; },
      then(resolve: any) {
        if (table === "clients" && f.clientFails > 0) { f.clientFails -= 1; return Promise.resolve({ data: null, error: new Error("offline") }).then(resolve); }
        if (table === "sprout_profiles" && f.profileFails > 0) { f.profileFails -= 1; return Promise.resolve({ data: null, error: new Error("offline") }).then(resolve); }
        const running = { id: "scheduled-now", status: "running", created_at: new Date().toISOString(), date_range_start: "2026-10-01", date_range_end: "2026-10-31" };
        const data = table === "clients" ? { id: "client", name: "Fixture", timezone: "UTC" }
          : table === "sprout_profiles" ? [{ id: "profile" }]
          : one ? (filters.status === "running" && f.running ? running : null) : [];
        return Promise.resolve({ data, error: null }).then(resolve);
      } };
    return q;
  },
} }));

function Opened() { const { rid } = useParams(); return <p>Opened report {rid}</p>; }
let qc: QueryClient;
function mount(opts: { retry?: boolean } = {}) {
  qc = new QueryClient({ defaultOptions: { queries: { gcTime: 0, ...(opts.retry ? {} : { retry: false }) } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={["/client"]}><Routes>
    <Route path="/:id" element={<RunAnalysis />} />
    <Route path="/clients/:cid/reports/:rid" element={<Opened />} />
  </Routes></MemoryRouter></QueryClientProvider>);
}
async function tick(ms = 20) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-20T12:00:00Z")); f.running = false; f.request = null; f.clientFails = 0; f.profileFails = 0; f.invokes.mockReset(); });
afterEach(() => { cleanup(); qc?.clear(); vi.useRealTimers(); });

describe("P21 monthly report run page", () => {
  it("P21-03: a scheduled run finishing does not open an older manual report", async () => {
    // A manual run three days ago made report 'old-manual'; now a scheduled run is going.
    f.request = { job_id: "job", status: "done", requested_at: "2026-11-17T09:00:00Z", range_start: "2026-10-01", range_end: "2026-10-31", report_id: "old-manual", open: false, runs: 1, next_at: null };
    f.running = true;
    mount(); await tick(); await tick();
    expect(screen.queryByRole("button", { name: "Run monthly report" })).toBeNull(); // shown as running
    f.running = false; // the scheduled report 'scheduled-now' completes
    await tick(8000); await tick(2000);
    expect(screen.queryByText("Opened report old-manual")).toBeNull();
  });

  it("P21-04: a client read that fails is tried again and the page fills in", async () => {
    f.clientFails = 4; // the first try and App's three retries
    mount({ retry: true });
    await tick(10 * 60_000);
    expect(screen.queryByText(/Loading the client/)).toBeNull();
  });

  it("control: a client read that answers within App's retries fills the page (harness check, passes)", async () => {
    f.clientFails = 3;
    mount({ retry: true });
    await tick(10 * 60_000);
    expect(screen.queryByText(/Loading the client/)).toBeNull();
  });

  it("P21-05: a social-accounts read that fails does not leave the run button disabled forever", async () => {
    f.profileFails = 4;
    mount({ retry: true });
    await tick(10 * 60_000);
    expect(screen.getByRole("button", { name: "Run monthly report" })).not.toBeDisabled();
  });
});
