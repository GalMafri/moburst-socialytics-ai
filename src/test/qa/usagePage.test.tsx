/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// Usage (admin user analytics). QA 22 Nov 2026 (P21-06): a read that did not
// answer was shown as facts about the data ("Did not finish 0 of 0 actions",
// "No activity yet", "Nothing recorded yet"); it now loads and is tried again
// (LoadRetry: "a load that did not answer never claims anything about the data").
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Usage from "@/pages/Usage";

const failing = vi.hoisted(() => new Set<string>());
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children }: any) => <main>{children}</main> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: async (fn: string) => {
  if (failing.has(fn)) return { data: null, error: { message: "timeout" } };
  if (fn === "get_user_analytics") return { data: [{ email: "a@x.com", name: "A", company: null, role: "admin", provisioned_at: null, last_sign_in_at: null, first_action_at: null, last_action_at: null, actions_total: 40, reports_ok: 3, posts_created: 5, posts_iterated: 1, posts_approved: 2, clients_touched: 2, active_days: 9, failures: 2, state: "habit" }], error: null };
  return { data: [], error: null };
} } }));

afterEach(() => {
  cleanup();
  failing.clear();
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><Usage /></MemoryRouter></QueryClientProvider>);
  return qc;
}
const openTab = (name: string) => {
  const tab = screen.getByRole("tab", { name });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
};

describe("the usage page when a read did not answer", () => {
  it("does not say 0 of 0 actions or no activity when the trend read failed", async () => {
    failing.add("get_usage_trend");
    const qc = mount();
    await screen.findAllByText("Did not finish");
    await waitFor(() => expect(qc.getQueryState(["usage", "trend"])?.status).toBe("error"));
    expect(screen.queryByText("of 0 actions, all time")).toBeNull();
    openTab("Overview");
    await screen.findByText("Activity over time");
    expect(screen.queryByText("No activity yet")).toBeNull();
  });

  it("still says there was no activity when the trend read answered with none", async () => {
    const qc = mount();
    await waitFor(() => expect(qc.getQueryState(["usage", "trend"])?.status).toBe("success"));
    expect(await screen.findByText("of 0 actions, all time")).toBeInTheDocument();
  });

  it("does not show a behavior card's empty line when its read failed", async () => {
    for (const fn of ["get_funnel", "get_ai_quality", "get_report_engagement", "get_session_quality"]) failing.add(fn);
    const qc = mount();
    await screen.findAllByText("Did not finish");
    openTab("Behavior");
    await waitFor(() => expect(qc.getQueryCache().findAll({ queryKey: ["usage", "ai"] })[0]?.state.status).toBe("error"));
    expect(screen.queryByText("Nothing recorded yet.")).toBeNull();
  });
});
