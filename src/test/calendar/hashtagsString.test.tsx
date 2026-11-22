/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// QA 22 Nov 2026 (P08-01, the 18 Nov crash): Regenerate on a feed post's Copy tab. regenerate-post-copy returns
// `hashtags` as a STRING (its prompt asks for "hashtags": "relevant hashtags").
// CopyEditor hands that string up via onCopySaved; the panel re-renders the
// copy editor with it and line 278 calls post.hashtags.some(...).
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ContentIdeasTab } from "@/components/reports/calendar/ContentIdeasTab";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/telemetry", () => ({ track: vi.fn(), editDistancePct: () => 0 }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isMoburstStaff: true, isClient: false }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: "me" } } } }), getUser: async () => ({ data: { user: { id: "me" } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  functions: { invoke: async (name: string) => name === "regenerate-post-copy"
    ? { data: { post: { caption_angle: "A brand new caption.", CTA: "Shop now", hashtags: "#fall #sale" } }, error: null }
    : { data: {}, error: null } },
  from: () => { const q: any = { select: () => q, eq: () => q, neq: () => q, in: () => q, is: () => q, order: () => q, limit: () => q, gte: () => q,
    maybeSingle: async () => ({ data: null, error: null }), then: (ok: any) => Promise.resolve({ data: [], error: null }).then(ok) }; return q; },
} }));
afterEach(cleanup);

describe("copy editor with hashtags returned as a string", () => {
  it("keeps the panel on screen after a successful regenerate", async () => {
    const errors: unknown[] = [];
    const onErr = (e: ErrorEvent) => { errors.push(e.error); e.preventDefault(); };
    window.addEventListener("error", onErr);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const week = [{ day: "Monday", date_label: "Nov 9", posts: [{ _calendarPostKey: "a", platform: "Instagram", copy: "Monday on Instagram", format: "Single Image", hashtags: ["monday"] }] }];
    render(<QueryClientProvider client={qc}><ContentIdeasTab mode="calendar" contentCalendar={week} aiAnalysis={null} sproutPerformance={null} clientId="c1" availablePlatforms={["Instagram"]} availableLanguages={["en"]} /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /Open post/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Regenerate$/ }));
    const boxes = await screen.findAllByRole("button", { name: /^Regenerate$/ });
    let thrown: unknown = null;
    try { fireEvent.click(boxes[boxes.length - 1]); await screen.findByText("A brand new caption.", undefined, { timeout: 3000 }); } catch (e) { thrown = e; }
    window.removeEventListener("error", onErr);
    const typeErrors = errors.filter((e) => String(e).includes("hashtags.some is not a function"));
    expect(typeErrors, `render threw: ${String(typeErrors[0] ?? thrown)}`).toHaveLength(0);
    expect(thrown).toBeNull();
  });
});
