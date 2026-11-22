/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// P17: the all-clients calendar's "Go to the week of ..." pointer and archived clients.
// The week list leaves out an archived client's posts (active.has), but the pointer to the
// next planned week (a) only runs when every post of the shown week is strategy-only, and
// (b) does not leave out archived clients' posts. So a week holding only an archived client's
// posts shows "No posts planned" with no way on, and the pointer can land on such a week.
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import CalendarIndex from "@/pages/CalendarIndex";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isMoburstStaff: true, isClient: false, user: null, isGosSession: false }) }));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children }: any) => <main>{children}</main> }));
vi.mock("@/components/calendar/CalendarHeaderControls", () => ({ ALL_CLIENTS: "all", ClientPicker: () => null, WeekNav: () => null }));
vi.mock("@/lib/strategyOnly", async (orig) => ({ ...(await orig<any>()), useStrategyOnlyClients: () => ({ isLoading: false, ids: new Set<string>(), has: () => false }) }));

const t = vi.hoisted(() => ({
  clients: [
    { id: "c1", name: "Live Co", hub_company_name: null, archived_at: null, timezone: "UTC" },
    { id: "c9", name: "Old Co", hub_company_name: null, archived_at: "2026-10-01T00:00:00Z", timezone: "UTC" },
  ] as any[],
  posts: [] as any[],
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: null } }) },
  functions: { invoke: async () => ({ data: {}, error: null }) },
  from: (table: string) => {
    const filters: Array<(r: any) => boolean> = [];
    let lim: number | null = null;
    const q: any = {
      select: () => q, order: () => q, eq: () => q, not: () => q,
      in: (c: string, vs: any[]) => { filters.push((r) => vs.includes(r[c])); return q; },
      is: (c: string, v: any) => { filters.push((r) => (r[c] ?? null) === v); return q; },
      gte: (c: string, v: any) => { filters.push((r) => r[c] >= v); return q; },
      lte: (c: string, v: any) => { filters.push((r) => r[c] <= v); return q; },
      gt: (c: string, v: any) => { filters.push((r) => r[c] > v); return q; },
      limit: (n: number) => { lim = n; return q; },
      range: () => q,
      then: (ok: any, fail: any) => {
        const all = (table === "clients" ? t.clients : table === "calendar_posts" ? t.posts : []).filter((r) => filters.every((fn) => fn(r)));
        const sorted = table === "calendar_posts" ? [...all].sort((a, b) => a.post_date.localeCompare(b.post_date)) : all;
        return Promise.resolve({ data: lim ? sorted.slice(0, lim) : sorted, error: null }).then(ok, fail);
      },
    };
    return q;
  },
} }));

const post = (id: string, client_id: string, post_date: string) => ({ id, post_key: `k-${id}`, client_id, platform: "LinkedIn", format: "image", post_date, posting_time: "09:00", copy: "x", story_of: null, created_at: "2026-10-01T00:00:00Z" });
const mount = (week: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<MemoryRouter initialEntries={[`/calendar?week=${week}`]}><QueryClientProvider client={qc}><CalendarIndex /></QueryClientProvider></MemoryRouter>);
};
beforeEach(() => { t.posts = []; });
afterEach(() => cleanup());

it("a week holding only an archived client's posts still points to the next week with posts", async () => {
  t.posts = [post("old", "c9", "2026-11-04"), post("live", "c1", "2026-11-18")];
  mount("2026-11-02");
  expect(await screen.findByText("No posts planned for this week")).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: /Go to the week of Nov 16/ }, { timeout: 500 })).toBeInTheDocument();
});

it("the pointer skips a week that holds only an archived client's posts", async () => {
  t.posts = [post("old", "c9", "2026-11-11"), post("live", "c1", "2026-11-25")];
  mount("2026-11-02");
  expect(await screen.findByText("No posts planned for this week")).toBeInTheDocument();
  const go = await screen.findByRole("button", { name: /Go to the week of/ });
  expect(go).toHaveTextContent("Go to the week of Nov 23");
});
