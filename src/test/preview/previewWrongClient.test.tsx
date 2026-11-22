/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles, copied from src/test/preview/rolePreview.test.tsx. */
// QA 22 Nov 2026 (P07-01): Preview as a client. A preview of North Bakery is already open for this person (another tab,
// or one whose Exit never reached the server). They choose South Cycles and press Start. The function
// answers 409 already_previewing with the North preview; startRolePreview takes that open preview as
// "started" and PreviewAsClient switches the tab into North Bakery, with no word that it is not South.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const f = vi.hoisted(() => ({ invoke: vi.fn(), refreshIdentity: vi.fn(async () => {}) }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("@/lib/quietSend", async (orig) => ({ ...(await orig<any>()), QUIET_WAITS_MS: [] , sendQuietly: (send: any) => Promise.resolve(send()) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isLoading: false, isAuthenticated: true, userRole: "admin", isAdmin: true, isMoburstStaff: true, isClient: false, user: { name: "Dana", email: "d@example.com" }, refreshIdentity: f.refreshIdentity }) }));
vi.mock("@/integrations/supabase/client", () => {
  const CLIENTS = [{ id: "c-north", name: "North Bakery" }, { id: "c-south", name: "South Cycles" }];
  const rowsOf = (table: string) => { const b: any = new Proxy({}, { get: (_t, p) => (p === "then" ? (ok: any, bad: any) => Promise.resolve({ data: table === "role_previews" ? [{ id: "p1" }] : CLIENTS, error: null }).then(ok, bad) : () => b) }); return b; };
  return { supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) }, from: (t: string) => rowsOf(t), functions: { invoke: (...a: unknown[]) => f.invoke(...a) } } };
});
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, disabled, children }: any) => <select aria-label="Client" value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}><option value="">Choose a client</option>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null, SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));
import { PreviewAsClient } from "@/components/preview/PreviewAsClient";

const NORTH = { id: "p1", client_id: "c-north", client_name: "North Bakery", started_at: "2026-11-18T09:00:00.000Z", expires_at: "2026-11-18T17:00:00.000Z" };
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  f.invoke.mockImplementation(async (_n: string, o: { body: { action: string } }) => o.body.action === "start"
    ? { data: null, error: { context: { status: 409, json: async () => ({ code: "already_previewing", preview: NORTH }) } } }
    : { data: { preview: NORTH, ended: false }, error: null });
});
afterEach(() => { cleanup(); f.refreshIdentity.mockClear(); f.invoke.mockReset(); });

describe("P07-01 Start with another client's preview already open", () => {
  it("does not put the person into a preview of a client they did not choose", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<MemoryRouter><QueryClientProvider client={qc}><PreviewAsClient /></QueryClientProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Preview as a client" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("option", { name: "South Cycles" });
    fireEvent.change(within(dialog).getByLabelText("Client"), { target: { value: "c-south" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
    await waitFor(() => expect(f.invoke).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 300));
    // Chose South Cycles. Going into a preview reads the role again (refreshIdentity, no sign-in): that must not
    // happen for North Bakery's preview, which is the only one the function answered with.
    expect(f.refreshIdentity).not.toHaveBeenCalled();
    // It says which preview is open and offers to go to it or end it.
    expect(within(dialog).getByText(/A preview of North Bakery is already open, so the preview of South Cycles has not started\./)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Go to the North Bakery preview" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "End it and preview South Cycles" })).toBeInTheDocument();
  });

  it("ends the open preview and starts the chosen one when asked", async () => {
    const SOUTH = { ...NORTH, id: "p2", client_id: "c-south", client_name: "South Cycles" };
    let ended = false;
    f.invoke.mockImplementation(async (_n: string, o: { body: { action: string } }) => {
      if (o.body.action === "stop") { ended = true; return { data: { ended: true }, error: null }; }
      if (o.body.action === "start") return ended ? { data: { preview: SOUTH }, error: null } : { data: null, error: { context: { status: 409, json: async () => ({ code: "already_previewing", preview: NORTH }) } } };
      return { data: { preview: ended ? SOUTH : NORTH, ended: false }, error: null };
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<MemoryRouter><QueryClientProvider client={qc}><PreviewAsClient /></QueryClientProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Preview as a client" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("option", { name: "South Cycles" });
    fireEvent.change(within(dialog).getByLabelText("Client"), { target: { value: "c-south" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "End it and preview South Cycles" }));
    await waitFor(() => expect(f.refreshIdentity).toHaveBeenCalled());
    expect(f.invoke.mock.calls.map((c) => c[1].body.action)).toContain("stop");
  });
});
