/* eslint-disable @typescript-eslint/no-explicit-any -- Partial database and sign-in doubles. */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// A reload during a preview (18 Nov 2026). A tab opened from the older
// portal keeps its portal token and asks the sign-in bridge on every load,
// and the bridge writes the person's Hub role back, which ended a preview on
// every reload. A load now leaves the bridge alone only when all of these
// hold: the stored session is the person the Hub names (by the Hub's id and
// by email), the Hub has them active, the role-preview function, asked on
// that load, says their preview is open, and the session rebuilds as a
// client. Every other load asks the bridge as before.

const f = vi.hoisted(() => ({
  token: "hub-token" as string | null,
  /** False for a stored session that has ended. */
  session: true,
  sessionEmail: "dana@example.test",
  sessionHubId: "h1",
  hubEmail: "dana@example.test",
  hubActive: true,
  /** The role the database holds for the person. */
  role: "client",
  openRows: [{ id: "p1" }] as Array<{ id: string }>,
  previewReadFails: false,
  setSession: vi.fn(),
  invoke: vi.fn(),
  /** What happened, in order: each bridge call and each question to the role-preview function. */
  order: [] as string[],
}));
vi.mock("@/utils/hubAuth", () => ({ initHubToken: () => f.token, clearHubToken: vi.fn(() => { f.token = null; }) }));
vi.mock("@/utils/gosAuth", () => ({ getGosHandoffToken: () => null, rememberPortal: vi.fn() }));
vi.mock("@/utils/returnTo", () => ({ rememberIntendedDestination: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const answer = (table: string) => {
    if (table === "user_roles") return { data: [{ role: f.role }], error: null };
    if (table === "role_previews") return f.previewReadFails ? { data: null, error: { message: "permission denied" } } : { data: f.openRows, error: null };
    return { data: null, error: null };
  };
  // Every filter returns the same builder; awaiting it gives the table's rows.
  const rowsOf = (table: string) => {
    const builder: any = new Proxy({}, {
      get: (_t, prop) => (prop === "then" ? (ok: any, bad: any) => Promise.resolve(answer(table)).then(ok, bad) : () => builder),
    });
    return builder;
  };
  const user = () => ({ id: "u1", email: f.sessionEmail, user_metadata: { auth_source: "hub", hub_user_id: f.sessionHubId, hub_company_name: "Harbor Works", full_name: "Dana" } });
  return { supabase: {
    auth: {
      getSession: async () => ({ data: { session: f.session ? { access_token: "stored-token", user: user() } : null }, error: null }),
      getUser: async () => ({ data: { user: user() }, error: null }),
      setSession: async (...args: unknown[]) => { f.setSession(...args); return { error: null }; },
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: (table: string) => rowsOf(table),
    functions: { invoke: (name: string, opts: { body: { action: string } }) => { f.order.push(`${name}:${opts.body.action}`); return f.invoke(name, opts); } },
  } };
});

import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { RolePreviewBand } from "@/components/preview/RolePreviewBand";

function Status() {
  const a = useAuth();
  return <p>{a.isLoading ? "checking" : a.isAuthenticated ? `role:${a.userRole}` : `signed out ${a.authError ?? ""}`}</p>;
}

const OPEN = { preview: { id: "p1", client_id: "c-north", client_name: "North Bakery", started_at: "2026-11-18T09:00:00.000Z", expires_at: "2026-11-18T17:00:00.000Z" }, ended: null };
let fetchMock: ReturnType<typeof vi.fn>;
/** What the bridge answers; by default, the staff role the Hub holds for the person. */
let bridgeAnswer: Record<string, unknown>;
const calls = (part: string) => fetchMock.mock.calls.filter(([url]) => String(url).includes(part));
const bridgeBodies = () => calls("hub-auth-bridge").map(([, init]) => JSON.parse((init as { body: string }).body));

function load() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Status />
          <RolePreviewBand />
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.assign(f, { token: "hub-token", session: true, sessionEmail: "dana@example.test", sessionHubId: "h1", hubEmail: "dana@example.test", hubActive: true, role: "client", openRows: [{ id: "p1" }], previewReadFails: false, order: [] });
  f.setSession.mockClear();
  f.invoke.mockReset();
  f.invoke.mockResolvedValue({ data: OPEN, error: null });
  bridgeAnswer = { tool_role: "moburst_user" };
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes("/api/auth/me")) return { ok: true, status: 200, json: async () => ({ _id: "h1", name: "Dana", email: f.hubEmail, role: "user", company: "Harbor Works", isActive: f.hubActive, tools: [] }) };
    f.order.push("bridge");
    return { ok: true, status: 200, json: async () => bridgeAnswer };
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("a reload during a preview, in a tab opened from the older portal", () => {
  it("does not ask the bridge: the person stays a client, never shows as staff on the way, and the band is there", async () => {
    const seen: string[] = [];
    const view = load();
    const record = () => { const t = view.container.querySelector("p")?.textContent; if (t && seen.at(-1) !== t) seen.push(t); };
    record();
    const observer = new MutationObserver(record);
    observer.observe(view.container, { childList: true, subtree: true, characterData: true });
    expect(await screen.findByText("role:client")).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Client preview" })).toHaveTextContent("You are previewing Socialytics as a client user of North Bakery.");
    observer.disconnect();
    expect(seen).toEqual(["checking", "role:client"]);
    expect(calls("hub-auth-bridge")).toHaveLength(0);
    expect(f.setSession).not.toHaveBeenCalled();
    // The function itself was asked before the load was settled, not just the row read.
    expect(f.order[0]).toBe("role-preview:status");
    // The portal token stays, so the bridge is asked again once the preview is over.
    expect(f.token).toBe("hub-token");
  });
});

describe("every other load asks the bridge as before", () => {
  const bridged = async (expected: unknown[] = [{ hubToken: "hub-token", accessToken: "stored-token" }]) => {
    load();
    expect(await screen.findByText("role:moburst_user")).toBeInTheDocument();
    expect(bridgeBodies()).toEqual(expected);
  };

  it("a staff member with no open preview: the function is not even asked", async () => {
    f.role = "moburst_user";
    f.openRows = [];
    await bridged();
    expect(f.invoke).not.toHaveBeenCalled();
  });

  it("a real client, who can never have an open row", async () => {
    f.openRows = [];
    bridgeAnswer = { tool_role: "client" };
    load();
    expect(await screen.findByText("role:client")).toBeInTheDocument();
    expect(bridgeBodies()).toEqual([{ hubToken: "hub-token", accessToken: "stored-token" }]);
    expect(screen.queryByRole("region", { name: "Client preview" })).toBeNull();
    expect(f.invoke).not.toHaveBeenCalled();
  });

  it("when the function, asked on this load, ends a preview that is over: the bridge is asked straight after", async () => {
    f.invoke.mockResolvedValue({ data: { preview: null, ended: "expired" }, error: null });
    await bridged();
    expect(f.order.slice(0, 2)).toEqual(["role-preview:status", "bridge"]);
  });

  it("when the preview row cannot be read", async () => {
    f.previewReadFails = true;
    await bridged();
    expect(f.invoke).not.toHaveBeenCalled();
  });

  it("when the function does not answer", async () => {
    f.invoke.mockResolvedValue({ data: null, error: { context: { status: 500, json: async () => ({ code: "unavailable" }) } } });
    await bridged();
  });

  it("when the stored session has ended: the usual sign-in runs and a new session is installed", async () => {
    f.session = false;
    bridgeAnswer = { tool_role: "moburst_user", access_token: "a", refresh_token: "r" };
    await bridged([{ hubToken: "hub-token" }]);
    expect(f.setSession).toHaveBeenCalledWith({ access_token: "a", refresh_token: "r" });
    expect(f.invoke).not.toHaveBeenCalled();
  });

  it.each([
    ["by email", () => { f.sessionEmail = "someone.else@example.test"; }],
    ["by the Hub's id for them", () => { f.sessionHubId = "h2"; }],
  ] as const)("when the stored session is another person's, %s", async (_how, differ) => {
    differ();
    await bridged();
    expect(f.order[0]).toBe("bridge");
  });

  it("when the preview is open but the database does not have the person as a client", async () => {
    f.role = "admin";
    await bridged();
  });

  it("when the Hub no longer has the person active: the bridge refuses them, preview or not", async () => {
    f.hubActive = false;
    bridgeAnswer = { error: "deactivated" };
    load();
    expect(await screen.findByText(/signed out deactivated/)).toBeInTheDocument();
    expect(bridgeBodies()).toEqual([{ hubToken: "hub-token", accessToken: "stored-token" }]);
    expect(f.order[0]).toBe("bridge");
  });
});
