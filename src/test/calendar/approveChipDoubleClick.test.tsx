/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// QA 22 Nov 2026 (P08-03): the status chip's approve toggle. The chip does not change, and is not
// disabled, until the board is read again after the write. toggleApproved flips
// whatever the server holds at that moment, so a second click on the chip that
// still says "Mark as approved" (it looked like the first did nothing) undoes
// the first: the post ends NOT approved after two clicks on "Mark as approved".
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ContentIdeasTab } from "@/components/reports/calendar/ContentIdeasTab";

const store = vi.hoisted(() => ({ approved: false, writes: 0 }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isMoburstStaff: true, isClient: false }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: "me" } } } }), getUser: async () => ({ data: { user: { id: "me" } } }) },
  functions: { invoke: async () => ({ data: {}, error: null }) },
  from: (table: string) => {
    let updating: any = null;
    const row = () => ({ id: "it1", client_id: "c1", calendar_post_key: "a", platform: "Instagram", post_copy: "Monday on Instagram", media_urls: ["https://x/1.png"], is_selected: true, is_approved: store.approved, variant_group_id: null, created_at: "2026-11-03T10:00:00Z" });
    const q: any = { select: () => q, eq: () => q, neq: () => q, in: () => q, is: () => q, order: () => q, limit: () => q, gte: () => q,
      update: (u: any) => { updating = u; return q; },
      maybeSingle: async () => ({ data: { variant_group_id: null, is_approved: store.approved }, error: null }),
      then: (ok: any, bad: any) => {
        if (updating) { store.approved = updating.is_approved; store.writes++; return Promise.resolve({ data: null, error: null }).then(ok, bad); }
        // The board's read of post_iterations takes a moment (a real round trip).
        const rows = table === "post_iterations" ? [row()] : [];
        return new Promise((r) => setTimeout(() => r({ data: rows, error: null }), 400)).then(ok, bad);
      } };
    return q;
  },
} }));
afterEach(cleanup);

describe("P08-03 approve chip clicked twice while it still shows the old state", () => {
  it("leaves the post approved after two clicks on 'Mark as approved'", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const week = [{ day: "Monday", date_label: "Nov 9", posts: [{ _calendarPostKey: "a", platform: "Instagram", copy: "Monday on Instagram", format: "Single Image" }] }];
    render(<QueryClientProvider client={qc}><ContentIdeasTab mode="calendar" contentCalendar={week} aiAnalysis={null} sproutPerformance={null} clientId="c1" availablePlatforms={["Instagram"]} availableLanguages={["en"]} /></QueryClientProvider>);
    const chip = await screen.findByRole("button", { name: "Mark as approved" }, { timeout: 3000 });
    // Two presses on the chip as it read "Mark as approved" (the second before the first's answer).
    fireEvent.click(chip);
    fireEvent.click(chip);
    await waitFor(() => expect(store.writes).toBe(2));
    await act(async () => { await new Promise((r) => setTimeout(r, 1200)); });
    expect(store.approved).toBe(true);
    expect(screen.getByRole("button", { name: "Unmark as approved" })).toBeInTheDocument();
  });

  it("shows the approval on the chip at once, before the write's answer", async () => {
    store.approved = false; store.writes = 0;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const week = [{ day: "Monday", date_label: "Nov 9", posts: [{ _calendarPostKey: "a", platform: "Instagram", copy: "Monday on Instagram", format: "Single Image" }] }];
    render(<QueryClientProvider client={qc}><ContentIdeasTab mode="calendar" contentCalendar={week} aiAnalysis={null} sproutPerformance={null} clientId="c1" availablePlatforms={["Instagram"]} availableLanguages={["en"]} /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Mark as approved" }, { timeout: 3000 }));
    // The board is read again only after 400 ms; the chip has changed well before that.
    expect(await screen.findByRole("button", { name: "Unmark as approved" }, { timeout: 150 })).toBeInTheDocument();
    await waitFor(() => expect(store.writes).toBe(1));
  });
});
