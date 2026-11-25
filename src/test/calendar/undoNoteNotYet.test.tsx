/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// QA 22 Nov 2026 (P08-05): Undo under "Rewritten with your note. Learned for X: ...". When the
// undo is refused (or still unanswered after the quiet retries), undoNote only
// flips `undoing` back: the line, the Undo link and everything else look the
// same as before the click. No "not undone yet" state line.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CopyEditor } from "@/components/reports/calendar/CopyEditor";
import { DesignNote } from "@/components/reports/calendar/DesignNote";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/telemetry", () => ({ track: vi.fn(), editDistancePct: () => 0 }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
  functions: { invoke: async (name: string, { body }: any) => {
    if (name === "regenerate-post-copy") return { data: { post: { caption_angle: "Shorter caption.", CTA: "Go", hashtags: [] } }, error: null };
    if (body.action === "save_copy") return { data: { ok: true, learned: { changes: [{ op: "add", id: "p1", description: "Short sentences", platform: null }] } }, error: null };
    return { data: null, error: { name: "FunctionsHttpError", message: "refused", context: { status: 403 } } };
  } },
} }));
afterEach(cleanup);

describe("P08-05 Undo of what a copy note taught, when the undo does not go through", () => {
  it("changes what the person sees after the click", async () => {
    const qc = new QueryClient();
    const post = { _calendarPostKey: "k1", platform: "Instagram", format: "Single image", copy: "A long caption." };
    render(<QueryClientProvider client={qc}><CopyEditor post={post} clientId="c1" brand="Acme" /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Regenerate copy" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "shorter please" } });
    fireEvent.click(screen.getAllByRole("button", { name: /^Regenerate$/ }).pop()!);
    const undo = await screen.findByRole("button", { name: "Undo" });
    const before = document.body.textContent;
    fireEvent.click(undo);
    await waitFor(() => expect((screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(false));
    expect(document.body.textContent).not.toBe(before);
    expect(screen.getByText(/Not undone yet\./)).toBeInTheDocument();
  });
});

describe("P08-05 Undo of what a design note taught, when the undo does not go through", () => {
  it("says it is not undone yet and keeps Undo", async () => {
    render(<DesignNote request={{ id: "req1", note: "warmer colors", note_learned: { rules: [{ op: "add", id: "r1", description: "Warm palette" }] } as any }} brand="Acme" made />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText(/Not undone yet\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
  });
});
