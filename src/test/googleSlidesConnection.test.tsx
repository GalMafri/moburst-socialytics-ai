/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles. */
// Connect Google Slides opens Google's sign-in in its own tab: inside the
// Moburst Hub's frame Google refuses it ("400. That's an error", 8 Nov 2026).
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const f = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: any[]) => f.invoke(...a) } } }));

import { GoogleSlidesConnection } from "@/components/settings/GoogleSlidesConnection";

const LINK = "https://accounts.google.com/o/oauth2/v2/auth?client_id=x";
const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

let tab: { opener: unknown; location: { href: string }; close: ReturnType<typeof vi.fn> };
beforeEach(() => {
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
});
