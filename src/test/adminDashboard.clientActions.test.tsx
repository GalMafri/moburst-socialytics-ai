/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// QA 22 Nov 2026 (P06-5): Permanently delete, Archive and Restore closed their
// dialog and showed nothing while the request was resent quietly, and nothing
// when it still did not get through. The client's card now says the delete is
// under way, and then that the client is not deleted yet.
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminDashboard } from "@/components/dashboard/AdminDashboard";

const f = vi.hoisted(() => ({ settle: null as null | ((v: any) => void), invokes: [] as any[] }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/dashboard/ClientOverview", () => ({ ClientOverview: () => null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ canManageClients: true, canRunAnalysis: true, canDelete: true }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
  removeChannel: vi.fn(),
  from: () => ({ select: () => ({ order: async () => ({ data: [{ id: "z", name: "Old Co", reports: [], archived_at: "2026-01-01", primary_platforms: [] }], error: null }) }) }),
  functions: { invoke: (name: string, opts: any) => { f.invokes.push({ name, opts }); return new Promise((r) => { f.settle = r; }); } },
  rpc: async () => ({ data: null, error: null }),
  storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://files.test/${p}` } }) }) },
} }));
afterEach(() => { cleanup(); f.settle = null; f.invokes = []; });

it("says on the client's card that a permanent delete is under way, then that it is not deleted yet", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={["/"]}><AdminDashboard /></MemoryRouter></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Show archived" }));
  const more = await screen.findByRole("button", { name: "More actions" });
  fireEvent.keyDown(more, { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: /Permanently delete/ }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.change(within(dialog).getByLabelText(/Confirm by typing/), { target: { value: "Old Co" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Permanently delete" }));
  expect(await screen.findByText("Deleting the client…")).toBeInTheDocument();
  // delete-client refuses (a 4xx is not resent).
  await act(async () => { f.settle!({ data: null, error: { context: { status: 403 }, message: "refused" } }); });
  expect(await screen.findByText("Not deleted yet.")).toBeInTheDocument();
  expect(screen.queryByText("Deleting the client…")).toBeNull();
});
