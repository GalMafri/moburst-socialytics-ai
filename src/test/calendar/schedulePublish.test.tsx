/* eslint-disable @typescript-eslint/no-explicit-any -- Partial Supabase doubles model heterogeneous response shapes. */
// Scheduling a calendar post to Sprout through the screens the team uses:
// the post panel's Schedule tab, then the scheduling dialog. The post is a
// planned LinkedIn post (9 Nov at 6:45 PM New York time, 819 characters of
// copy, five hashtags, one finished design), built as the calendar builds it
// (boardPost, then the copy revisions), with the client's three assigned
// Sprout profiles (Facebook, Instagram, LinkedIn).
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { PostPanel } from "@/components/reports/calendar/PostPanel";
import { boardPost, type CalendarPostRow } from "@/lib/calendarPosts";
import { applyCopyRevisions } from "@/lib/calendarRevision";

const f = vi.hoisted(() => ({
  invokes: [] as Array<{ name: string; body: any }>,
  profilesAnswer: "listed" as "listed" | "refused",
  scheduleAnswer: { data: { success: true, recorded: true }, error: null } as { data: any; error: any },
  scheduled: [] as any[],
  success: vi.fn(),
}));

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("Unexpected outbound request"))));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isLoading: false, isAuthenticated: true, isMoburstStaff: true, isClient: false, isAdmin: false, user: { _id: "staff-user" } }) }));
vi.mock("@/lib/telemetry", () => ({ track: vi.fn(), editDistancePct: () => 0 }));
vi.mock("sonner", () => ({ toast: { success: f.success, error: vi.fn(), warning: vi.fn() } }));

const CLIENT = "moburst-client";
const POST_ID = "5f0c2a1e-7d3b-4c8e-9a61-2b4d8e9f0c17";
const DESIGN_URL = "https://fixture.supabase.co/storage/v1/object/public/design-finishes/moburst/linkedin-post/option-1.png";

/** The client's assigned Sprout profiles, as sprout_profiles holds them. */
const ASSIGNED = [
  { id: "sp-fb", client_id: CLIENT, sprout_profile_id: 5034995, network_type: "facebook", profile_name: "Moburst", is_active: true },
  { id: "sp-ig", client_id: CLIENT, sprout_profile_id: 5489335, network_type: "fb_instagram_account", profile_name: "moburst", is_active: true },
  { id: "sp-li", client_id: CLIENT, sprout_profile_id: 5719052, network_type: "linkedin_company", profile_name: "Moburst", is_active: true },
];

vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: "staff-user" } } }) },
  functions: { invoke: async (name: string, args: any) => {
    f.invokes.push({ name, body: args?.body });
    // sprout-profiles answers as it does: Sprout's metadata list, ids as numbers.
    if (name === "sprout-profiles") return f.profilesAnswer === "listed"
      ? { data: { profiles: ASSIGNED.map((p) => ({ id: p.sprout_profile_id, name: p.profile_name, native_name: p.profile_name, network_type: p.network_type, groups: ["1330748"] })) }, error: null }
      : { data: null, error: { message: "Edge Function returned a non-2xx status code" } };
    if (name === "schedule-sprout-post") return f.scheduleAnswer;
    return { data: {}, error: null };
  } },
  from: (table: string) => {
    const rows = () => table === "sprout_profiles" ? ASSIGNED : table === "scheduled_posts" ? f.scheduled : [];
    const q: any = {
      select() { return q; }, eq() { return q; }, neq() { return q; }, is() { return q; }, in() { return q; }, order() { return q; }, limit() { return q; },
      maybeSingle: async () => ({ data: table === "design_brand_settings" ? { confirmed_at: "2026-10-20T00:00:00Z" } : null, error: null }),
      then: (resolve: any, reject: any) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
    };
    return q;
  },
} }));

/** The calendar_posts row, as the calendar reads it. */
const row: CalendarPostRow = {
  id: POST_ID,
  client_id: CLIENT,
  report_id: null,
  post_date: "2026-11-09",
  posting_time: "6:45 PM",
  platform: "LinkedIn",
  format: "Single Image",
  pillar: "Thought leadership",
  copy: ("Three things we changed in our paid social bidding this quarter. " + "x".repeat(819)).slice(0, 819),
  hashtags: ["#PaidMedia", "#PaidSocial", "#Programmatic", "#MediaBuying", "#Moburst"],
  cta: null,
  visual_direction: null,
  rationale: null,
  language: "en",
  reasons: [],
  source: "plan",
  plan_id: "plan-1",
  post_key: `post:${POST_ID}`,
  raw: {},
  created_at: "2026-10-27T09:00:00Z",
};

/** The finished design: a design request's option, in use for the post. */
const design = {
  id: "iteration-1",
  client_id: CLIENT,
  calendar_post_key: `post:${POST_ID}`,
  platform: "LinkedIn",
  post_copy: row.copy,
  media_urls: [DESIGN_URL],
  variant_group_id: "design-request-1",
  variant_angle: "Design option 1",
  is_selected: true,
  created_at: "2026-11-01T10:00:00Z",
};

const clients: QueryClient[] = [];
function panel(client: QueryClient, iterations: any[], from: CalendarPostRow) {
  // As ContentIdeasTab hands it over: the board's post with its copy revisions applied, a new object on every render.
  const post = applyCopyRevisions(boardPost(from), iterations);
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PostPanel open onOpenChange={() => {}} post={post} postIterations={iterations} clientId={CLIENT} clientTimezone="America/New_York" />
      </MemoryRouter>
    </QueryClientProvider>
  );
}
function mountPanel(iterations: any[] = [design], from: CalendarPostRow = row) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const view = render(panel(client, iterations, from));
  return { ...view, redraw: () => view.rerender(panel(client, iterations, from)) };
}

async function openScheduler() {
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Schedule" }));
  fireEvent.click(await screen.findByRole("button", { name: "Send to Sprout" }));
  return screen.findByRole("dialog", { name: /Sprout/ });
}

beforeEach(() => {
  // Now: 2 Nov 2026, 14:00 UTC.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-02T14:00:00Z"));
  f.invokes = [];
  f.profilesAnswer = "listed";
  f.scheduleAnswer = { data: { success: true, recorded: true }, error: null };
  f.scheduled = [];
  f.success.mockClear();
});
afterEach(() => { cleanup(); clients.splice(0).forEach((c) => c.clear()); vi.useRealTimers(); });

describe("Scheduling a LinkedIn post from its panel", () => {
  it("fills the dialog with the post's date, time, LinkedIn profile, copy and design", async () => {
    mountPanel();
    await openScheduler();
    expect(await screen.findByLabelText("Date")).toHaveValue("2026-11-09");
    expect(screen.getByLabelText(/^Time/)).toHaveValue("18:45");
    expect(await screen.findByText("The client's LinkedIn account")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Media 1" })).toHaveAttribute("src", DESIGN_URL);
  });

  it("schedules it: the button is enabled and the function is called with the post's values", async () => {
    mountPanel();
    await openScheduler();
    const button = await screen.findByRole("button", { name: "Send" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(f.invokes.some((x) => x.name === "schedule-sprout-post")).toBe(true));
    const body = f.invokes.find((x) => x.name === "schedule-sprout-post")!.body;
    expect(body).toMatchObject({
      client_id: CLIENT,
      calendar_post_key: `post:${POST_ID}`,
      sprout_profile_id: 5719052,
      platform: "LinkedIn",
      scheduled_time: "2026-11-09T23:45:00.000Z",
      media_urls: [DESIGN_URL],
    });
  });

  it("reads a planned time written on the 24-hour clock", async () => {
    mountPanel([design], { ...row, posting_time: "18:45" });
    await openScheduler();
    expect(await screen.findByLabelText(/^Time/)).toHaveValue("18:45");
  });

  it("says why the button waits when the date or time is empty", async () => {
    mountPanel();
    await openScheduler();
    fireEvent.change(await screen.findByLabelText("Date"), { target: { value: "" } });
    expect(await screen.findByText("Choose a date.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("says when a time is skipped by the clock change, and the panel stays open", async () => {
    mountPanel();
    await openScheduler();
    fireEvent.change(await screen.findByLabelText("Date"), { target: { value: "2027-03-14" } });
    fireEvent.change(screen.getByLabelText(/^Time/), { target: { value: "02:30" } });
    expect(await screen.findByText("This local time does not exist because the clocks change. Choose another time.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("says to choose a profile when the client has two for the network", async () => {
    ASSIGNED.push({ id: "sp-li-2", client_id: CLIENT, sprout_profile_id: 5719053, network_type: "linkedin", profile_name: "Moburst founder", is_active: true });
    try {
      mountPanel();
      await openScheduler();
      expect(await screen.findByText("Choose the profile to post to.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    } finally {
      ASSIGNED.pop();
    }
  });

  it("sends the design in use, also when a newer design is not", async () => {
    const newer = { ...design, id: "iteration-2", variant_group_id: "design-request-2", variant_angle: "Design option 1", media_urls: [DESIGN_URL.replace("option-1", "newer")], is_selected: false, created_at: "2026-11-02T08:00:00Z" };
    mountPanel([design, newer]);
    await openScheduler();
    const button = await screen.findByRole("button", { name: "Send" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(f.invokes.some((x) => x.name === "schedule-sprout-post")).toBe(true));
    expect(f.invokes.find((x) => x.name === "schedule-sprout-post")!.body.media_urls).toEqual([DESIGN_URL]);
  });

  it("keeps the time a person changed when the calendar draws again", async () => {
    const view = mountPanel();
    await openScheduler();
    fireEvent.change(await screen.findByLabelText(/^Time/), { target: { value: "20:00" } });
    view.redraw();
    expect(screen.getByLabelText(/^Time/)).toHaveValue("20:00");
  });

  it("still schedules when Sprout's profile list does not answer", async () => {
    f.profilesAnswer = "refused";
    mountPanel();
    await openScheduler();
    const button = await screen.findByRole("button", { name: "Send" });
    await waitFor(() => expect(button).toBeEnabled());
  });
});

describe("Sending to Sprout now, as a draft", () => {
  it("offers two choices with one line under them, and no publishing words", async () => {
    mountPanel();
    const dialog = await openScheduler();
    expect(await screen.findByRole("radio", { name: "Send to Sprout now" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Send to Sprout for a set time" })).toBeChecked();
    expect(screen.getByText("It arrives in Sprout as a draft. Approve it there to post it.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Send to Sprout Social" })).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/publish|schedule post/i);
  });

  it("sends the post now, with no time", async () => {
    mountPanel();
    await openScheduler();
    fireEvent.click(await screen.findByRole("radio", { name: "Send to Sprout now" }));
    expect(screen.queryByLabelText("Date")).toBeNull();
    const button = await screen.findByRole("button", { name: "Send" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(f.invokes.some((x) => x.name === "schedule-sprout-post")).toBe(true));
    const body = f.invokes.find((x) => x.name === "schedule-sprout-post")!.body;
    expect(body).toMatchObject({ send_now: true, sprout_profile_id: 5719052, calendar_post_key: `post:${POST_ID}`, media_urls: [DESIGN_URL] });
    expect(body).not.toHaveProperty("scheduled_time");
  });

  it("says the draft's time once it is sent", async () => {
    f.scheduleAnswer = { data: { success: true, recorded: true, status: "sent_now", scheduled_time: "2026-11-02T14:01:00Z" }, error: null };
    mountPanel();
    await openScheduler();
    fireEvent.click(await screen.findByRole("radio", { name: "Send to Sprout now" }));
    const button = await screen.findByRole("button", { name: "Send" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(f.success).toHaveBeenCalledWith("Sent to Sprout as a draft for Nov 2, 9:01 AM."));
  });

  it("still says what the network needs", async () => {
    mountPanel([design], { ...row, copy: "x".repeat(3001), hashtags: [] });
    await openScheduler();
    fireEvent.click(await screen.findByRole("radio", { name: "Send to Sprout now" }));
    expect(await screen.findByText("The copy is 3,001 characters. LinkedIn takes up to 3,000.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it.each([["sent_now", "2026-11-02T14:01:00Z", "Nov 2, 9:01 AM"], ["scheduled", "2026-11-09T23:45:00Z", "Nov 9, 6:45 PM"]])(
    "the post's Schedule tab reads the draft's time in the client's zone (%s)",
    async (status, at, words) => {
      f.scheduled = [{ id: "s1", calendar_post_key: `post:${POST_ID}`, platform: "LinkedIn", status, scheduled_time: at }];
      mountPanel();
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Schedule" }));
      expect(await screen.findByText(`Sent to Sprout as a draft for ${words}.`)).toBeInTheDocument();
    },
  );
});
