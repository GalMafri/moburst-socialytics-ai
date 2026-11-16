/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles. */
// Connect Google Slides opens Google's sign-in in its own tab: inside the
// Moburst Hub's frame Google refuses it ("400. That's an error", 8 Nov 2026).
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const f = vi.hoisted(() => ({ invoke: vi.fn(), isAdmin: true }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: any[]) => f.invoke(...a) } } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: f.isAdmin }) }));

import { GoogleSlidesConnection } from "@/components/settings/GoogleSlidesConnection";

const LINK = "https://accounts.google.com/o/oauth2/v2/auth?client_id=x";
const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

let tab: { opener: unknown; location: { href: string }; close: ReturnType<typeof vi.fn> };
beforeEach(() => {
  f.isAdmin = true;
  tab = { opener: {}, location: { href: "about:blank" }, close: vi.fn() };
  vi.spyOn(window, "open").mockImplementation(() => tab as any);
  f.invoke.mockImplementation(async (_fn: string, { body }: any) =>
    body.action === "status"
      ? { data: { ready: true, connected: false, account_email: null, connected_at: null }, error: null }
      : { data: { ready: true, authorize_url: LINK }, error: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); f.invoke.mockReset(); });

describe("GoogleSlidesConnection", () => {
  it("opens Google's sign-in in a new tab and says so", async () => {
    wrap(<GoogleSlidesConnection />);
    fireEvent.click(await screen.findByRole("button", { name: /Connect Google Slides/ }));
    expect(window.open).toHaveBeenCalledWith("", "_blank");
    await waitFor(() => expect(tab.location.href).toBe(LINK));
    expect(f.invoke).toHaveBeenCalledWith("google-auth", { body: { action: "start" } });
    expect(await screen.findByText(/sign-in is open in a new tab/)).toBeTruthy();
  });

  it("closes the tab and leaves the connection as it was when the sign-in cannot start", async () => {
    f.invoke.mockImplementation(async (_fn: string, { body }: any) =>
      body.action === "status"
        ? { data: { ready: true, connected: false, account_email: null, connected_at: null }, error: null }
        : { data: { ready: false }, error: null });
    wrap(<GoogleSlidesConnection />);
    fireEvent.click(await screen.findByRole("button", { name: /Connect Google Slides/ }));
    await waitFor(() => expect(tab.close).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/has not opened yet/)).toBeTruthy();
    expect(tab.location.href).toBe("about:blank");
  });

  const status = (over: Record<string, unknown>) => f.invoke.mockImplementation(async () => ({ data: { ready: true, connected: false, account_email: null, connected_at: null, ...over }, error: null }));

  it("says decks are not available yet, with no setup instructions, when Google is not set up", async () => {
    status({ ready: false });
    wrap(<GoogleSlidesConnection />);
    expect(await screen.findByText("Slides decks are not available yet. Strategy PDFs work without them.")).toBeTruthy();
    expect(screen.queryByText(/Google Cloud|one-time|setup/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Connect Google Slides/ })).toBeNull();
  });

  it("shows Connect only to an admin, and says Slides is unavailable to everyone else", async () => {
    f.isAdmin = false;
    status({ ready: true });
    wrap(<GoogleSlidesConnection />);
    expect(await screen.findByText(/Slides is unavailable right now/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Connect Google Slides|Sign in again/ })).toBeNull();
    expect(screen.queryByText(/Sign in as ai@moburst.com/)).toBeNull();
  });

  it("says what happened when a sign-in came back without connecting, in words", async () => {
    status({ ready: true });
    wrap(<GoogleSlidesConnection signInResult={{ reason: "refused" }} />);
    expect(await screen.findByText("Google did not allow the sign-in.")).toBeTruthy();
    cleanup();
    wrap(<GoogleSlidesConnection signInResult={{ reason: "wrong_account" }} />);
    expect(await screen.findByText("That was not ai@moburst.com.")).toBeTruthy();
    cleanup();
    wrap(<GoogleSlidesConnection signInResult={{ reason: "something_new" }} />);
    expect(await screen.findByText("The sign-in did not finish.")).toBeTruthy();
  });

  it("says a newer sign-in replaced the one that came back, not that it took too long", async () => {
    status({ ready: true });
    wrap(<GoogleSlidesConnection signInResult={{ reason: "bad_state" }} />);
    expect(await screen.findByText("A newer sign-in replaced this one.")).toBeTruthy();
    expect(screen.queryByText(/took too long/)).toBeNull();
    cleanup();
    wrap(<GoogleSlidesConnection signInResult={{ reason: "expired" }} />);
    expect(await screen.findByText("The sign-in took too long to finish.")).toBeTruthy();
  });

  it("still says a sign-in did not connect when an earlier connection is in place, and that the connection is unchanged", async () => {
    status({ ready: true, connected: true, account_email: "ai@moburst.com", connected_at: "2026-11-08T09:09:00Z" });
    wrap(<GoogleSlidesConnection signInResult={{ reason: "wrong_account" }} />);
    expect(await screen.findByText(/Connected as ai@moburst.com/)).toBeTruthy();
    expect(screen.getByText("That was not ai@moburst.com. The connection above is unchanged.")).toBeTruthy();
  });
});
