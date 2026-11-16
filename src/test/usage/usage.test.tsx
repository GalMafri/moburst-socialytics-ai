import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const f = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (fn: string, args?: unknown) => f.rpc(fn, args) } }));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

import { readFileSync } from "node:fs";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Usage, { HABIT_MIN_REPORTS, LAPSED_AFTER_DAYS } from "@/pages/Usage";

const user = (over: Record<string, unknown> = {}) => ({
  email: "ada@moburst.com", name: "Ada Lovelace", company: null, role: "admin", provisioned_at: "2026-09-01T00:00:00Z",
  last_sign_in_at: "2026-11-03T10:00:00Z", first_action_at: null, last_action_at: "2026-11-03T10:00:00Z", actions_total: 4, reports_ok: 2,
  posts_created: 1, posts_iterated: 0, posts_approved: 1, clients_touched: 1, active_days: 2, failures: 0, state: "active", ...over,
});

let users: unknown[] | { message: string };
let timeline: unknown[];
beforeEach(() => {
  users = [user()];
  timeline = [];
  f.rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_user_analytics") return Array.isArray(users) ? { data: users, error: null } : { data: null, error: users };
    if (fn === "get_user_timeline") return { data: timeline, error: null };
    return { data: [], error: null };
  });
});
afterEach(cleanup);

function open() {
  return render(<MemoryRouter initialEntries={["/usage"]}><Routes><Route path="/auth" element={<div>Sign-in page</div>} /><Route path="*" element={<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Usage /></QueryClientProvider>} /></Routes></MemoryRouter>);
}

describe("the admin Usage page", () => {
  it("opens a person's detail from their name, which is a button a keyboard reaches", async () => {
    open();
    const name = await screen.findByRole("button", { name: /Ada Lovelace/ });
    expect(name.tagName).toBe("BUTTON");
    expect(name).toHaveAttribute("type", "button");
    fireEvent.click(name);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(f.rpc).toHaveBeenCalledWith("get_user_timeline", expect.objectContaining({ p_email: "ada@moburst.com" }));
  });

  it("keeps loading through a refused read, with no dead-end line and no trip to sign-in", async () => {
    users = { message: "permission denied for function get_user_analytics" };
    open();
    await waitFor(() => expect(screen.getAllByRole("status").length).toBeGreaterThan(0));
    expect(screen.queryByText("Sign-in page")).toBeNull();
    expect(screen.queryByText(/signed out|permission/i)).toBeNull();
  });

  it("does not call an expired access token signed out: it keeps loading", async () => {
    users = { message: "JWT expired" };
    open();
    await waitFor(() => expect(screen.getAllByRole("status").length).toBeGreaterThan(0));
    expect(screen.queryByText("Sign-in page")).toBeNull();
    expect(screen.queryByText(/signed out|expired/i)).toBeNull();
  });

  it("describes drafts being rewritten without naming a model", async () => {
    open();
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Behavior" }), { button: 0 });
    expect(await screen.findByText(/Edit distance is how much of the generated draft/)).not.toHaveTextContent(/model/i);
  });

  it("names the 90 days on every Behavior card and on the actions table", async () => {
    open();
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Behavior" }), { button: 0 });
    await screen.findByText("Draft quality and trust");
    expect(screen.getAllByText("Last 90 days")).toHaveLength(4);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Features" }), { button: 0 });
    expect(await screen.findByText("Actions in the last 90 days")).toBeInTheDocument();
  });

  it("words the idle seats tile as a count as of now, not a one-day window", async () => {
    open();
    expect(await screen.findByText(/of everyone provisioned, as of now/)).toBeInTheDocument();
    expect(screen.queryByText(/provisioned, today/)).toBeNull();
  });

  it("keeps loading, with no summary and no failure copy, while the person's detail read has not answered", async () => {
    f.rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_user_analytics") return { data: [user()], error: null };
      if (fn === "get_user_detail") return { data: null, error: { message: "boom" } };
      return { data: [], error: null };
    });
    open();
    fireEvent.click(await screen.findByRole("button", { name: /Ada Lovelace/ }));
    await waitFor(() => expect(screen.getAllByRole("status").length).toBeGreaterThan(0));
    expect(screen.queryByText(/boom|failed|could not/i)).toBeNull();
  });

  it("labels the Regular users tile with the rule the habit state uses, and counts a lapsed person out", async () => {
    users = [
      user({ email: "a@moburst.com", name: "Active Ann", reports_ok: 5, state: "habit" }),
      user({ email: "l@moburst.com", name: "Lapsed Lee", reports_ok: 5, last_action_at: "2026-08-01T00:00:00Z", state: "lapsed" }),
    ];
    open();
    expect(await screen.findByText(/have done work in the product, all time/)).toBeInTheDocument();
    expect(screen.getByText(`${HABIT_MIN_REPORTS} or more finished reports, active in the last ${LAPSED_AFTER_DAYS} days`)).toBeInTheDocument();
    expect(screen.queryByText(/finished reports, all time/)).toBeNull();
    const tile = screen.getByText("Regular users").parentElement as HTMLElement;
    expect(within(tile.parentElement as HTMLElement).getByText("1")).toBeInTheDocument();
  });

  it("keeps the label's numbers equal to the user_analytics view the state comes from", () => {
    const sql = readFileSync("supabase/migrations/20261019210000_shared_layers.sql", "utf8");
    const view = sql.slice(sql.indexOf("create or replace view public.user_analytics"));
    expect(view).toContain(`max(a.at) < (now() - '${LAPSED_AFTER_DAYS} days'::interval) then 'lapsed'`);
    expect(view).toMatch(new RegExp(`outcome = 'ok'::text\\) >= ${HABIT_MIN_REPORTS} then 'habit'`));
  });

  it("shows 'No activity yet' for a person with no activity, through the shared loading state first", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: /Ada Lovelace/ }));
    expect(await within(await screen.findByRole("dialog")).findByText("No activity yet")).toBeInTheDocument();
    expect(screen.queryByText(/never done anything/)).toBeNull();
  });

  it("keeps loading, not saying 'No activity yet', while the timeline read has not answered", async () => {
    f.rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_user_analytics") return { data: [user()], error: null };
      if (fn === "get_user_timeline") return { data: null, error: { message: "boom" } };
      return { data: [], error: null };
    });
    open();
    fireEvent.click(await screen.findByRole("button", { name: /Ada Lovelace/ }));
    await waitFor(() => expect(screen.getAllByRole("status").length).toBeGreaterThan(0));
    expect(within(await screen.findByRole("dialog")).queryByText("No activity yet")).toBeNull();
    expect(screen.queryByText(/boom|failed|could not/i)).toBeNull();
  });
});

describe("the person panel's loading state", () => {
  it("shows one loading region when both reads have not answered", async () => {
    f.rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_user_analytics") return { data: [user()], error: null };
      if (fn === "get_user_detail" || fn === "get_user_timeline") return { data: null, error: { message: "boom" } };
      return { data: [], error: null };
    });
    open();
    fireEvent.click(await screen.findByRole("button", { name: /Ada Lovelace/ }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getAllByRole("status").length).toBeGreaterThan(0));
    expect(within(dialog).getAllByRole("status")).toHaveLength(1);
  });
});
