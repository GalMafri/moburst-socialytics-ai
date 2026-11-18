import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Preview as a client changes a person's role under a session that stays the
// same, and the screens follow in place, with no page reload and nothing
// taken from the session token, which never carried the role.
//   * Going into a preview, the role is read again from the database and no
//     sign-in runs, since a sign-in is what ends a preview.
//   * Coming out of one, sign-in runs again from the start: in a tab opened
//     from the older portal the Hub is asked, and its current role is the
//     one applied, not the role the preview had saved.

const f = vi.hoisted(() => ({ role: "moburst_user" as string | null, token: null as string | null }));
vi.mock("@/utils/hubAuth", () => ({ initHubToken: () => f.token, clearHubToken: vi.fn() }));
vi.mock("@/utils/gosAuth", () => ({ getGosHandoffToken: () => null, rememberPortal: vi.fn() }));
vi.mock("@/utils/returnTo", () => ({ rememberIntendedDestination: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: {
    getSession: async () => ({ data: { session: { access_token: "stored-token", user: { id: "u1" } } }, error: null }),
    // The token still says admin, as it did at sign-in: it is never what decides.
    getUser: async () => ({ data: { user: { id: "u1", email: "dana@example.test", user_metadata: { tool_role: "admin", auth_source: "hub", hub_user_id: "h1", hub_company_name: "Harbor Works" } } }, error: null }),
    signOut: async () => ({ error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  },
  from: () => ({ select: () => ({ eq: async () => ({ data: f.role ? [{ role: f.role }] : [], error: null }) }) }),
} }));

import { AuthProvider, useAuth } from "@/hooks/useAuth";

function Status() {
  const a = useAuth();
  return (
    <div>
      <p>{a.isAuthenticated ? `role:${a.userRole} staff:${a.isMoburstStaff} client:${a.isClient}` : "signed out"}</p>
      <button onClick={() => void a.refreshIdentity()}>Read again</button>
      <button onClick={() => void a.refreshIdentity({ signIn: true })}>Sign in again</button>
    </div>
  );
}

let fetchMock: ReturnType<typeof vi.fn>;
/** The role the Hub holds for the person, as the bridge answers it. */
let hubRole = "moburst_user";
beforeEach(() => {
  hubRole = "moburst_user";
  f.role = "moburst_user";
  f.token = null;
  fetchMock = vi.fn(async (url: string) => (String(url).includes("/api/auth/me")
    ? { ok: true, status: 200, json: async () => ({ _id: "h1", name: "Dana", email: "dana@example.test", role: "user", company: "Harbor Works", isActive: true, tools: [] }) }
    : { ok: true, status: 200, json: async () => ({ tool_role: hubRole }) }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("reading the role again in place", () => {
  it("follows the database role into a preview and back out, without asking for a sign-in", async () => {
    render(<AuthProvider><Status /></AuthProvider>);
    expect(await screen.findByText("role:moburst_user staff:true client:false")).toBeInTheDocument();
    f.role = "client";
    fireEvent.click(screen.getByRole("button", { name: "Read again" }));
    expect(await screen.findByText("role:client staff:false client:true")).toBeInTheDocument();
    f.role = "moburst_user";
    fireEvent.click(screen.getByRole("button", { name: "Read again" }));
    expect(await screen.findByText("role:moburst_user staff:true client:false")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("works in a tab opened from the older portal, and does not sign in there again", async () => {
    f.token = "hub-token";
    render(<AuthProvider><Status /></AuthProvider>);
    expect(await screen.findByText("role:moburst_user staff:true client:false")).toBeInTheDocument();
    const signIns = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("hub-auth-bridge")).length;
    expect(signIns()).toBe(1);
    f.role = "client";
    fireEvent.click(screen.getByRole("button", { name: "Read again" }));
    expect(await screen.findByText("role:client staff:false client:true")).toBeInTheDocument();
    expect(signIns()).toBe(1);
  });
});

describe("coming out of a preview", () => {
  const signIns = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("hub-auth-bridge")).length;

  it("asks the Hub again in a tab opened from the older portal, and applies the Hub's role, not the saved one", async () => {
    f.token = "hub-token";
    hubRole = "admin";
    render(<AuthProvider><Status /></AuthProvider>);
    expect(await screen.findByText("role:admin staff:true client:false")).toBeInTheDocument();
    expect(signIns()).toBe(1);
    // While the preview was open the Hub made the person a Moburst user. Exit put the
    // saved admin role back in the database; the Hub's answer is what the tab applies.
    f.role = "admin";
    hubRole = "moburst_user";
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    expect(await screen.findByText("role:moburst_user staff:true client:false")).toBeInTheDocument();
    expect(signIns()).toBe(2);
  });

  it("signs the person out there when the Hub now refuses them", async () => {
    f.token = "hub-token";
    render(<AuthProvider><Status /></AuthProvider>);
    await screen.findByText("role:moburst_user staff:true client:false");
    fetchMock.mockImplementation(async (url: string) => (String(url).includes("/api/auth/me")
      ? { ok: true, status: 200, json: async () => ({ _id: "h1", name: "Dana", email: "dana@example.test", role: "user", company: "Harbor Works", isActive: true, tools: [] }) }
      : { ok: true, status: 200, json: async () => ({ error: "no_access" }) }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    expect(await screen.findByText("signed out")).toBeInTheDocument();
  });

  it("reads the role from the database in a tab with no portal token", async () => {
    f.role = "client";
    render(<AuthProvider><Status /></AuthProvider>);
    expect(await screen.findByText("role:client staff:false client:true")).toBeInTheDocument();
    f.role = "admin";
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    expect(await screen.findByText("role:admin staff:true client:false")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
