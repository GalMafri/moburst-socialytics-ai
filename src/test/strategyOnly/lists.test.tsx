/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles of the database and the session. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CalendarIndex from "@/pages/CalendarIndex";
import AnalyticsIndex from "@/pages/AnalyticsIndex";
import AllReports from "@/pages/AllReports";
import CompetitiveIndex from "@/pages/CompetitiveIndex";

// The all-clients lists for a strategy-only client (no active account in
// Sprout): its posts and reports are not shown, and its row says so in a few
// words. Everything it already has stays stored; nothing is deleted. A client
// with an account is listed as it always was.

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
const w = vi.hoisted(() => ({
  only: ["c2"] as string[],
  /** Each read's table with the filters it was given. */
  reads: [] as Array<{ table: string; not: Array<[string, string, string]>; eq: Array<[string, unknown]> }>,
  tables: {} as Record<string, any[]>,
}));
const who = vi.hoisted(() => ({ client: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isLoading: false, isAuthenticated: true, isMoburstStaff: !who.client, isClient: who.client, isGosSession: true, canRunAnalysis: !who.client, user: { _id: who.client ? "client-user-1" : "staff-1", company: null } }) }));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children, actions }: any) => <main>{actions}{children}</main> }));
vi.mock("@/components/calendar/CalendarHeaderControls", () => ({ ALL_CLIENTS: "all", ClientPicker: () => null, WeekNav: () => null }));
vi.mock("@/lib/telemetry", () => ({ track: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: async (name: string) => ({ data: name === "strategy_only_clients" ? w.only : null, error: null }),
  storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://files.test/${p}` } }) }) },
  from: (table: string) => {
    const read = { table, not: [] as Array<[string, string, string]>, eq: [] as Array<[string, unknown]> };
    let range: [number, number] | null = null;
    const q: any = {
      select: () => q, is: () => q, in: () => q, gt: () => q, gte: () => q, lte: () => q, order: () => q, limit: () => q, neq: () => q,
      eq: (c: string, v: unknown) => { read.eq.push([c, v]); return q; },
      not: (c: string, op: string, v: string) => { read.not.push([c, op, v]); return q; },
      range: (a: number, b: number) => { range = [a, b]; return q; },
      maybeSingle: async () => ({ data: null, error: null }),
      then: (ok: any) => {
        w.reads.push(read);
        // The fake applies the "not in" filter, as the database does.
        const hidden = read.not.filter(([c, op]) => c === "client_id" && op === "in").flatMap(([, , v]) => v.replace(/[()]/g, "").split(","));
        const rows = (w.tables[table] ?? []).filter((r) => !hidden.includes(r.client_id));
        return Promise.resolve({ data: range ? rows.slice(range[0], range[1] + 1) : rows, error: null }).then(ok);
      },
    };
    return q;
  },
} }));

const mount = (node: React.ReactNode, path = "/") => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><MemoryRouter initialEntries={[path]}>{node}</MemoryRouter></QueryClientProvider>,
);
const report = (id: string, client: string, name: string) => ({ id, client_id: client, status: "completed", created_at: "2026-11-07T08:00:00Z", date_range_start: "2026-10-01", date_range_end: "2026-10-31", gamma_url: null, clients: { id: client, name } });
beforeEach(() => {
  w.only = ["c2"];
  who.client = false;
  w.reads = [];
  w.tables = {
    clients: [
      { id: "c1", name: "Pine Street Labs", hub_company_name: null, archived_at: null, timezone: "UTC", logo_url: null },
      { id: "c2", name: "Harbor Lane", hub_company_name: null, archived_at: null, timezone: "UTC", logo_url: null },
    ],
    calendar_posts: [
      { id: "p1", post_key: "post:p1", client_id: "c1", platform: "LinkedIn", format: "image", post_date: "2026-11-05", posting_time: "18:00", copy: "A post of the client in Sprout", story_of: null, created_at: "2026-11-01T00:00:00Z" },
      { id: "p2", post_key: "post:p2", client_id: "c2", platform: "LinkedIn", format: "image", post_date: "2026-11-05", posting_time: "18:00", copy: "A post planned before", story_of: null, created_at: "2026-11-01T00:00:00Z" },
    ],
    reports: [report("r1", "c1", "Pine Street Labs"), report("r2", "c2", "Harbor Lane")],
    competitive_reports: [
      { id: "k1", client_id: "c1", status: "complete", created_at: "2026-11-07T09:00:00Z", date_range_start: "2026-10-01", date_range_end: "2026-10-31", report_data: {}, clients: { id: "c1", name: "Pine Street Labs" } },
      { id: "k2", client_id: "c2", status: "complete", created_at: "2026-11-07T09:00:00Z", date_range_start: "2026-10-01", date_range_end: "2026-10-31", report_data: {}, clients: { id: "c2", name: "Harbor Lane" } },
    ],
    competitor_sets: [
      { id: "s1", client_id: "c1", status: "complete", created_at: "2026-10-01T00:00:00Z", rivaliq_landscape_id: "11" },
      { id: "s2", client_id: "c2", status: "complete", created_at: "2026-10-01T00:00:00Z", rivaliq_landscape_id: "22" },
    ],
  };
});
afterEach(() => cleanup());

const SHORT = "Strategy only until its social accounts are connected in Sprout.";

describe("the all-clients Calendar", () => {
  it("leaves a strategy-only client's posts off the week, and names it in one line that leads to its strategy", async () => {
    mount(<CalendarIndex />, "/calendar?week=2026-11-02");
    expect(await screen.findByRole("button", { name: /Pine Street Labs/ })).toBeInTheDocument();
    expect(screen.queryByText(/A post planned before/)).not.toBeInTheDocument();
    const row = screen.getByRole("link", { name: "Harbor Lane" });
    expect(row).toHaveAttribute("href", "/clients/c2/strategy");
    expect(row.closest("li")).toHaveTextContent(`Harbor Lane: ${SHORT}`);
    // The post is still stored: it was read, and only left off the screen.
    expect(w.tables.calendar_posts).toHaveLength(2);
  });

  it("shows the same client's posts again once it has an account, and no line", async () => {
    w.only = [];
    mount(<CalendarIndex />, "/calendar?week=2026-11-02");
    expect(await screen.findByRole("button", { name: /Harbor Lane/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pine Street Labs/ })).toBeInTheDocument();
    expect(screen.queryByText(SHORT, { exact: false })).not.toBeInTheDocument();
  });
});

describe("the all-clients Analytics", () => {
  it("says strategy only on that client's card in place of View analytics, and leaves the other card as it was", async () => {
    mount(<AnalyticsIndex />);
    const closed = await screen.findByRole("button", { name: "Harbor Lane: strategy only" });
    expect(closed).toHaveTextContent(SHORT);
    expect(closed).not.toHaveTextContent("View analytics");
    expect(screen.getByRole("button", { name: "View analytics for Pine Street Labs" })).toHaveTextContent("View analytics");
  });
});

describe("the Analytics tab for a client's own user", () => {
  it("says strategy only on that client's card without the word Sprout", async () => {
    who.client = true;
    mount(<AnalyticsIndex />);
    const closed = await screen.findByRole("button", { name: "Harbor Lane: strategy only" });
    expect(closed).toHaveTextContent("Strategy only until its social accounts are connected.");
    expect(document.body.textContent).not.toMatch(/Sprout/);
  });
});

describe("the all-clients Reports", () => {
  it("leaves a strategy-only client's reports out of both lists, in the query, and lists the others", async () => {
    mount(<AllReports />);
    // One row in each list (monthly reports and competitive analyses) for the client in Sprout, none for the other.
    expect((await screen.findAllByRole("cell", { name: "Pine Street Labs" })).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("cell", { name: "Harbor Lane" })).toEqual([]);
    await waitFor(() => expect(w.reads.some((r) => r.table === "competitive_reports")).toBe(true));
    for (const table of ["reports", "competitive_reports"]) {
      const reads = w.reads.filter((r) => r.table === table);
      expect(reads.length).toBeGreaterThan(0);
      for (const r of reads) expect(r.not).toEqual([["client_id", "in", "(c2)"]]);
    }
    // Stored as before.
    expect(w.tables.reports).toHaveLength(2);
  });

  it("filters nothing when no client is strategy-only", async () => {
    w.only = [];
    mount(<AllReports />);
    expect((await screen.findAllByRole("cell", { name: "Harbor Lane" })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("cell", { name: "Pine Street Labs" }).length).toBeGreaterThan(0);
    expect(w.reads.filter((r) => r.table === "reports").every((r) => r.not.length === 0)).toBe(true);
  });
});

describe("the Competitive analysis page", () => {
  it("keeps a strategy-only client's competitors and feed, and says strategy only where its reports would be", async () => {
    mount(<CompetitiveIndex />, "/competitive?client=c2");
    expect(await screen.findByRole("button", { name: "Edit competitors" })).toBeInTheDocument();
    expect(screen.getByText(SHORT)).toBeInTheDocument();
    for (const name of ["Latest report", "Run competitive analysis", "All runs"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(screen.queryByText("Last report")).not.toBeInTheDocument();
  });

  it("shows a client with an account its reports as before", async () => {
    mount(<CompetitiveIndex />, "/competitive?client=c1");
    expect(await screen.findByRole("button", { name: "Run competitive analysis" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Latest report" })).toBeInTheDocument();
    expect(screen.getByText("Last report")).toBeInTheDocument();
    expect(screen.queryByText(SHORT)).not.toBeInTheDocument();
  });
});
