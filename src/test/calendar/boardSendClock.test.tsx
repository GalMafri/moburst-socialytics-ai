/* eslint-disable @typescript-eslint/no-explicit-any -- Board posts are loosely typed, as the board itself takes them. */
// The calendar board reads a sent post's state at the clock the Schedule tab reads it at (useSendClock): a card
// whose asked row passes its run limit while the board is open is drawn again as not confirmed, with nothing
// to reload.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CalendarKanban } from "@/components/reports/calendar/CalendarKanban";
import { SEND_RUN_LIMIT_MS } from "../../../supabase/functions/_shared/sprout/sendWindow";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isMoburstStaff: true, isClient: false }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }) },
  functions: { invoke: async () => ({ data: {}, error: null }) },
  from: () => {
    const q: any = { select: () => q, eq: () => q, neq: () => q, in: () => q, is: () => q, order: () => q, limit: () => q, gte: () => q,
      maybeSingle: async () => ({ data: null, error: null }), then: (ok: any) => Promise.resolve({ data: [], error: null }).then(ok) };
    return q;
  },
} }));
afterEach(cleanup);

const WEEK = [{ day: "Monday", date_label: "Nov 9", posts: [{ _calendarPostKey: "a", platform: "LinkedIn", copy: "Monday on LinkedIn", format: "Single Image" }] }];
const rowEndingIn = (ms: number, id = "row-9", key = "a") => ({ id, status: "asked", created_at: new Date(Date.now() - SEND_RUN_LIMIT_MS + ms).toISOString(), calendar_post_key: key, scheduled_time: "2030-09-21T15:00:00Z" });
const board = (rows: any[]) => render(<CalendarKanban contentCalendar={WEEK} postIterations={[]} scheduledPosts={rows} filters={{ day: "all", platform: "all", status: "all", language: "all" }} onCardClick={() => {}} onToggleApproved={() => {}} />);

describe("the board's clock for a send that is out", () => {
  it("draws a card again as not confirmed when its asked row passes its run limit", async () => {
    board([rowEndingIn(800)]);
    expect(screen.getByText("Sending to Sprout")).toBeTruthy();
    expect(await screen.findByText("Not confirmed by Sprout", {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.queryByText("Sending to Sprout")).toBeNull();
  }, 8000);

  it("follows each card's own row, one after the other", async () => {
    const week = [{ day: "Monday", date_label: "Nov 9", posts: [
      { _calendarPostKey: "a", platform: "LinkedIn", copy: "First", format: "Single Image" },
      { _calendarPostKey: "b", platform: "LinkedIn", copy: "Second", format: "Single Image" },
    ] }];
    render(<CalendarKanban contentCalendar={week} postIterations={[]} scheduledPosts={[rowEndingIn(600, "r1", "a"), rowEndingIn(2200, "r2", "b")]} filters={{ day: "all", platform: "all", status: "all", language: "all" }} onCardClick={() => {}} onToggleApproved={() => {}} />);
    expect(screen.getAllByText("Sending to Sprout")).toHaveLength(2);
    await vi.waitFor(() => { expect(screen.getAllByText("Sending to Sprout")).toHaveLength(1); expect(screen.getAllByText("Not confirmed by Sprout")).toHaveLength(1); }, { timeout: 3000 });
    await vi.waitFor(() => expect(screen.getAllByText("Not confirmed by Sprout")).toHaveLength(2), { timeout: 4000 });
  }, 9000);

  it("leaves a card whose send is already over, or has a post id, as it is and sets no clock", () => {
    board([{ ...rowEndingIn(-60_000), sprout_post_id: "77" }]);
    expect(screen.queryByText("Sending to Sprout")).toBeNull();
    cleanup();
    board([rowEndingIn(-60_000)]);
    expect(screen.getByText("Not confirmed by Sprout")).toBeTruthy();
  });
});
