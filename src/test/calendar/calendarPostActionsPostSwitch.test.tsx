/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles. */
// QA 22 Nov 2026 (P05-4): CalendarPostActions keeps its "Move to" date in useState(date),
// read once. The post panel stays mounted when it switches post (a Story's
// "Open the post", a post's Story chip: openDesigns), so the Move popover of
// the second post shows the first post's date, and "Move post" moves the
// second post to the first post's day.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CalendarPostActions } from "@/components/calendar/CalendarPostActions";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: async () => ({ data: null, error: null }), from: () => ({}) } }));
afterEach(cleanup);

describe("P05 Move date after the panel switches post", () => {
  it("offers the shown post's own date", async () => {
    const qc = new QueryClient();
    const ui = (postId: string, date: string) => <QueryClientProvider client={qc}><CalendarPostActions postId={postId} clientId="c1" date={date} onDone={() => {}} /></QueryClientProvider>;
    const { rerender } = render(ui("post-a", "2026-11-09"));
    rerender(ui("story-b", "2026-11-12"));
    fireEvent.click(screen.getByRole("button", { name: "Move to another date" }));
    expect(await screen.findByLabelText("New date")).toHaveValue("2026-11-12");
  });
});
