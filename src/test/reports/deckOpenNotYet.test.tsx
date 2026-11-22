/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles. */
// QA 22 Nov 2026 (P07-06): A report's Decks > Open on a deck stored as a file. openDeck opens a blank tab, asks for a signed link
// with quiet retries, and when no link comes it closes the tab and returns: the screen shows nothing at all, so
// the Open button looks dead (brief: after the quiet retries fail, the screen must show the true state).
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const f = vi.hoisted(() => ({ tab: { close: vi.fn(), location: { href: "" } } }));
vi.mock("@/lib/quietSend", async (orig) => ({ ...(await orig<any>()), sendQuietly: (send: any) => Promise.resolve(send()) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isMoburstStaff: false }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: () => { const q: any = { select: () => q, eq: () => q, order: () => q, then: (ok: any) => Promise.resolve({ data: [{ id: "d1", title: "October deck", kind: "deck", file_path: "r1/october.pdf", link: null, source: "claude", added_by_name: "Dana", created_at: "2026-11-02T10:00:00Z" }], error: null }).then(ok) }; return q; },
  storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: "Failed to fetch" } }) }) },
} }));
import { ReportDecks } from "@/components/reports/ReportDecks";
afterEach(cleanup);

describe("P07-06 Open a deck file when no link can be made", () => {
  it("says the deck did not open instead of showing nothing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(window, "open").mockImplementation(() => f.tab as any);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={qc}><ReportDecks reportId="r1" kind="social" /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Open October deck" }));
    await waitFor(() => expect(f.tab.close).toHaveBeenCalled());
    // The tab that opened on the click is closed again; something on the page should say the deck is not open.
    expect(await screen.findByRole("status")).toHaveTextContent("Not opened yet.");
  });
});
