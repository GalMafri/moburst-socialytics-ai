/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// The post's reason line in the copy editor reads like the Visual line above
// it: a label, then the words, with no emoji.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CopyEditor } from "@/components/reports/calendar/CopyEditor";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/telemetry", () => ({ track: vi.fn(), editDistancePct: () => 0 }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isMoburstStaff: true, isClient: false }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
  functions: { invoke: async () => ({ data: {}, error: null }) },
  from: () => { const q: any = { select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q, is: () => q, maybeSingle: async () => ({ data: null, error: null }), then: (ok: any) => Promise.resolve({ data: [], error: null }).then(ok) }; return q; },
} }));
afterEach(cleanup);

describe("the copy editor's idea line", () => {
  it("starts with Idea: like the Visual line, and holds no emoji", () => {
    const post = { _calendarPostKey: "post:p1", platform: "Instagram", format: "Single image", copy: "Join us Friday.", date_label: "2026-11-05", visual_direction: "A bright studio shot", rationale: "Fridays get the most saves." };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><CopyEditor post={post} clientId="c1" brand="Pay The Pyper" /></QueryClientProvider>);
    const visual = screen.getByText("Visual:").parentElement!;
    const idea = screen.getByText("Idea:").parentElement!;
    expect(idea.textContent).toBe("Idea: Fridays get the most saves.");
    expect(idea.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(idea.tagName).toBe(visual.tagName);
    expect(idea.className).toBe(visual.className);
  });
});
