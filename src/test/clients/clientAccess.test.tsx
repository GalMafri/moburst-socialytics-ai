/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles of the database and the session. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientAccessGate } from "@/components/clients/ClientAccess";
import { StrategyOnlyGate } from "@/components/clients/StrategyOnly";

// A person who opens a client's page they cannot read (another client's
// address, an id that does not exist) reads one calm sentence with the way
// back to their dashboard, in place of a page that loads forever. A read that
// fails keeps the page and its own way to try again.

type Row = { id: string; archived_at: string | null };
const w = vi.hoisted(() => ({
  auth: {} as any,
  /** The clients row access lets this viewer read, by id. */
  rows: {} as Record<string, Row>,
  /** When set, the read of the client fails with this error. */
  failWith: null as null | { message: string; code?: string },
  /** How many times a page was built (mounted). */
  mounts: 0,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => w.auth, DEV_USER_ID: "00000000-0000-0000-0000-000000000000" }));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ title, children }: any) => <main><h1>{title}</h1>{children}</main> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: async () => ({ data: [], error: null }),
  from: () => {
    let wanted = "";
    const q: any = {
      select: () => q,
      eq: (_col: string, value: string) => { wanted = value; return q; },
      maybeSingle: async () => {
        // Yield a turn, as a real read does.
        await new Promise((r) => setTimeout(r, 0));
        if (w.failWith) return { data: null, error: w.failWith };
        if (!/^[0-9a-f-]{36}$/.test(wanted)) return { data: null, error: { message: "invalid input syntax for type uuid", code: "22P02" } };
        return { data: w.rows[wanted] ?? null, error: null };
      },
    };
    return q;
  },
} }));

const OWN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ARCHIVED = "33333333-3333-4333-8333-333333333333";
const MISSING = "44444444-4444-4444-8444-444444444444";

/** A page that, like the live Analytics page, waits for figures that never come when the client is not readable. */
const page = (name: string) => function Page() {
  useEffect(() => { w.mounts++; }, []);
  return <section aria-label={name}>Loading figures for Last 30 days</section>;
};
const Analytics = page("Analytics page");
const Calendar = page("Calendar page");
const Reports = page("Reports page");

function mount(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  // The same nesting as App.tsx: every /clients/:id page inside the one gate.
  const tree = () => (
    <QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/clients/:id" element={<ClientAccessGate />}>
          <Route path="analytics" element={<StrategyOnlyGate title="Analytics"><Analytics /></StrategyOnlyGate>} />
          <Route path="calendar" element={<StrategyOnlyGate title="Calendar"><Calendar /></StrategyOnlyGate>} />
          <Route path="reports" element={<StrategyOnlyGate title="Reports"><Reports /></StrategyOnlyGate>} />
          <Route path="setup" element={<section aria-label="Setup page">Client setup form</section>} />
        </Route>
      </Routes>
    </MemoryRouter></QueryClientProvider>
  );
  const view = render(tree());
  /** Draw again, as a change in the session does. */
  return { ...view, again: () => view.rerender(tree()) };
}

const SENTENCE = "This client isn't available to you";
const asClient = () => { w.auth = { user: { _id: "client-user-1" }, userRole: "client", isMoburstStaff: false, isClient: true, isLoading: false, isAuthenticated: true }; };
const asStaff = () => { w.auth = { user: { _id: "staff-1" }, userRole: "moburst_user", isMoburstStaff: true, isClient: false, isLoading: false, isAuthenticated: true }; };

beforeEach(() => {
  asClient();
  // Row access: a client user reads only its own client; staff read every client, archived ones included.
  w.rows = { [OWN]: { id: OWN, archived_at: null } };
  w.failWith = null;
  w.mounts = 0;
});
afterEach(() => cleanup());

describe("a client user on another client's page", () => {
  for (const [tab, label] of [["analytics", "Analytics page"], ["calendar", "Calendar page"], ["reports", "Reports page"]] as const) {
    it(`sees the one sentence on its ${tab}, with the way back to the dashboard, and never the page`, async () => {
      mount(`/clients/${OTHER}/${tab}`);
      expect(await screen.findByRole("heading", { name: SENTENCE })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Go to your dashboard" })).toHaveAttribute("href", "/");
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
      expect(screen.queryByText(/Loading figures/)).not.toBeInTheDocument();
    });
  }

  it("reads plain words: no error, no developer's word", async () => {
    mount(`/clients/${OTHER}/analytics`);
    const heading = await screen.findByRole("heading", { name: SENTENCE });
    const text = heading.closest("main")!.textContent ?? "";
    expect(text).not.toMatch(/error|failed|denied|forbidden|permission|RLS|row|uuid|supabase|404|[—–]/i);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("a client user on its own client's page", () => {
  for (const [tab, label] of [["analytics", "Analytics page"], ["calendar", "Calendar page"], ["reports", "Reports page"]] as const) {
    it(`sees its ${tab}`, async () => {
      mount(`/clients/${OWN}/${tab}`);
      await waitFor(() => expect(screen.getByLabelText(label)).toBeVisible());
      expect(screen.queryByText(SENTENCE)).not.toBeInTheDocument();
    });
  }

  it("is not shown the page for a moment before the answer, and the page is mounted only once", async () => {
    mount(`/clients/${OWN}/analytics`);
    expect(screen.getByLabelText("Analytics page")).not.toBeVisible();
    await waitFor(() => expect(screen.getByLabelText("Analytics page")).toBeVisible());
    expect(screen.getAllByLabelText("Analytics page")).toHaveLength(1);
  });

  it("sees the sentence once its client is archived, as its dashboard no longer lists it", async () => {
    w.rows[OWN] = { id: OWN, archived_at: "2026-11-01T00:00:00Z" };
    mount(`/clients/${OWN}/analytics`);
    expect(await screen.findByRole("heading", { name: SENTENCE })).toBeInTheDocument();
  });
});

describe("a read that fails", () => {
  it("keeps the page and its own way to try again, and never says the client is not available", async () => {
    w.failWith = { message: "Failed to fetch" };
    mount(`/clients/${OWN}/analytics`);
    await waitFor(() => expect(screen.getByLabelText("Analytics page")).toBeVisible());
    expect(screen.queryByText(SENTENCE)).not.toBeInTheDocument();
  });

  it("does the same for another client's address: no answer is not a no", async () => {
    w.failWith = { message: "Failed to fetch" };
    mount(`/clients/${OTHER}/calendar`);
    await waitFor(() => expect(screen.getByLabelText("Calendar page")).toBeVisible());
    expect(screen.queryByText(SENTENCE)).not.toBeInTheDocument();
  });
});

describe("staff", () => {
  beforeEach(() => {
    asStaff();
    w.rows = { [OWN]: { id: OWN, archived_at: null }, [OTHER]: { id: OTHER, archived_at: null }, [ARCHIVED]: { id: ARCHIVED, archived_at: "2026-11-01T00:00:00Z" } };
  });

  it("on an id that does not exist sees the sentence", async () => {
    mount(`/clients/${MISSING}/analytics`);
    expect(await screen.findByRole("heading", { name: SENTENCE })).toBeInTheDocument();
    expect(screen.queryByLabelText("Analytics page")).not.toBeInTheDocument();
  });

  it("on an address whose id is not an id at all sees the sentence", async () => {
    mount("/clients/not-a-client/reports");
    expect(await screen.findByRole("heading", { name: SENTENCE })).toBeInTheDocument();
  });

  it("on an archived client keeps its pages, which the dashboard's archive view opens", async () => {
    mount(`/clients/${ARCHIVED}/reports`);
    await waitFor(() => expect(screen.getByLabelText("Reports page")).toBeVisible());
    expect(screen.queryByText(SENTENCE)).not.toBeInTheDocument();
  });

  it("on any client sees its page", async () => {
    mount(`/clients/${OTHER}/calendar`);
    await waitFor(() => expect(screen.getByLabelText("Calendar page")).toBeVisible());
  });

  it("on the new-client form sees the form: there is no client to read yet", async () => {
    mount("/clients/new/setup");
    expect(screen.getByLabelText("Setup page")).toBeVisible();
    expect(screen.queryByText(SENTENCE)).not.toBeInTheDocument();
  });
});

describe("sign-in", () => {
  it("finishing does not build the page a second time", async () => {
    w.auth = { user: null, userRole: null, isMoburstStaff: false, isClient: false, isLoading: true, isAuthenticated: false };
    const view = mount(`/clients/${OWN}/analytics`);
    expect(screen.getByLabelText("Analytics page")).toBeInTheDocument();
    asClient();
    view.again();
    await waitFor(() => expect(screen.getByLabelText("Analytics page")).toBeVisible());
    expect(w.mounts).toBe(1);
  });

  it("ending does not build the page a second time", async () => {
    const view = mount(`/clients/${OWN}/analytics`);
    await waitFor(() => expect(screen.getByLabelText("Analytics page")).toBeVisible());
    w.auth = { user: null, userRole: null, isMoburstStaff: false, isClient: false, isLoading: false, isAuthenticated: false };
    view.again();
    expect(screen.getByLabelText("Analytics page")).toBeInTheDocument();
    expect(w.mounts).toBe(1);
  });
});

describe("the editor preview's stand-in user", () => {
  it("sees every client's pages as before: it has no session, so its read says nothing", async () => {
    w.auth = { user: { _id: "00000000-0000-0000-0000-000000000000" }, userRole: "admin", isMoburstStaff: true, isClient: false, isLoading: false, isAuthenticated: true };
    w.rows = {};
    mount(`/clients/${OTHER}/analytics`);
    await waitFor(() => expect(screen.getByLabelText("Analytics page")).toBeVisible());
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText(SENTENCE)).not.toBeInTheDocument();
  });
});

describe("App.tsx", () => {
  it("puts every page of one client inside the one gate", () => {
    const app = readFileSync(join(__dirname, "..", "..", "App.tsx"), "utf8");
    const block = /<Route path="\/clients\/:id" element=\{<ClientAccessGate \/>\}>([\s\S]*?)\n\s*<\/Route>/.exec(app);
    expect(block).not.toBeNull();
    for (const sub of ["setup", "analyze", "competitive", "competitive/run", "competitive/feed", "competitive/reports", "competitive/reports/:reportId", "strategy", "reports/:reportId", "reports", "analytics", "calendar"]) {
      expect(block![1]).toContain(`<Route path="${sub}" `);
    }
    // No client page is left outside it.
    expect(app).not.toMatch(/path="\/clients\/:id\//);
  });
});
