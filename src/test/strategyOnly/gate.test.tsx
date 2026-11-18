/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles of the database and the session. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrategyOnlyGate } from "@/components/clients/StrategyOnly";

// A strategy-only client (no active account in Sprout): its Calendar,
// Analytics and Reports pages show one calm sentence in place of their
// content, with the way to its strategy and, for staff, its setup. Any other
// client's page is shown as it always was.

const w = vi.hoisted(() => ({
  auth: { isMoburstStaff: true, isClient: false, user: { _id: "staff-1" } } as any,
  /** What strategy_only_clients answers: ids, an error, or a promise the test settles. */
  answer: (async () => ({ data: ["c1"], error: null })) as () => Promise<{ data: unknown; error: unknown }>,
  mounted: 0,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => w.auth }));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ title, children }: any) => <main><h1>{title}</h1>{children}</main> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: (name: string) => (name === "strategy_only_clients" ? w.answer() : Promise.resolve({ data: null, error: null })),
  from: () => {
    const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { name: "Harbor Lane" }, error: null }) };
    return q;
  },
} }));

function Page() {
  w.mounted++;
  return <section aria-label="The page">Planned posts and figures</section>;
}
function mount(path = "/clients/c1/calendar") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/clients/:id/calendar" element={<StrategyOnlyGate title="Calendar"><Page /></StrategyOnlyGate>} />
      </Routes>
    </MemoryRouter></QueryClientProvider>,
  );
}
beforeEach(() => {
  w.auth = { isMoburstStaff: true, isClient: false, user: { _id: "staff-1" } };
  w.answer = async () => ({ data: ["c1"], error: null });
  w.mounted = 0;
});
afterEach(() => cleanup());

const LINE = "Its calendar, designs, analytics and reports open once its social accounts are connected in Sprout.";
const CLIENT_LINE = "Its calendar, designs, analytics and reports open once its social accounts are connected.";

describe("a strategy-only client's page", () => {
  it("shows the one sentence in place of the content, under the page's own title", async () => {
    mount();
    expect(await screen.findByRole("heading", { name: "Harbor Lane is set up for strategy only" })).toBeInTheDocument();
    expect(screen.getByText(LINE)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Calendar");
    expect(screen.queryByText("Planned posts and figures")).not.toBeInTheDocument();
  });

  it("gives staff the way to its strategy and its setup", async () => {
    mount();
    expect(await screen.findByRole("link", { name: "Open the strategy" })).toHaveAttribute("href", "/clients/c1/strategy");
    expect(screen.getByRole("link", { name: "Client setup" })).toHaveAttribute("href", "/clients/c1/setup");
  });

  it("says the same sentence to the client's own user, without the staff links and without the word Sprout", async () => {
    w.auth = { isMoburstStaff: false, isClient: true, user: { _id: "client-user-1" } };
    mount();
    const heading = await screen.findByRole("heading", { name: "Harbor Lane is set up for strategy only" });
    expect(screen.getByText(CLIENT_LINE)).toBeInTheDocument();
    // The name of the tool the team connects accounts in is for staff only.
    expect(heading.closest("main")!.textContent).not.toMatch(/Sprout/);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("reads as a fact: no error, no button to press, no developer's word", async () => {
    mount();
    const heading = await screen.findByRole("heading", { name: "Harbor Lane is set up for strategy only" });
    const text = heading.closest("main")!.textContent ?? "";
    expect(text).not.toMatch(/error|failed|blocked|not allowed|sprout_profiles|flag|[—–]/i);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("any other client's page", () => {
  it("is shown as it always was, with no sentence", async () => {
    w.answer = async () => ({ data: ["another-client"], error: null });
    mount();
    await waitFor(() => expect(screen.getByText("Planned posts and figures")).toBeVisible());
    expect(screen.queryByText(/strategy only/)).not.toBeInTheDocument();
    // The page's own layout is the only one on screen.
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("is mounted from the start, so its own reads are not delayed, and shown once the client's state is known", async () => {
    let settle: (v: { data: unknown; error: unknown }) => void = () => {};
    w.answer = () => new Promise((resolve) => { settle = resolve; });
    mount();
    await waitFor(() => expect(w.mounted).toBeGreaterThan(0));
    expect(screen.getByText("Planned posts and figures")).not.toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    settle({ data: [], error: null });
    await waitFor(() => expect(screen.getByText("Planned posts and figures")).toBeVisible());
    // Shown where it was mounted: the page is not built a second time.
    expect(screen.getAllByLabelText("The page")).toHaveLength(1);
  });

  it("is never shown, not for a moment, when the client turns out to be strategy-only", async () => {
    let settle: (v: { data: unknown; error: unknown }) => void = () => {};
    w.answer = () => new Promise((resolve) => { settle = resolve; });
    mount();
    await waitFor(() => expect(w.mounted).toBeGreaterThan(0));
    expect(screen.getByText("Planned posts and figures")).not.toBeVisible();
    settle({ data: ["c1"], error: null });
    expect(await screen.findByRole("heading", { name: "Harbor Lane is set up for strategy only" })).toBeInTheDocument();
    expect(screen.queryByText("Planned posts and figures")).not.toBeInTheDocument();
  });

  it("is shown when the state cannot be read: a read that does not answer closes nothing", async () => {
    w.answer = async () => ({ data: null, error: { message: "no answer" } });
    mount();
    await waitFor(() => expect(screen.getByText("Planned posts and figures")).toBeVisible());
    expect(screen.queryByText(/strategy only/)).not.toBeInTheDocument();
  });
});
