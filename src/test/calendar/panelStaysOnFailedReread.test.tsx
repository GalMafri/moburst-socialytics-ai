/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// QA 22 Nov 2026 (P08-06): with a post's panel open, one re-read of the
// board's designs that ended in an error closed the panel (and the edit in
// it) and swapped the board for "Loading the calendar". The designs already
// read are still there, so the panel and the board stay; only a board that
// never read its designs waits on the read.
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ContentIdeasTab } from "@/components/reports/calendar/ContentIdeasTab";

const f = vi.hoisted(() => ({ fail: false }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/telemetry", () => ({ track: vi.fn(), editDistancePct: () => 0 }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isMoburstStaff: true, isClient: false }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: "me" } } } }), getUser: async () => ({ data: { user: { id: "me" } } }) },
  functions: { invoke: async () => ({ data: {}, error: null }) },
  from: (table: string) => {
    const q: any = { select: () => q, eq: () => q, neq: () => q, in: () => q, is: () => q, order: () => q, limit: () => q, gte: () => q,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (ok: any, bad: any) => Promise.resolve(table === "post_iterations" && f.fail ? { data: null, error: { message: "Failed to fetch" } } : { data: [], error: null }).then(ok, bad) };
    return q;
  },
} }));
afterEach(() => { cleanup(); f.fail = false; });

it("keeps the post's panel and the board when a re-read of the designs fails", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const week = [{ day: "Monday", date_label: "Nov 9", posts: [{ _calendarPostKey: "a", platform: "Instagram", copy: "Monday on Instagram", format: "Single Image" }] }];
  render(<QueryClientProvider client={qc}><ContentIdeasTab mode="calendar" contentCalendar={week} aiAnalysis={null} sproutPerformance={null} clientId="c1" availablePlatforms={["Instagram"]} availableLanguages={["en"]} /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /^Open post: Monday on Instagram/ }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  f.fail = true;
  await act(async () => { await qc.refetchQueries({ queryKey: ["post-iterations", "c1"] }); });
  expect(qc.getQueryState(["post-iterations", "c1"])?.status).toBe("error");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.queryByText("Loading the calendar")).toBeNull();
});
