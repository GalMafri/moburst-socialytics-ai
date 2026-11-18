/* eslint-disable @typescript-eslint/no-explicit-any -- Partial database and sign-in doubles. */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Preview as a client (18 Nov 2026), on the screens: the entry is for staff
// only, the dialog names the client and what will happen, the band shows
// only to a person in a preview and holds Exit, and after Start and after
// Exit the tab reads its role again and lands on the dashboard.

const f = vi.hoisted(() => ({
  role: "admin" as "admin" | "moburst_user" | "client",
  /** The person's open rows in role_previews, as the page reads them. */
  openRows: [] as Array<{ id: string }>,
  invoke: vi.fn(),
  refreshIdentity: vi.fn(async () => {}),
  tables: [] as string[],
}));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    isLoading: false, isAuthenticated: true, userRole: f.role,
    isAdmin: f.role === "admin", isMoburstStaff: f.role !== "client", isClient: f.role === "client",
    user: { name: "Dana", email: "dana@example.com" }, isGosSession: false, refreshIdentity: f.refreshIdentity,
  }),
}));
vi.mock("@/utils/gosAuth", () => ({ portalUrl: () => "https://portal.example" }));
vi.mock("@/integrations/supabase/client", () => {
  const CLIENTS = [{ id: "c-north", name: "North Bakery" }, { id: "c-south", name: "South Cycles" }];
  // Every filter returns the same builder; awaiting it gives the table's rows.
  const rowsOf = (table: string) => {
    const builder: any = new Proxy({}, {
      get: (_t, prop) => (prop === "then"
        ? (ok: any, bad: any) => Promise.resolve({ data: table === "role_previews" ? f.openRows : CLIENTS, error: null }).then(ok, bad)
        : () => builder),
    });
    return builder;
  };
  return { supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    from: (table: string) => { f.tables.push(table); return rowsOf(table); },
    functions: { invoke: (...args: unknown[]) => f.invoke(...args) },
  } };
});
// A plain select stands in for the dropdown, which needs a real browser's layout to open.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, disabled, children }: any) => (
    <select aria-label="Client" value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">Choose a client</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { RolePreviewBand, RolePreviewSync } from "@/components/preview/RolePreviewBand";

const NORTH = { id: "p1", client_id: "c-north", client_name: "North Bakery", started_at: "2026-11-18T09:00:00.000Z", expires_at: "2026-11-18T17:00:00.000Z" };
/** What the function answers, by action. A refusal is an error carrying the function's code, as supabase-js gives it. */
function answers(by: Record<string, { data?: unknown; code?: string; status?: number }>) {
  f.invoke.mockImplementation(async (_name: string, opts: { body: { action: string } }) => {
    const a = by[opts.body.action] ?? {};
    return a.code
      ? { data: null, error: { context: { status: a.status ?? 500, json: async () => ({ code: a.code, error: "detail for the team" }) } } }
      : { data: a.data ?? {}, error: null };
  });
}
const asked = (action: string) => f.invoke.mock.calls.filter(([, opts]) => opts.body.action === action).map(([name, opts]) => [name, opts.body]);

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}
let queries: QueryClient;
function show(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  queries = client;
  return render(
    <MemoryRouter initialEntries={["/reports"]}>
      <QueryClientProvider client={client}>
        <Where />
        {ui}
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
const sidebar = () => show(<SidebarProvider><AppSidebar /></SidebarProvider>);

beforeEach(() => {
  f.role = "admin";
  f.openRows = [];
  f.tables = [];
  f.invoke.mockReset();
  f.refreshIdentity.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(cleanup);

describe("the Preview as a client entry", () => {
  it.each(["admin", "moburst_user"] as const)("is in the sidebar for the role %s", (role) => {
    f.role = role;
    sidebar();
    expect(screen.getByRole("button", { name: "Preview as a client" })).toBeInTheDocument();
  });

  it("is never there for a client, which is also what a person in a preview is", () => {
    f.role = "client";
    sidebar();
    expect(screen.queryByText("Preview as a client")).toBeNull();
  });
});

describe("the dialog", () => {
  const open = async () => {
    sidebar();
    fireEvent.click(screen.getByRole("button", { name: "Preview as a client" }));
    const dialog = await screen.findByRole("dialog", { name: "Preview as a client" });
    await within(dialog).findByRole("option", { name: "North Bakery" });
    return dialog;
  };

  it("lists the active clients, says what will happen for the one chosen, and waits for a choice", async () => {
    const dialog = await open();
    expect(within(dialog).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a client", "North Bakery", "South Cycles"]);
    expect(within(dialog).getByRole("button", { name: "Start" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Client"), { target: { value: "c-north" } });
    expect(within(dialog).getByText("You will see Socialytics exactly as a user of North Bakery sees it, until you choose Exit preview.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Start" })).toBeEnabled();
    expect(f.invoke).not.toHaveBeenCalled();
  });

  it("Cancel closes it and nothing is asked", async () => {
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(f.invoke).not.toHaveBeenCalled();
    expect(f.refreshIdentity).not.toHaveBeenCalled();
  });

  it("Start asks for a preview of that client, then the tab reads its role again and goes to the dashboard", async () => {
    answers({ start: { data: { preview: NORTH } } });
    const dialog = await open();
    fireEvent.change(within(dialog).getByLabelText("Client"), { target: { value: "c-north" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
    await waitFor(() => expect(f.refreshIdentity).toHaveBeenCalledTimes(1));
    // Going in, the role is read in place: a sign-in is what would end the preview.
    expect(f.refreshIdentity).toHaveBeenCalledWith(undefined);
    expect(asked("start")).toEqual([["role-preview", { action: "start", client_id: "c-north" }]]);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays open and says where things stand when the preview did not start", async () => {
    answers({ start: { code: "not_started" } });
    const dialog = await open();
    fireEvent.change(within(dialog).getByLabelText("Client"), { target: { value: "c-south" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
    expect(await within(dialog).findByText("The preview has not started. To try again, choose Start.")).toBeInTheDocument();
    expect(within(dialog).queryByText(/detail for the team/)).toBeNull();
    expect(f.refreshIdentity).not.toHaveBeenCalled();
    expect(screen.getByTestId("where").textContent).toBe("/reports");
  });
});

describe("the band", () => {
  it("is not there for a real client or for staff not in a preview, and the function is not even asked", async () => {
    for (const role of ["client", "admin"] as const) {
      f.role = role;
      f.tables = [];
      show(<RolePreviewBand />);
      await waitFor(() => expect(f.tables).toContain("role_previews"));
      await Promise.resolve();
      expect(screen.queryByText(/You are previewing Socialytics/)).toBeNull();
      expect(screen.queryByRole("button", { name: "Exit preview" })).toBeNull();
      cleanup();
    }
    expect(f.invoke).not.toHaveBeenCalled();
  });

  it("names the client and holds Exit preview for a person in a preview", async () => {
    f.role = "client";
    f.openRows = [{ id: "p1" }];
    answers({ status: { data: { preview: NORTH, ended: null } } });
    show(<RolePreviewBand />);
    const band = await screen.findByRole("region", { name: "Client preview" });
    expect(band).toHaveTextContent("You are previewing Socialytics as a client user of North Bakery. Anything you change or request here is real.");
    expect(within(band).getByRole("button", { name: "Exit preview" })).toBeEnabled();
  });

  it("is not shown for an open row the function says is over", async () => {
    f.role = "admin";
    f.openRows = [{ id: "p1" }];
    answers({ status: { data: { preview: null, ended: "role_changed" } } });
    show(<RolePreviewBand />);
    await waitFor(() => expect(asked("status")).toHaveLength(1));
    await Promise.resolve();
    expect(screen.queryByRole("region", { name: "Client preview" })).toBeNull();
  });
});

describe("Exit preview", () => {
  const inPreview = async (stop: { data?: unknown; code?: string; status?: number }) => {
    f.role = "client";
    f.openRows = [{ id: "p1" }];
    answers({ status: { data: { preview: NORTH, ended: null } }, stop });
    // As in the database: once the function has ended the preview, its row is no longer open.
    const answer = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation(async (name: string, opts: { body: { action: string } }) => {
      if (opts.body.action === "stop" && !stop.code) f.openRows = [];
      return answer(name, opts);
    });
    show(<RolePreviewBand />);
    fireEvent.click(await screen.findByRole("button", { name: "Exit preview" }));
  };

  it("ends the preview, then the tab reads its role again, the band goes and the dashboard opens", async () => {
    await inPreview({ data: { preview: null, ended: "exited" } });
    await waitFor(() => expect(f.refreshIdentity).toHaveBeenCalledTimes(1));
    // Coming out, sign-in runs again, so the Hub's current role is the one applied.
    expect(f.refreshIdentity).toHaveBeenCalledWith({ signIn: true });
    expect(asked("stop")).toEqual([["role-preview", { action: "stop" }]]);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Client preview" })).toBeNull());
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/"));
  });

  it("takes nothing for granted when the function finds no preview to end: the role and the preview are read again from the server", async () => {
    await inPreview({ code: "no_preview", status: 409 });
    await waitFor(() => expect(f.refreshIdentity).toHaveBeenCalledWith({ signIn: true }));
    // The preview is read again too (once when the band came up, once now). Here the
    // database still has it open, so the band is back: it was not taken as over.
    await waitFor(() => expect(f.tables.filter((t) => t === "role_previews").length).toBeGreaterThanOrEqual(2));
    expect(await screen.findByRole("region", { name: "Client preview" })).toBeInTheDocument();
  });

  it("keeps the band and says the person is still in the preview when it did not end", async () => {
    await inPreview({ code: "not_exited" });
    expect(await screen.findByText("You are still in the preview. To leave it, choose Exit preview again.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Client preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exit preview" })).toBeEnabled();
    expect(f.refreshIdentity).not.toHaveBeenCalled();
  });
});

describe("a preview that changed somewhere else", () => {
  it("moves a tab still on the client side back once the preview has ended by itself", async () => {
    f.role = "client";
    f.openRows = [{ id: "p1" }];
    answers({ status: { data: { preview: null, ended: "expired" } } });
    show(<RolePreviewSync />);
    await waitFor(() => expect(f.refreshIdentity).toHaveBeenCalledTimes(1));
  });

  it("moves a tab still on the staff side into a preview started in another tab", async () => {
    f.role = "admin";
    f.openRows = [{ id: "p1" }];
    answers({ status: { data: { preview: NORTH, ended: null } } });
    show(<RolePreviewSync />);
    await waitFor(() => expect(f.refreshIdentity).toHaveBeenCalledTimes(1));
  });

  it("moves a tab back when Exit was chosen in another tab: no open row is left to say the preview ended", async () => {
    f.role = "client";
    f.openRows = [{ id: "p1" }];
    answers({ status: { data: { preview: NORTH, ended: null } } });
    show(<><RolePreviewSync /><RolePreviewBand /></>);
    await screen.findByRole("region", { name: "Client preview" });
    expect(f.refreshIdentity).not.toHaveBeenCalled();
    // The other tab exits. This tab's next check finds no row and asks the function nothing.
    f.openRows = [];
    await queries.invalidateQueries({ queryKey: ["role-preview"] });
    await waitFor(() => expect(f.refreshIdentity).toHaveBeenCalledTimes(1));
    expect(f.refreshIdentity).toHaveBeenCalledWith({ signIn: true });
    expect(asked("status")).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Client preview" })).toBeNull());
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/"));
  });

  it("leaves a real client and a staff member with no preview alone", async () => {
    for (const role of ["client", "moburst_user"] as const) {
      f.role = role;
      f.tables = [];
      show(<RolePreviewSync />);
      await waitFor(() => expect(f.tables).toContain("role_previews"));
      await Promise.resolve();
      cleanup();
    }
    expect(f.refreshIdentity).not.toHaveBeenCalled();
    expect(f.invoke).not.toHaveBeenCalled();
  });
});
