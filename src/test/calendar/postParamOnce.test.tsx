/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// P17: the client calendar's `post` (and `tab`) address values are never cleared. The week
// arrows keep them (goTo copies every param), and the board is remounted per week
// (key={week}), so its "open once" guard (openedRef in ContentIdeasTab) starts empty again:
// going to another week and back opens the same post's panel again by itself.
import React, { useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ClientCalendar from "@/pages/ClientCalendar";

const f = vi.hoisted(() => ({ posts: [] as any[], mounts: [] as Array<{ open: string; tab: string }> }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isMoburstStaff: true, isClient: false }) }));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children }: any) => <main>{children}</main> }));
vi.mock("@/components/calendar/NewPostDialog", () => ({ NewPostDialog: () => null }));
vi.mock("@/components/calendar/WeekPlanControls", () => ({ PlanNextWeekButton: () => null, WeekPlanBand: () => null }));
vi.mock("@/components/calendar/DesignWeekButton", () => ({ DesignWeekBand: () => null }));
// The board as ContentIdeasTab is: it opens `openPostKey` once per mount (openedRef starts null on mount).
vi.mock("@/components/reports/calendar/ContentIdeasTab", () => ({ ContentIdeasTab: (p: any) => {
  useEffect(() => { if (p.openPostKey) f.mounts.push({ open: p.openPostKey, tab: p.openPostTab ?? "" }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div data-testid="board" />;
} }));
vi.mock("@/components/calendar/CalendarHeaderControls", async (orig) => ({ ...(await orig<any>()), ClientPicker: () => null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (table: string) => {
    const q: any = { select: () => q, eq: () => q, order: () => q, range: () => q, is: () => q,
      maybeSingle: async () => ({ data: table === "clients" ? { id: "c1", name: "K", timezone: "UTC", archived_at: null } : null, error: null }),
      then: (ok: any, fail: any) => Promise.resolve({ data: table === "calendar_posts" ? f.posts : [], error: null }).then(ok, fail) };
    return q;
  },
} }));

const post = (id: string, post_date: string) => ({ id, post_key: `k-${id}`, client_id: "c1", post_date, posting_time: "09:00", platform: "LinkedIn", format: "Single image", copy: "x", hashtags: [], created_at: "2026-11-01T00:00:00Z" });
beforeEach(() => { f.posts = [post("p1", "2026-11-04"), post("p2", "2026-11-11")]; f.mounts = []; });
afterEach(() => cleanup());

it("a post opened from a link is not opened again after going to another week and back", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/clients/c1/calendar?week=2026-11-02&post=p1&tab=design"]}>
        <Routes><Route path="/clients/:id/calendar" element={<ClientCalendar />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByTestId("board");
  expect(f.mounts.filter((m) => m.open === "k-p1")).toHaveLength(1); // opened once, from the link
  fireEvent.click(screen.getByRole("button", { name: "Next week" }));
  fireEvent.click(await screen.findByRole("button", { name: "Previous week" }));
  await screen.findByTestId("board");
  // Back on the link's week, the board is mounted again and told to open p1 (Design tab) again.
  expect(f.mounts.filter((m) => m.open === "k-p1")).toHaveLength(1);
});
