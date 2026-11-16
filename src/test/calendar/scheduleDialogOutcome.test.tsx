/* eslint-disable @typescript-eslint/no-explicit-any */
// What the send dialog says after a press that does not send the post.
// - A send that ended without Sprout's answer (code post_not_confirmed) may have made the post, so the dialog
//   says nothing about the press: the description already says the post is not confirmed.
//   "This send did not go through." stays for a refusal where the server said nothing was made.
// - A press the server held (code send_in_progress) keeps its line, "This post is already being sent.", for
//   as long as the row that holds the post is the same row, and drops it when that row changes.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SchedulePostModal } from "@/components/reports/SchedulePostModal";
import { SEND_RUN_LIMIT_MS } from "../../../supabase/functions/_shared/sprout/sendWindow";

const f = vi.hoisted(() => ({ rows: [] as any[], invokes: [] as any[], reply: { data: { success: true }, error: null } as any, afterSend: (() => {}) as () => void }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: async (name: string, args: any) => {
        f.invokes.push({ name, args });
        if (name === "sprout-profiles") return { data: { profiles: [{ id: 1, name: "Brand", network_type: "linkedin_company" }] }, error: null };
        f.afterSend();
        return f.reply;
      },
    },
    from: (table: string) => {
      const q: any = { select: () => q, eq: () => q, neq: () => q, then: (ok: any, bad: any) => Promise.resolve({ data: table === "sprout_profiles" ? [{ sprout_profile_id: 1, network_type: "linkedin_company" }] : f.rows, error: null }).then(ok, bad) };
      return q;
    },
  },
}));

const refusal = (status: number, code: string) => ({ data: null, error: { context: { status, json: async () => ({ error: "x", code }) } } });
const post = { _calendarPostKey: "post:abc", copy: "A post.", platform: "LinkedIn", date_label: "2030-09-21", posting_time: "3:00 PM UTC" };
const PAST = () => new Date(Date.now() - SEND_RUN_LIMIT_MS - 60_000).toISOString();
const NOT_CONFIRMED = "Sprout did not confirm this post. Send it again to be sure it is there.";
const HELD = "This post is already being sent.";
const NOT_THROUGH = "This send did not go through. Everything above is kept as it is.";
const NOT_SENT = "Not sent to Sprout yet. Everything above is kept as it is.";
let client: QueryClient;
const mount = () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><SchedulePostModal open onOpenChange={() => {}} post={post} clientId="c1" clientTimezone="UTC" /></QueryClientProvider>);
};
const press = async (name: string) => {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
};
const refetch = () => client.invalidateQueries({ queryKey: ["scheduled-posts-full", "c1"] });
const sends = () => f.invokes.filter((x) => x.name === "schedule-sprout-post");

beforeEach(() => { f.rows = []; f.invokes = []; f.reply = { data: { success: true }, error: null }; f.afterSend = () => {}; });
afterEach(cleanup);

describe("a press that ended without Sprout's answer", () => {
  const unconfirmedRow = { id: "row-new", status: "unconfirmed", created_at: new Date().toISOString(), calendar_post_key: "post:abc", scheduled_time: "2030-09-21T15:00:00Z" };

  it("shows no outcome line, and the description says the post is not confirmed", async () => {
    f.reply = refusal(500, "post_not_confirmed");
    f.afterSend = () => { f.rows = [unconfirmedRow]; };
    mount();
    await press("Send");
    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(await screen.findAllByText(NOT_CONFIRMED)).not.toHaveLength(0);
    expect(screen.queryByText(NOT_THROUGH)).toBeNull();
    expect(screen.queryByText(NOT_SENT)).toBeNull();
  });

  it("says the post is not confirmed even when the refetch brings no row", async () => {
    f.reply = refusal(500, "post_not_confirmed");
    // The rows never show the send: the dialog keeps what the press itself learned.
    f.rows = [];
    mount();
    await press("Send");
    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(await screen.findAllByText(NOT_CONFIRMED)).not.toHaveLength(0);
    expect(screen.queryByText(NOT_SENT)).toBeNull();
    expect(screen.queryByText(NOT_THROUGH)).toBeNull();
  });

  it("drops its own unconfirmed row once the rows query answers again, so a change made elsewhere shows", async () => {
    f.reply = refusal(500, "post_not_confirmed");
    f.rows = [];
    mount();
    await press("Send");
    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(await screen.findAllByText(NOT_CONFIRMED)).not.toHaveLength(0);
    // Another person's send of the post is confirmed meanwhile.
    f.rows = [{ id: "row-77", status: "scheduled", sprout_post_id: "77", created_at: new Date().toISOString(), calendar_post_key: "post:abc", scheduled_time: "2030-09-21T15:00:00Z" }];
    await refetch();
    await waitFor(() => expect(screen.queryByText(NOT_CONFIRMED)).toBeNull());
  });

  it("shows no outcome line for a post that had an earlier confirmed draft either", async () => {
    f.rows = [{ id: "row-1", status: "scheduled", sprout_post_id: "77", created_at: new Date(Date.now() - 86_400_000).toISOString(), calendar_post_key: "post:abc", scheduled_time: "2030-09-20T15:00:00Z" }];
    f.reply = refusal(500, "post_not_confirmed");
    f.afterSend = () => { f.rows = [...f.rows, unconfirmedRow]; };
    mount();
    await press("Send again");
    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(await screen.findAllByText(NOT_CONFIRMED)).not.toHaveLength(0);
    expect(screen.queryByText(NOT_THROUGH)).toBeNull();
  });

  it("still says this send did not go through when the server said nothing was made", async () => {
    f.rows = [{ id: "row-1", status: "scheduled", sprout_post_id: "77", created_at: new Date(Date.now() - 86_400_000).toISOString(), calendar_post_key: "post:abc", scheduled_time: "2030-09-20T15:00:00Z" }];
    f.reply = refusal(500, "post_not_made");
    mount();
    await press("Send again");
    expect(await screen.findByText(NOT_THROUGH)).toBeTruthy();
  });

  it("still says not sent yet for a first press the server refused", async () => {
    f.reply = refusal(500, "post_not_made");
    mount();
    await press("Send");
    expect(await screen.findByText(NOT_SENT)).toBeTruthy();
  });
});

describe("a press the server held", () => {
  const holding = { id: "row-9", status: "asked", created_at: new Date().toISOString(), calendar_post_key: "post:abc", scheduled_time: "2030-09-21T15:00:00Z" };

  it("keeps its line while the row that holds the post is the same row", async () => {
    f.rows = [holding];
    f.reply = refusal(409, "send_in_progress");
    mount();
    await press("Send again");
    expect(await screen.findByText(HELD)).toBeTruthy();
    await refetch();
    await refetch();
    expect(screen.getByText(HELD)).toBeTruthy();
  });

  it("drops its line when the holding row is confirmed", async () => {
    f.rows = [holding];
    f.reply = refusal(409, "send_in_progress");
    mount();
    await press("Send again");
    expect(await screen.findByText(HELD)).toBeTruthy();
    f.rows = [{ ...holding, status: "scheduled", sprout_post_id: "77" }];
    await refetch();
    await waitFor(() => expect(screen.queryByText(HELD)).toBeNull());
  });

  it("drops its line when the holding row is replaced by another", async () => {
    f.rows = [holding];
    f.reply = refusal(409, "send_in_progress");
    mount();
    await press("Send again");
    expect(await screen.findByText(HELD)).toBeTruthy();
    f.rows = [{ ...holding, id: "row-10", created_at: new Date(Date.now() + 5_000).toISOString() }];
    await refetch();
    await waitFor(() => expect(screen.queryByText(HELD)).toBeNull());
  });

  it("drops its line on the next press", async () => {
    f.rows = [holding];
    f.reply = refusal(409, "send_in_progress");
    mount();
    await press("Send again");
    expect(await screen.findByText(HELD)).toBeTruthy();
    f.reply = refusal(422, "not_publishable");
    await press("Send again");
    await waitFor(() => expect(screen.queryByText(HELD)).toBeNull());
  });
});
