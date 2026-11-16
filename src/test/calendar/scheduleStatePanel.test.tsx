/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// The post panel's Schedule tab and the send dialog opened from it say the same state for one post's send
// (sendStateOf decides it once for both).
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PostPanel } from "@/components/reports/calendar/PostPanel";
import { SEND_RUN_LIMIT_MS } from "../../../supabase/functions/_shared/sprout/sendWindow";

const f = vi.hoisted(() => ({ rows: [] as any[] }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("Unexpected outbound request"))));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isLoading: false, isAuthenticated: true, isMoburstStaff: true, isClient: false, isAdmin: false, canRunAnalysis: true, canDelete: false, user: { _id: "u", name: "Staff", company: null } }) }));
vi.mock("@/lib/telemetry", () => ({ track: vi.fn(), editDistancePct: () => 0 }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "u" } } }) },
    functions: { invoke: async (name: string) => (name === "sprout-profiles" ? { data: { profiles: [{ id: 1, name: "Brand", network_type: "linkedin_company" }] }, error: null } : { data: {}, error: null }) },
    from: (table: string) => {
      const q: any = {
        select: () => q, is: () => q, range: () => q, eq: () => q, neq: () => q, order: () => q, limit: () => q, in: () => q,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (ok: any, bad: any) => Promise.resolve({ data: table === "scheduled_posts" ? f.rows : table === "sprout_profiles" ? [{ sprout_profile_id: 1, network_type: "linkedin_company" }] : [], error: null }).then(ok, bad),
      };
      return q;
    },
  },
}));

const post = { _calendarPostKey: "post:abc", copy: "A post.", platform: "LinkedIn", format: "Single Image", posting_time: "3:00 PM UTC" };
const mount = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
    <MemoryRouter><PostPanel open onOpenChange={() => {}} post={post} postIterations={[]} clientId="c1" reportId="r1" clientTimezone="UTC" /></MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => { f.rows = []; });
afterEach(cleanup);

describe("one post's send state on the Schedule tab and in the dialog", () => {
  it("says unconfirmed in both for an asked row whose send can no longer be running", async () => {
    f.rows = [{ id: "row-9", status: "asked", created_at: new Date(Date.now() - SEND_RUN_LIMIT_MS - 60_000).toISOString(), calendar_post_key: "post:abc", scheduled_time: "2030-09-21T15:00:00Z" }];
    mount();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Schedule" }));
    fireEvent.click(screen.getByRole("tab", { name: "Schedule" }));
    expect(await screen.findByText("Sprout did not confirm this post. Send it again to be sure it is there.")).toBeTruthy();
    expect(screen.queryByText(/Sent to Sprout as a draft/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send to Sprout" }));
    const dialog = await screen.findByRole("dialog", { name: /Send to Sprout/ });
    expect(await within(dialog).findByText("Sprout did not confirm this post. Send it again to be sure it is there.")).toBeTruthy();
  });

  it("says being sent in both while that send can still be running", async () => {
    f.rows = [{ id: "row-9", status: "asked", created_at: new Date().toISOString(), calendar_post_key: "post:abc", scheduled_time: "2030-09-21T15:00:00Z" }];
    mount();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Schedule" }));
    fireEvent.click(screen.getByRole("tab", { name: "Schedule" }));
    expect(await screen.findByText("This post is being sent to Sprout.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send to Sprout" }));
    const dialog = await screen.findByRole("dialog", { name: /Send to Sprout/ });
    expect(await within(dialog).findByText("This post is being sent to Sprout.")).toBeTruthy();
  });
});
