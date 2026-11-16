/* eslint-disable @typescript-eslint/no-explicit-any */
// The send dialog for a post whose send Sprout was asked to make and never confirmed:
// it says so, offers Send again, and that press closes exactly that earlier send.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SchedulePostModal } from "@/components/reports/SchedulePostModal";
import { SEND_RUN_LIMIT_MS } from "../../../supabase/functions/_shared/sprout/sendWindow";

const f = vi.hoisted(() => ({ rows: [] as any[], invokes: [] as any[], reply: { data: { success: true }, error: null } as any }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: async (name: string, args: any) => {
        f.invokes.push({ name, args });
        if (name === "sprout-profiles") return { data: { profiles: [{ id: 1, name: "Brand", network_type: "linkedin_company" }] }, error: null };
        return f.reply;
      },
    },
    from: (table: string) => {
      const q: any = { select: () => q, eq: () => q, neq: () => q, then: (ok: any, bad: any) => Promise.resolve({ data: table === "sprout_profiles" ? [{ sprout_profile_id: 1, network_type: "linkedin_company" }] : f.rows, error: null }).then(ok, bad) };
      return q;
    },
  },
}));

/** A reply the function sends with a non-2xx status: supabase-js puts the Response on error.context. */
const refusal = (status: number, code: string) => ({ data: null, error: { context: { status, json: async () => ({ error: "x", code }) } } });
const post = { _calendarPostKey: "post:abc", copy: "A post.", platform: "LinkedIn", date_label: "2030-09-21", posting_time: "3:00 PM UTC" };
/** Created long enough ago that its send can no longer be running. */
const PAST = () => new Date(Date.now() - SEND_RUN_LIMIT_MS - 60_000).toISOString();
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><SchedulePostModal open onOpenChange={() => {}} post={post} clientId="c1" clientTimezone="UTC" /></QueryClientProvider>);

beforeEach(() => { f.rows = []; f.invokes = []; f.reply = { data: { success: true }, error: null }; });
afterEach(cleanup);

describe("the send dialog for an asked row", () => {
  it("says Sprout has not confirmed it, and Send again sends the row to close", async () => {
    f.rows = [{ id: "row-9", status: "asked", created_at: PAST(), calendar_post_key: "post:abc", scheduled_time: "2030-09-21T15:00:00Z" }];
    mount();
    expect(await screen.findAllByText("Sprout did not confirm this post. Send it again to be sure it is there.")).not.toHaveLength(0);
    // The fact and the button; nothing asks the person to go and check Sprout.
    expect(screen.queryByText(/If it is not in Sprout/)).toBeNull();
    const again = await screen.findByRole("button", { name: "Send again" });
    await waitFor(() => expect(again).toBeEnabled());
    fireEvent.click(again);
    await waitFor(() => expect(f.invokes.some((x) => x.name === "schedule-sprout-post")).toBe(true));
    expect(f.invokes.find((x) => x.name === "schedule-sprout-post").args.body.supersede).toBe("row-9");
  });

  it("does not say unconfirmed for a row with a post id, and sends no row to close", async () => {
    f.rows = [{ id: "row-9", status: "asked", created_at: PAST(), sprout_post_id: "77", calendar_post_key: "post:abc", scheduled_time: "2030-09-21T15:00:00Z" }];
    mount();
    await screen.findByRole("button", { name: "Send again" });
    expect(screen.queryByText(/did not confirm/)).toBeNull();
  });

  it("says the post is already being sent when the server held the press", async () => {
    f.reply = refusal(409, "send_in_progress");
    mount();
    const send = await screen.findByRole("button", { name: "Send" });
    await waitFor(() => expect(send).toBeEnabled());
    fireEvent.click(send);
    expect(await screen.findByText("This post is already being sent.", {}, { timeout: 15000 })).toBeTruthy();
  }, 20000);

  it("says not sent, and never that the post is being sent, when the server refuses with 409 for a profile in no Sprout group", async () => {
    f.reply = refusal(409, "profile_not_in_group");
    mount();
    const send = await screen.findByRole("button", { name: "Send" });
    await waitFor(() => expect(send).toBeEnabled());
    fireEvent.click(send);
    expect(await screen.findByText("Not sent to Sprout yet. Everything above is kept as it is.", {}, { timeout: 15000 })).toBeTruthy();
    expect(screen.queryByText("This post is already being sent.")).toBeNull();
  }, 20000);

  it("says this press did not go through when the post has an earlier confirmed draft", async () => {
    f.rows = [{ id: "row-1", status: "scheduled", sprout_post_id: "77", created_at: new Date(Date.now() - 86_400_000).toISOString(), calendar_post_key: "post:abc", scheduled_time: "2030-09-20T15:00:00Z" }];
    f.reply = refusal(422, "not_publishable");
    mount();
    const again = await screen.findByRole("button", { name: "Send again" });
    await waitFor(() => expect(again).toBeEnabled());
    fireEvent.click(again);
    expect(await screen.findByText("This send did not go through. Everything above is kept as it is.", {}, { timeout: 15000 })).toBeTruthy();
  }, 20000);

  it("keeps saying the post is being sent while the earlier send can still be running, and closes nothing", async () => {
    f.rows = [{ id: "row-9", status: "asked", created_at: new Date().toISOString(), calendar_post_key: "post:abc", scheduled_time: "2030-09-21T15:00:00Z" }];
    f.reply = refusal(409, "send_in_progress");
    mount();
    expect(await screen.findByText("This post is being sent to Sprout.")).toBeTruthy();
    expect(screen.queryByText(/did not confirm/)).toBeNull();
    const again = await screen.findByRole("button", { name: "Send again" });
    await waitFor(() => expect(again).toBeEnabled());
    fireEvent.click(again);
    expect(await screen.findByText("This post is already being sent.", {}, { timeout: 15000 })).toBeTruthy();
    expect(screen.queryByText(/did not confirm/)).toBeNull();
    const sends = f.invokes.filter((x) => x.name === "schedule-sprout-post");
    expect(sends.length).toBeGreaterThan(0);
    expect(sends.every((x) => x.args.body.supersede === undefined)).toBe(true);
  }, 20000);

  const confirmed = { id: "row-1", status: "scheduled", sprout_post_id: "77", created_at: new Date(Date.now() - 86_400_000).toISOString(), calendar_post_key: "post:abc", scheduled_time: "2030-09-20T15:00:00Z" };
  const press = async (name: string) => {
    const button = await screen.findByRole("button", { name });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
  };
  const sends = () => f.invokes.filter((x) => x.name === "schedule-sprout-post");

  it.each([["confirmed send first", true], ["holding send first", false]])("reads the send that holds the post when an earlier one was confirmed, %s", async (_name, confirmedFirst) => {
    const held = { id: "row-9", status: "asked", created_at: PAST(), calendar_post_key: "post:abc", scheduled_time: "2030-09-21T15:00:00Z" };
    f.rows = confirmedFirst ? [confirmed, held] : [held, confirmed];
    mount();
    expect(await screen.findAllByText("Sprout did not confirm this post. Send it again to be sure it is there.")).not.toHaveLength(0);
    await press("Send again");
    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(sends()[0].args.body.supersede).toBe("row-9");
  });

  it("says the post is being sent, and sends no row to close, when the holding send can still be running", async () => {
    f.rows = [confirmed, { id: "row-9", status: "asked", created_at: new Date().toISOString(), calendar_post_key: "post:abc", scheduled_time: "2030-09-21T15:00:00Z" }];
    mount();
    expect(await screen.findByText("This post is being sent to Sprout.")).toBeTruthy();
    await press("Send again");
    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(sends()[0].args.body.supersede).toBeUndefined();
  });

  it("sends the row to close on the next press in the same dialog once the earlier send can no longer be running", async () => {
    f.rows = [{ id: "row-9", status: "asked", created_at: new Date().toISOString(), calendar_post_key: "post:abc", scheduled_time: "2030-09-21T15:00:00Z" }];
    f.reply = refusal(409, "send_in_progress");
    mount();
    await press("Send again");
    expect(await screen.findByText("This post is already being sent.", {}, { timeout: 15000 })).toBeTruthy();
    // The earlier send's run is over now.
    f.rows = [{ ...f.rows[0], created_at: PAST() }];
    f.reply = { data: { success: true, status: "scheduled", scheduled_time: "2030-09-21T15:00:00Z" }, error: null };
    const before = sends().length;
    await press("Send again");
    await waitFor(() => expect(sends().length).toBeGreaterThan(before));
    expect(sends()[sends().length - 1].args.body.supersede).toBe("row-9");
  }, 20000);

  it("says unconfirmed by itself when the earlier send's run ends while the dialog is open", async () => {
    f.rows = [{ id: "row-9", status: "asked", created_at: new Date(Date.now() - SEND_RUN_LIMIT_MS + 800).toISOString(), calendar_post_key: "post:abc", scheduled_time: "2030-09-21T15:00:00Z" }];
    mount();
    expect(await screen.findByText("This post is being sent to Sprout.")).toBeTruthy();
    expect(await screen.findByText("Sprout did not confirm this post. Send it again to be sure it is there.", {}, { timeout: 5000 })).toBeTruthy();
  }, 10000);

  it("says unconfirmed at once for a send that ended without Sprout's answer", async () => {
    f.rows = [{ id: "row-9", status: "unconfirmed", created_at: new Date().toISOString(), calendar_post_key: "post:abc", scheduled_time: "2030-09-21T15:00:00Z" }];
    mount();
    expect(await screen.findAllByText("Sprout did not confirm this post. Send it again to be sure it is there.")).not.toHaveLength(0);
    await press("Send again");
    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(sends()[0].args.body.supersede).toBe("row-9");
  });
});
