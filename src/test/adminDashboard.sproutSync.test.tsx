/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// "Sync from Sprout" on the staff dashboard: who sees it, that it is busy for
// as long as the server says a run is under way (after a reload too), and
// the one line a run leaves. The server is a double that answers the two
// sprout-profiles actions as the function does.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminDashboard } from "@/components/dashboard/AdminDashboard";

type Sync = { open: boolean; slow: boolean; last: null | { finished: boolean; finished_at?: string; added: Array<{ id: string; name: string }> } };
const IDLE: Sync = { open: false, slow: false, last: null };
const OPEN: Sync = { open: true, slow: false, last: null };

const f = vi.hoisted(() => ({
  staff: true,
  /** Whether the page holds a real sign-in: the editor's preview holds none. */
  signedIn: true,
  clients: [] as any[],
  clientReads: 0,
  calls: [] as string[],
  sync: { open: false, slow: false, last: null } as any,
  /** What a press is answered with: the run it started, the run under way, or no answer. */
  press: "starts" as "starts" | "refused",
}));
vi.mock("@/components/dashboard/ClientOverview", () => ({ ClientOverview: () => null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ canManageClients: f.staff, canRunAnalysis: f.staff, canDelete: false }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: f.signedIn ? { access_token: "token" } : null }, error: null }) },
  channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
  removeChannel: vi.fn(),
  from: () => ({ select: () => ({ order: async () => { f.clientReads++; return { data: f.clients, error: null }; } }) }),
  storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://files.test/${p}` } }) }) },
  functions: { invoke: async (name: string, options: { body: { action?: string } }) => {
    const action = String(options?.body?.action ?? "");
    f.calls.push(`${name}:${action}`);
    if (action === "sync_status") return { data: { sync: f.sync }, error: null };
    if (action === "sync_now") {
      // A refusal is not asked again (src/lib/quietSend.ts).
      if (f.press === "refused") return { data: null, error: { name: "FunctionsHttpError", context: { status: 403 } } };
      const started = !f.sync.open;
      f.sync = { open: true, slow: false, last: null };
      return { data: { started, sync: f.sync }, error: null };
    }
    return { data: {}, error: null };
  } },
} }));

let client: QueryClient;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  f.staff = true; f.signedIn = true; f.clientReads = 0; f.calls = []; f.sync = IDLE; f.press = "starts";
  f.clients = [{ id: "a", name: "Alpha Fixture", reports: [], archived_at: null, primary_platforms: [] }];
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); vi.useRealTimers(); vi.restoreAllMocks(); });

async function tick(ms = 20) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function mount() {
  const view = render(<QueryClientProvider client={client}><MemoryRouter><AdminDashboard /></MemoryRouter></QueryClientProvider>);
  await tick();
  return view;
}
const button = () => screen.getByRole("button", { name: /Sync(ing)? from Sprout/ });
const presses = () => f.calls.filter((c) => c === "sprout-profiles:sync_now").length;
const NORTH = { id: "11111111-1111-4111-8111-111111111111", name: "Northwind Fixture" };
const HARBOR = { id: "22222222-2222-4222-8222-222222222222", name: "Harbor Fixture" };

describe("who sees Sync from Sprout", () => {
  it("staff who can add a client see it beside Add client", async () => {
    await mount();
    const add = screen.getByRole("button", { name: "Add client" });
    expect(button().textContent).toBe("Sync from Sprout");
    expect(button()).toBeEnabled();
    expect(button().parentElement).toBe(add.parentElement);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a person who cannot add a client sees no button, and the run is never asked about", async () => {
    f.staff = false;
    await mount();
    expect(screen.queryByRole("button", { name: /Sync(ing)? from Sprout/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add client" })).toBeNull();
    expect(f.calls).toEqual([]);
  });

  it("without a real sign-in (the editor's preview) the server is never asked, on opening or on a press", async () => {
    f.signedIn = false;
    await mount();
    expect(button().textContent).toBe("Sync from Sprout");
    expect(button()).toBeEnabled();
    fireEvent.click(button());
    await tick();
    expect(f.calls).toEqual([]);
    expect(screen.getByRole("status").textContent).toContain("The sync from Sprout did not start. The weekly sync still runs.");
  });

  it("is beside both Add client buttons when there are no clients yet", async () => {
    f.clients = [];
    await mount();
    expect(screen.getAllByRole("button", { name: "Add client" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Sync from Sprout" })).toHaveLength(2);
  });
});

describe("while a run is under way", () => {
  it("is busy from the moment the page opens, after a reload too, and starts nothing", async () => {
    f.sync = OPEN;
    const first = await mount();
    expect(button().textContent).toBe("Syncing from Sprout…");
    expect(button()).toBeDisabled();
    fireEvent.click(button());
    first.unmount();
    client.clear();
    // The page opened again: the server still says a run is under way.
    await mount();
    expect(button().textContent).toBe("Syncing from Sprout…");
    expect(button()).toBeDisabled();
    expect(presses()).toBe(0);
  });

  it("starts one run however fast it is pressed, and looks again every ten seconds", async () => {
    await mount();
    fireEvent.click(button());
    fireEvent.click(button());
    fireEvent.click(button());
    await tick();
    expect(presses()).toBe(1);
    expect(button().textContent).toBe("Syncing from Sprout…");
    expect(button()).toBeDisabled();
    const before = f.calls.filter((c) => c.endsWith("sync_status")).length;
    await tick(10_000);
    await tick(10_000);
    expect(f.calls.filter((c) => c.endsWith("sync_status")).length).toBe(before + 2);
    expect(presses()).toBe(1);
  });

  it("shows the run another person started instead of starting a second one", async () => {
    await mount();
    // Someone else's run began after this page read the status.
    f.sync = OPEN;
    fireEvent.click(button());
    await tick();
    expect(presses()).toBe(1);
    expect(button()).toBeDisabled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says so when the run is taking longer than usual", async () => {
    f.sync = { open: true, slow: true, last: null };
    await mount();
    expect(screen.getByRole("status").textContent).toBe("Syncing from Sprout is taking longer than usual. It keeps trying.");
    expect(button()).toBeDisabled();
  });
});

describe("when the run is over", () => {
  async function runTo(last: Sync["last"]) {
    await mount();
    fireEvent.click(button());
    await tick();
    f.sync = { open: false, slow: false, last };
    await tick(10_000);
  }

  it("says how many clients were added, each a link to its setup page, and reads the client list again", async () => {
    await mount();
    fireEvent.click(button());
    await tick();
    const reads = f.clientReads;
    f.sync = { open: false, slow: false, last: { finished: true, finished_at: "2026-11-18T10:04:00Z", added: [HARBOR, NORTH] } };
    await tick(10_000);
    expect(screen.getByRole("status").textContent).toBe("Added 2 new clients from Sprout: Harbor Fixture, Northwind Fixture.");
    expect(screen.getByRole("link", { name: "Harbor Fixture" })).toHaveAttribute("href", `/clients/${HARBOR.id}/setup`);
    expect(screen.getByRole("link", { name: "Northwind Fixture" })).toHaveAttribute("href", `/clients/${NORTH.id}/setup`);
    expect(f.clientReads).toBeGreaterThan(reads);
    expect(button().textContent).toBe("Sync from Sprout");
    expect(button()).toBeEnabled();
    // Over: the page stops asking.
    const asked = f.calls.length;
    await tick(30_000);
    expect(f.calls.length).toBe(asked);
  });

  it("says one client was added in the singular", async () => {
    await runTo({ finished: true, added: [NORTH] });
    expect(screen.getByRole("status").textContent).toBe("Added 1 new client from Sprout: Northwind Fixture.");
  });

  it("says nothing was new", async () => {
    await runTo({ finished: true, added: [] });
    expect(screen.getByRole("status").textContent).toBe("No new brands in Sprout. Everything is up to date.");
    expect(screen.queryByRole("link", { name: /Fixture/ })).toBeNull();
  });

  it("keeps the line until it is dismissed", async () => {
    await runTo({ finished: true, added: [] });
    await tick(60_000);
    expect(screen.getByRole("status")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says calmly that a run did not finish, with the button ready again and nothing that reads as an error", async () => {
    await runTo({ finished: false, added: [] });
    const line = screen.getByRole("status").textContent ?? "";
    expect(line).toBe("The sync from Sprout did not finish. The weekly sync still runs.");
    expect(line).not.toMatch(/fail|error|could not|wrong|tried/i);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(button().textContent).toBe("Sync from Sprout");
    expect(button()).toBeEnabled();
  });

  it("names what a run added before it stopped", async () => {
    await runTo({ finished: false, added: [NORTH] });
    expect(screen.getByRole("status").textContent).toBe("Added 1 new client from Sprout: Northwind Fixture. The sync from Sprout did not finish. The weekly sync still runs.");
  });

  it("says calmly that a run did not start when the press got no answer, with the button ready again", async () => {
    f.press = "refused";
    await mount();
    fireEvent.click(button());
    await tick();
    expect(screen.getByRole("status").textContent).toBe("The sync from Sprout did not start. The weekly sync still runs.");
    expect(button().textContent).toBe("Sync from Sprout");
    expect(button()).toBeEnabled();
  });

  it("says nothing about a run this page never saw under way", async () => {
    f.sync = { open: false, slow: false, last: { finished: true, added: [NORTH] } };
    await mount();
    expect(screen.queryByRole("status")).toBeNull();
    expect(button()).toBeEnabled();
  });

  it("says how a run ended to a person who opened the page while it was under way", async () => {
    f.sync = OPEN;
    await mount();
    f.sync = { open: false, slow: false, last: { finished: true, added: [] } };
    await tick(10_000);
    expect(screen.getByRole("status").textContent).toBe("No new brands in Sprout. Everything is up to date.");
    expect(presses()).toBe(0);
  });
});
