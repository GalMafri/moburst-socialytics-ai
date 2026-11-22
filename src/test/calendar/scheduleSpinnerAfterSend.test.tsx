/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles, as in src/test/calendar/scheduleDialogOutcome.test.tsx. */
// QA 22 Nov 2026 (P07-03): Send to Sprout succeeds, but the scheduled_posts read keeps failing (offline after the send, an outage).
// handleSend awaits invalidateQueries(["scheduled-posts-full"]) before setScheduling(false); that query is
// useScheduledPosts with retry: true (no cap), so the await never settles: the button spins on, the toast and the
// close never come, although the post is in Sprout.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SchedulePostModal } from "@/components/reports/SchedulePostModal";

const f = vi.hoisted(() => ({ sent: 0 }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  functions: { invoke: async (name: string) => {
    if (name === "sprout-profiles") return { data: { profiles: [{ id: 1, name: "Brand", network_type: "linkedin_company" }] }, error: null };
    f.sent++;
    return { data: { success: true, status: "scheduled", scheduled_time: "2030-09-21T15:00:00Z" }, error: null };
  } },
  from: (t: string) => { const q: any = { select: () => q, eq: () => q, neq: () => q, then: (ok: any, bad: any) => (t === "sprout_profiles"
    ? Promise.resolve({ data: [{ sprout_profile_id: 1, network_type: "linkedin_company" }], error: null })
    // The rows read never answers with rows once the send has gone (no connection).
    : Promise.resolve(f.sent ? { data: null, error: { message: "Failed to fetch" } } : { data: [], error: null })).then(ok, bad) }; return q; },
} }));
afterEach(cleanup);

describe("P07-03 Send to Sprout succeeds while the rows read fails", () => {
  it("ends the busy state and closes with the sent line", async () => {
    const onOpenChange = vi.fn();
    const post = { _calendarPostKey: "k1", copy: "A post.", platform: "LinkedIn", date_label: "2030-09-21", posting_time: "3:00 PM UTC" };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={qc}><SchedulePostModal open onOpenChange={onOpenChange} post={post} clientId="c1" clientTimezone="UTC" /></QueryClientProvider>);
    const button = await screen.findByRole("button", { name: "Send" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(f.sent).toBe(1));
    // The send answered success. Give the screen 8 s (the rows read is retried at 1, 2, 4 s ... with no cap).
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false), { timeout: 8000 });
  }, 15000);
});
