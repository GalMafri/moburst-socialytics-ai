/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles of the database and the session. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminDashboard } from "@/components/dashboard/AdminDashboard";
import { ClientDashboard } from "@/components/dashboard/ClientDashboard";

// The dashboard for a strategy-only client (no active account in Sprout):
// its card says so in one sentence and leads to its strategy, in place of
// its performance, this week's posts and its report links. A client with an
// account keeps the card it always had.

const w = vi.hoisted(() => ({
  auth: {} as any,
  clients: [] as any[],
  only: [] as string[],
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => w.auth }));
vi.mock("@/components/dashboard/ClientOverview", () => ({ ClientOverview: ({ clientId }: any) => <div>Overview of {clientId}</div> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
  removeChannel: vi.fn(),
  rpc: async (name: string) => ({ data: name === "strategy_only_clients" ? w.only : null, error: null }),
  from: () => {
    const q: any = {
      select: () => q, eq: () => q, is: () => q, in: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (ok: any) => Promise.resolve({ data: w.clients, error: null }).then(ok),
    };
    return q;
  },
  storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://files.test/${p}` } }) }) },
} }));

const done = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, status: "completed", created_at: "2026-10-07T08:00:00Z" }));
const mount = (node: React.ReactNode, path = "/") => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><MemoryRouter initialEntries={[path]}>{node}</MemoryRouter></QueryClientProvider>,
);
beforeEach(() => {
  w.auth = { canManageClients: true, canRunAnalysis: true, canDelete: true, isMoburstStaff: true, isClient: false, user: { _id: "staff-1" } };
  w.clients = [
    { id: "only", name: "Harbor Lane", reports: done(1), archived_at: null, primary_platforms: ["Instagram"], hub_company_name: null },
    { id: "in", name: "Pine Street Labs", reports: done(2), archived_at: null, primary_platforms: ["Instagram"], hub_company_name: null },
  ];
  w.only = ["only"];
});
afterEach(() => cleanup());

const LINE = "Its calendar, designs, analytics and reports open once its social accounts are connected in Sprout.";
const REPORT_NAMES = ["Run monthly report", "Run competitive analysis", "Monthly reports", "Competitive analyses", "Analytics"];

describe("the staff dashboard's client card", () => {
  it("for a strategy-only client: the sentence and the way to its strategy, in place of performance, posts and report links", async () => {
    mount(<AdminDashboard />, "/?client=only");
    expect(await screen.findByText("Harbor Lane is set up for strategy only")).toBeInTheDocument();
    expect(screen.getByText(LINE)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the strategy" })).toHaveAttribute("href", "/clients/only/strategy");
    // What stays: its setup (the card's own button, so the sentence carries no second one) and its competitors, which the strategy is written from.
    expect(screen.queryByRole("link", { name: "Client setup" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Client setup" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit competitors" })).toBeInTheDocument();
    // What is closed.
    expect(screen.queryByText("Overview of only")).not.toBeInTheDocument();
    for (const name of REPORT_NAMES) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(screen.queryByText(/Last report/)).not.toBeInTheDocument();
  });

  it("for a client with an account in Sprout: the card it always had", async () => {
    mount(<AdminDashboard />, "/?client=in");
    expect(await screen.findByText("Overview of in")).toBeInTheDocument();
    for (const name of REPORT_NAMES) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.getByText(/Last report/)).toBeInTheDocument();
    expect(screen.queryByText(/strategy only/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open the strategy" })).not.toBeInTheDocument();
  });

  it("opens by itself once the client has an account: nothing on the client says strategy-only", async () => {
    w.only = [];
    mount(<AdminDashboard />, "/?client=only");
    expect(await screen.findByText("Overview of only")).toBeInTheDocument();
    for (const name of REPORT_NAMES) expect(screen.getByRole("button", { name })).toBeInTheDocument();
  });

  it("counts only the reports that are shown: a strategy-only client's stored reports are not in the tiles", async () => {
    mount(<AdminDashboard />);
    const label = await screen.findByText("Completed reports");
    expect(label.closest("p")!.nextElementSibling!.textContent).toBe("2");
    const active = screen.getByText("Active clients");
    expect(active.closest("p")!.nextElementSibling!.textContent).toBe("2");
  });
});

describe("a client user's dashboard", () => {
  beforeEach(() => { w.auth = { isMoburstStaff: false, isClient: true, isGosSession: true, user: { _id: "client-user-1", company: null } }; });

  it("for a strategy-only client: the same sentence, without the staff links or the word Sprout, in place of the overview and the report cards", async () => {
    w.clients = [w.clients[0]];
    mount(<ClientDashboard />);
    expect(await screen.findByText("Harbor Lane is set up for strategy only")).toBeInTheDocument();
    expect(screen.getByText("Its calendar, designs, analytics and reports open once its social accounts are connected.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Sprout/);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText("Overview of only")).not.toBeInTheDocument();
    for (const name of ["Open the latest report", "Open report history", "Open competitive analyses", "Open analytics"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("for a client with an account in Sprout: the dashboard it always had", async () => {
    w.clients = [w.clients[1]];
    mount(<ClientDashboard />);
    expect(await screen.findByText("Overview of in")).toBeInTheDocument();
    for (const name of ["Open report history", "Open competitive analyses", "Open analytics"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.queryByText(/strategy only/)).not.toBeInTheDocument();
  });
});
