/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles, as in src/test/calendar/scheduleDialogOutcome.test.tsx. */
// QA 22 Nov 2026 (P07-02): Send to Sprout with a post whose hashtags is a string (as regenerate-post-copy returns it, P08-01,
// and as an AI calendar's raw JSON can carry it). SchedulePostModal.tsx:243 calls post.hashtags.map(...) after
// checking only .length, so opening the dialog throws "post.hashtags.map is not a function".
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SchedulePostModal } from "@/components/reports/SchedulePostModal";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  functions: { invoke: async () => ({ data: { profiles: [] }, error: null }) },
  from: (t: string) => { const q: any = { select: () => q, eq: () => q, neq: () => q, then: (ok: any, bad: any) => Promise.resolve({ data: t === "sprout_profiles" ? [{ sprout_profile_id: 1, network_type: "instagram" }] : [], error: null }).then(ok, bad) }; return q; },
} }));
afterEach(cleanup);

describe("Send to Sprout with hashtags as a string", () => {
  it("opens the dialog with the copy and the tags instead of throwing", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const post = { _calendarPostKey: "k1", copy: "Fall is here.", platform: "Instagram", hashtags: "#fall #sale", date_label: "2030-09-21", posting_time: "3:00 PM" };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    let thrown: unknown = null;
    try {
      render(<QueryClientProvider client={qc}><SchedulePostModal open onOpenChange={() => {}} post={post} clientId="c1" clientTimezone="UTC" /></QueryClientProvider>);
    } catch (e) { thrown = e; }
    expect(String(thrown ?? "")).not.toMatch(/is not a function/);
    expect((screen.getByLabelText(/Post copy/) as HTMLTextAreaElement).value).toContain("#fall");
  });
});
