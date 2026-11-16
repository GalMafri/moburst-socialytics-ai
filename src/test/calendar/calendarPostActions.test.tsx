/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase doubles model heterogeneous response shapes. */
// Deleting a calendar post from its panel: one server function archives the
// post, its Story and their designs (20261113100720_calendar_delete_post.sql);
// the button never deletes the table's row itself.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CalendarPostActions } from "@/components/calendar/CalendarPostActions";

const f = vi.hoisted(() => ({
  rpcs: [] as Array<{ name: string; args: any }>,
  tableCalls: [] as string[],
  rpcAnswer: { data: null, error: null } as { data: any; error: any },
  success: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: f.success, error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/quietSend", async (orig) => {
  const real = await orig<typeof import("@/lib/quietSend")>();
  return { ...real, sendQuietly: (send: any, opts: any) => real.sendQuietly(send, { ...opts, waits: [] }) };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: async (name: string, args: any) => { f.rpcs.push({ name, args }); return f.rpcAnswer; },
  from: (table: string) => {
    const q: any = new Proxy({}, { get: (_t, method: string) => (..._a: any[]) => { f.tableCalls.push(`${table}.${method}`); return q; } });
    return q;
  },
} }));

const POST = "5f0c2a1e-7d3b-4c8e-9a61-2b4d8e9f0c17";
function mount(onDone = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><CalendarPostActions postId={POST} clientId="c1" date="2026-11-09" onDone={onDone} /></QueryClientProvider>);
  return onDone;
}
const confirmDelete = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Delete this post" }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Delete")!);
};

beforeEach(() => { f.rpcs.length = 0; f.tableCalls.length = 0; f.rpcAnswer = { data: null, error: null }; f.success.mockClear(); });
afterEach(cleanup);

describe("Delete this post", () => {
  it("calls the server function with the post and deletes no table row itself", async () => {
    const onDone = mount();
    await confirmDelete();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(f.rpcs).toEqual([{ name: "calendar_delete_post", args: { p_post: POST } }]);
    expect(f.tableCalls.filter((c) => c.endsWith(".delete"))).toEqual([]);
    expect(f.success).toHaveBeenCalledWith("Post deleted");
  });

  it("keeps the dialog up and says the post is still there when the call gets no answer", async () => {
    f.rpcAnswer = { data: null, error: { message: "network", code: "08006" } };
    const onDone = mount();
    await confirmDelete();
    expect(await screen.findByText("Not deleted yet. The post is still on the calendar.")).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });
});
