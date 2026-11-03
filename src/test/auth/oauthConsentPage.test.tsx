import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const ID = "k7q2m4n6p3r5t7v2x4z6b3d5f7h2j4l6";
const f = vi.hoisted(() => ({
  auth: { isLoading: false, isAuthenticated: true },
  session: true as boolean,
  details: null as unknown,
  detailsError: null as unknown,
  approve: vi.fn(async () => ({ data: { redirect_url: "https://claude.ai/api/mcp/auth_callback?code=c" }, error: null })),
  deny: vi.fn(async () => ({ data: { redirect_url: "https://claude.ai/api/mcp/auth_callback?error=access_denied" }, error: null })),
  get: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => f.auth }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {
  getSession: async () => ({ data: { session: f.session ? { user: { id: "u" } } : null } }),
  oauth: {
    getAuthorizationDetails: (id: string) => { f.get(id); return Promise.resolve({ data: f.details, error: f.detailsError }); },
    approveAuthorization: f.approve,
    denyAuthorization: f.deny,
  },
} } }));

import OAuthConsent from "@/pages/OAuthConsent";
import { browser } from "@/utils/oauthConsent";

const claude = (redirect_uri = "https://claude.ai/api/mcp/auth_callback") => ({ authorization_id: ID, redirect_uri, client: { id: "c", name: "Claude", uri: "", logo_uri: "" }, user: { id: "u", email: "sinead@moburst.com" }, scope: "openid email profile" });

function open(origin = "https://socialytics.moburst.ai", search = `?authorization_id=${ID}`) {
  vi.spyOn(browser, "origin").mockReturnValue(origin);
  vi.spyOn(browser, "search").mockReturnValue(search);
  window.history.replaceState(null, "", `/oauth/consent${search}`);
  return render(
    <MemoryRouter initialEntries={[`/oauth/consent${search}`]}>
      <Routes>
        <Route path="/oauth/consent" element={<OAuthConsent />} />
        <Route path="/auth" element={<div>Sign-in page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

let replace: ReturnType<typeof vi.spyOn>;
let assign: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  f.auth = { isLoading: false, isAuthenticated: true };
  f.session = true;
  f.details = claude();
  f.detailsError = null;
  f.approve.mockClear(); f.deny.mockClear(); f.get.mockClear();
  localStorage.clear();
  replace = vi.spyOn(browser, "replace").mockImplementation(() => {});
  assign = vi.spyOn(browser, "assign").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the consent page", () => {
  it("forwards from the Lovable origin to socialytics.moburst.ai at once, with only the authorization id", async () => {
    open("https://moburst-socialytics-ai.lovable.app", `?authorization_id=${ID}&next=//evil.example`);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`https://socialytics.moburst.ai/oauth/consent?authorization_id=${ID}`));
    expect(f.get).not.toHaveBeenCalled();
    expect(screen.getByText(/Opening Socialytics/)).toBeInTheDocument();
  });

  it("forwards nothing that is not an authorization id, and says the request has expired", async () => {
    open("https://moburst-socialytics-ai.lovable.app", "?authorization_id=../../auth");
    expect(await screen.findByText("This connection request has expired")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(f.get).not.toHaveBeenCalled();
  });

  it("shows Claude's request with where it goes back to, who is signed in, and what Claude can do", async () => {
    open();
    expect(await screen.findByText("Connect Claude to Socialytics")).toBeInTheDocument();
    expect(screen.getByText("Claude will be able to read reports, analytics, trends, the calendar and, for Moburst staff, client notes and the strategy. Staff can also save client notes, approved copy, strategy edits and finished decks.")).toBeInTheDocument();
    expect(screen.getByText(/sinead@moburst\.com/)).toBeInTheDocument();
    expect(screen.getByText(/claude\.ai/)).toBeInTheDocument();
    expect(f.get).toHaveBeenCalledWith(ID);
    expect(replace).not.toHaveBeenCalled();
  });

  it("approves on Allow, and Supabase takes the browser back to Claude", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Allow" }));
    await waitFor(() => expect(f.approve).toHaveBeenCalledWith(ID));
    expect(f.deny).not.toHaveBeenCalled();
  });

  it("denies on Cancel", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(f.deny).toHaveBeenCalledWith(ID));
    expect(f.approve).not.toHaveBeenCalled();
  });

  it("denies a request for any other redirect without sending the browser there", async () => {
    f.details = claude("http://localhost:53682/callback");
    open();
    expect(await screen.findByText("This request didn't come from Claude")).toBeInTheDocument();
    await waitFor(() => expect(f.deny).toHaveBeenCalledWith(ID, { skipBrowserRedirect: true }));
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
    expect(f.approve).not.toHaveBeenCalled();
  });

  it("denies a signed-in person with no Socialytics role", async () => {
    f.auth = { isLoading: false, isAuthenticated: false };
    open();
    expect(await screen.findByText("Socialytics isn't available to your account")).toBeInTheDocument();
    await waitFor(() => expect(f.deny).toHaveBeenCalledWith(ID, { skipBrowserRedirect: true }));
    expect(f.get).not.toHaveBeenCalled();
  });

  it("saves its own address and sends a signed-out visitor to sign in", async () => {
    f.auth = { isLoading: false, isAuthenticated: false };
    f.session = false;
    open();
    expect(await screen.findByText("Sign-in page")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("mb_return_to")!).path).toBe(`/oauth/consent?authorization_id=${ID}`);
    expect(f.deny).not.toHaveBeenCalled();
  });

  it("goes straight back to Claude when the person already allowed it", async () => {
    f.details = { redirect_url: "https://claude.ai/api/mcp/auth_callback?code=c&state=s" };
    open();
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://claude.ai/api/mcp/auth_callback?code=c&state=s"));
  });

  it("says the request has expired when Supabase no longer knows it", async () => {
    f.details = null;
    f.detailsError = { message: "authorization not found" };
    open();
    expect(await screen.findByText("This connection request has expired")).toBeInTheDocument();
    expect(screen.queryByText(/authorization not found/)).toBeNull();
  });
});
