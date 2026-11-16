/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles. */
// The Higgsfield card says what the link is now: linked and working, refused
// by Higgsfield (needs a new sign-in), or not linked. It never tells a person
// to wait for a report that does not come.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const f = vi.hoisted(() => ({ invoke: vi.fn(), status: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: any[]) => f.invoke(...a) } } }));

import { HiggsfieldConnection } from "@/components/settings/HiggsfieldConnection";

const LINK = "https://clerk.higgsfield.ai/oauth/authorize?client_id=x";
const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

let tab: { opener: unknown; location: { href: string }; close: ReturnType<typeof vi.fn> };
beforeEach(() => {
  tab = { opener: {}, location: { href: "about:blank" }, close: vi.fn() };
  vi.spyOn(window, "open").mockImplementation(() => tab as any);
  f.status = { linked: true, needs_sign_in: false, account_email: "social-team@moburst.com", linked_at: "2026-11-01T08:00:00.000Z" };
  f.invoke.mockImplementation(async (_fn: string, { body }: any) =>
    body.action === "status" ? { data: f.status, error: null } : { data: { authorize_url: LINK }, error: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); f.invoke.mockReset(); });

describe("HiggsfieldConnection", () => {
  it("says the account is linked when the token works, with no line about waiting for a report", async () => {
    wrap(<HiggsfieldConnection />);
    expect(await screen.findByText("Account linked as social-team@moburst.com")).toBeTruthy();
    expect(screen.queryByText(/If generation reports/)).toBeNull();
    expect(screen.queryByText(/Needs sign in/)).toBeNull();
    expect(screen.getByRole("button", { name: /Sign in again/ })).toBeTruthy();
  });

  it("says it needs a sign in when Higgsfield refused the token, never Account linked", async () => {
    f.status = { linked: false, needs_sign_in: true, account_email: "social-team@moburst.com", linked_at: "2026-11-01T08:00:00.000Z" };
    wrap(<HiggsfieldConnection />);
    expect(await screen.findByText("Needs sign in")).toBeTruthy();
    expect(screen.queryByText(/Account linked/)).toBeNull();
    expect(screen.queryByText(/^Not connected$/)).toBeNull();
    expect(screen.getByRole("button", { name: /Sign in again/ })).toBeTruthy();
  });

  it("says not connected when nothing is linked", async () => {
    f.status = { linked: false, needs_sign_in: false, account_email: null, linked_at: null };
    wrap(<HiggsfieldConnection />);
    expect(await screen.findByText("Not connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Connect Higgsfield/ })).toBeTruthy();
  });

  it("keeps one sentence naming the account to sign in as, and no sign-in instructions", async () => {
    wrap(<HiggsfieldConnection />);
    await screen.findByText(/Account linked/);
    expect(screen.getByText("Sign in as social-team@moburst.com.")).toBeTruthy();
    expect(screen.queryByText(/15 minutes|permission|in this browser/)).toBeNull();
  });

  it("opens the sign-in in a new tab", async () => {
    f.status = { linked: false, needs_sign_in: true, account_email: "social-team@moburst.com", linked_at: null };
    wrap(<HiggsfieldConnection />);
    fireEvent.click(await screen.findByRole("button", { name: /Sign in again/ }));
    await waitFor(() => expect(tab.location.href).toBe(LINK));
    expect(await screen.findByText(/sign-in is open in a new tab/)).toBeTruthy();
  });
});
