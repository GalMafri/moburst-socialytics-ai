/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// Social AI sync, 18 Nov 2026 (Sinéad): Regenerate rewrote the copy and left
// the "Visual:" line as it was; she asked for a Regenerate for the copy and one
// for the visual, the visual one bringing a new idea on its own.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CopyEditor } from "@/components/reports/calendar/CopyEditor";

const calls = vi.hoisted(() => ({ list: [] as Array<{ name: string; body: any }>, answers: {} as Record<string, any> }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/telemetry", () => ({ track: vi.fn(), editDistancePct: () => 0 }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isMoburstStaff: true, isClient: false }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
  functions: { invoke: async (name: string, { body }: any) => { calls.list.push({ name, body }); return { data: calls.answers[name] ?? {}, error: null }; } },
  from: () => { const q: any = { select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q, is: () => q, maybeSingle: async () => ({ data: null, error: null }), then: (ok: any) => Promise.resolve({ data: [], error: null }).then(ok) }; return q; },
} }));
afterEach(cleanup);
beforeEach(() => { calls.list = []; calls.answers = {}; });

const post = { _calendarPostKey: "plan:2026-11-30:instagram:1", platform: "Instagram", format: "Single image", copy: "Captains pay last.", visual_direction: "A dim rink at night." };
const mount = (onCopySaved = vi.fn()) => {
  render(<QueryClientProvider client={new QueryClient()}><CopyEditor post={post} clientId="c1" brand="Pay The Pyper" onCopySaved={onCopySaved} /></QueryClientProvider>);
  return onCopySaved;
};

describe("Regenerate copy", () => {
  it("sends the current visual and saves the visual that comes back with the new copy", async () => {
    calls.answers["regenerate-post-copy"] = { post: { caption_angle: "Captains always pay last.", CTA: "Get the app", hashtags: ["#beerleague"], visual_direction: "A wallet on the locker room bench." } };
    const saved = mount();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate copy" }));
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await waitFor(() => expect(calls.list.map((c) => c.name)).toEqual(["regenerate-post-copy", "calendar-posts"]));
    expect(calls.list[0].body.current_visual).toBe("A dim rink at night.");
    expect(calls.list[1].body).toMatchObject({ post_copy: "Captains always pay last.", visual_direction: "A wallet on the locker room bench." });
    expect(saved.mock.calls[0][0].visual_direction).toBe("A wallet on the locker room bench.");
    expect(await screen.findByText("A wallet on the locker room bench.")).toBeTruthy();
  });
});

describe("Regenerate visual", () => {
  it("asks for a new visual only, saves it with the copy unchanged, and shows it", async () => {
    calls.answers["regenerate-post-copy"] = { post: { visual_direction: "Two skates crossed on the ice." } };
    const saved = mount();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate visual" }));
    await waitFor(() => expect(calls.list.map((c) => c.name)).toEqual(["regenerate-post-copy", "calendar-posts"]));
    expect(calls.list[0].body).toMatchObject({ mode: "visual", current_visual: "A dim rink at night.", current_copy: "Captains pay last." });
    expect(calls.list[1].body).toMatchObject({ post_copy: "Captains pay last.", visual_direction: "Two skates crossed on the ice." });
    expect(saved.mock.calls[0][0]).toMatchObject({ copy: "Captains pay last.", visual_direction: "Two skates crossed on the ice." });
    expect(await screen.findByText("Two skates crossed on the ice.")).toBeTruthy();
  });

  it("keeps the old visual and brings the button back when no new one came back, with no note on screen", async () => {
    calls.answers["regenerate-post-copy"] = { error: "Failed to parse" };
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate visual" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Regenerate visual" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText(/not regenerated/)).toBeNull();
    expect(screen.getByText("A dim rink at night.")).toBeTruthy();
    expect(calls.list.map((c) => c.name)).toEqual(["regenerate-post-copy"]);
  });
});
